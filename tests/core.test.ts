import { test, before, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LocalDatabase } from '../scripts/database';
import { seed } from '../scripts/seed';
import { fixtureFetch } from '../scripts/fixtures';
import { all, first, run, type Env } from '../packages/db/src/index';
import {
  encrypt,
  decrypt,
  hash,
  token,
  passwordHash,
  checkPassword,
} from '../packages/crypto/src/index';
import { canUse, availableTools, canManage } from '../packages/permissions/src/index';
import { authenticateClient, sessionUser, rateLimit } from '../packages/auth/src/index';
import { validateServerUrl, withRemote } from '../packages/mcp/src/index';
import {
  classify,
  namespace,
  publicName,
  saveDiscovery,
  discover,
} from '../packages/tool-registry/src/index';
import { executeTool } from '../apps/gateway/src/service';
import api from '../apps/api/src/index';
import gateway from '../apps/gateway/src/index';
import type { Connection, Tool, Client } from '../packages/shared/src/index';
let env: Env;
let db: LocalDatabase;
const originalFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin === 'http://127.0.0.1:8790') return fixtureFetch(request);
    throw new Error('Tests cannot access external services');
  };
});
after(() => {
  globalThis.fetch = originalFetch;
});
beforeEach(async () => {
  db = new LocalDatabase();
  env = {
    DB: db,
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    WEB_ORIGIN: 'http://127.0.0.1:3000',
    GATEWAY_URL: 'http://127.0.0.1:8788/mcp',
    DEMO_MODE: 'true',
    DEV_REMOTE_ORIGIN: 'http://127.0.0.1:8790',
  };
  await seed(env);
});
afterEach(() => db.close());
const conn = (id = 'demo_github') =>
  first<Connection>(db, 'SELECT * FROM connections WHERE id=?', id).then((x) => x!);
const tool = (name = 'github_list_issues') =>
  first<Tool>(db, 'SELECT * FROM tools WHERE public_name=?', name).then((x) => x!);
async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  headers?: Record<string, string>,
) {
  return api.fetch(
    new Request(`http://localhost/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    env,
  );
}
async function issueClient(permission = 'read', connectionId = 'demo_github') {
  const response = await request('/clients', 'POST', {
    name: 'Test client',
    type: 'custom',
    workspace_id: 'ws_apprentx',
    permissions: [{ connection_id: connectionId, permission }],
  });
  assert.equal(response.status, 201);
  const secret = (await response.json()) as { id: string; token: string; endpoint: string };
  const client = (await first<Client>(db, 'SELECT * FROM clients WHERE id=?', secret.id))!;
  return { ...secret, client };
}
function rpcRequest(credential: string, body: unknown) {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credential}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  });
}
test('demo servers discover 27 tools with only read tools initially enabled', async () => {
  assert.equal((await all(db, 'SELECT * FROM connections')).length, 6);
  const tools = await all<Tool>(db, 'SELECT * FROM tools');
  assert.equal(tools.length, 27);
  assert.ok(tools.filter((t) => t.enabled).every((t) => t.risk_level === 'read'));
});
test('personal connections stay private even for a workspace admin', async () => {
  const c = await conn('demo_gmail');
  const t = await tool('gmail_search_emails');
  assert.equal(await canUse(db, 'user_demo', c, t), true);
  assert.equal(await canUse(db, 'user_john', c, t), false);
  assert.equal(await canManage(db, c, 'user_john'), false);
});
test('workspace members inherit read access from their teams', async () => {
  assert.equal(await canUse(db, 'user_marie', await conn(), await tool()), true);
  await run(db, "DELETE FROM team_members WHERE user_id='user_marie'");
  assert.equal(await canUse(db, 'user_marie', await conn(), await tool()), false);
});
test('disabled tools cannot be called by an owner', async () => {
  assert.equal(
    await canUse(db, 'user_demo', await conn(), await tool('github_create_issue')),
    false,
  );
});
test('enabling a write tool does not grant write access to a read-only team', async () => {
  await run(db, "UPDATE tools SET enabled=1 WHERE public_name='github_create_issue'");
  assert.equal(
    await canUse(db, 'user_marie', await conn(), await tool('github_create_issue')),
    false,
  );
});
test('client grants intersect with user access and tool enablement', async () => {
  const { client } = await issueClient();
  assert.equal(await canUse(db, 'user_demo', await conn(), await tool(), client), true);
  assert.equal(
    await canUse(
      db,
      'user_demo',
      await conn('demo_linear'),
      await tool('linear_search_issues'),
      client,
    ),
    false,
  );
  await run(db, "UPDATE tools SET enabled=1 WHERE public_name='github_create_issue'");
  assert.equal(
    await canUse(db, 'user_demo', await conn(), await tool('github_create_issue'), client),
    false,
  );
});
test('client with no access sees no tools', async () => {
  const { client } = await issueClient('none');
  assert.deepEqual(await availableTools(db, 'user_demo', client), []);
});
test('explicit user deny overrides a team grant', async () => {
  await run(
    db,
    "INSERT INTO permissions(id,workspace_id,connection_id,subject_type,subject_id,permission) VALUES('deny','ws_apprentx','demo_github','user','user_marie','none')",
  );
  assert.equal(await canUse(db, 'user_marie', await conn(), await tool()), false);
});
test('tool-specific grant restricts a broader connection grant', async () => {
  const { client } = await issueClient('admin');
  const t = await tool();
  await run(
    db,
    "INSERT INTO permissions(id,connection_id,tool_id,subject_type,subject_id,permission) VALUES('deny','demo_github',?,'client',?,'none')",
    t.id,
    client.id,
  );
  assert.equal(await canUse(db, 'user_demo', await conn(), t, client), false);
});
test('paused connections disappear from client tools', async () => {
  const { client } = await issueClient();
  await run(db, "UPDATE connections SET status='paused' WHERE id='demo_github'");
  assert.deepEqual(await availableTools(db, 'user_demo', client), []);
});
test('removed workspace membership invalidates existing client credentials', async () => {
  const issued = await issueClient();
  await run(db, "DELETE FROM workspace_members WHERE user_id='user_demo'");
  await assert.rejects(
    () =>
      authenticateClient(
        new Request('http://local/mcp', { headers: { Authorization: `Bearer ${issued.token}` } }),
        env,
      ),
    /membership/,
  );
});
test('credentials are encrypted with unique nonces and bound to their connection', async () => {
  const value = { token: 'private-upstream-secret' };
  const a = await encrypt(value, env.ENCRYPTION_KEY, 'a');
  const b = await encrypt(value, env.ENCRYPTION_KEY, 'a');
  assert.notEqual(a, b);
  assert.ok(!a.includes(value.token));
  assert.deepEqual(await decrypt(a, env.ENCRYPTION_KEY, 'a'), value);
  await assert.rejects(() => decrypt(a, env.ENCRYPTION_KEY, 'b'));
  await assert.rejects(() => decrypt(a, randomBytes(32).toString('base64'), 'a'));
});
test('password verification rejects incorrect passwords', async () => {
  const stored = await passwordHash('a sufficiently long password');
  assert.equal(await checkPassword('a sufficiently long password', stored), true);
  assert.equal(await checkPassword('wrong password', stored), false);
});
test('public tool names are stable and collision-safe when sanitized or truncated', async () => {
  const a = namespace('GitHub', 'connection_123456789abc');
  const b = namespace('GitHub', 'connection_234567890bcd');
  assert.notEqual(a, b);
  assert.notEqual(await publicName(a, 'a/b'), await publicName(a, 'a_b'));
  assert.notEqual(
    await publicName(a, 'x'.repeat(200) + 'a'),
    await publicName(a, 'x'.repeat(200) + 'b'),
  );
  assert.ok((await publicName(a, 'x'.repeat(200))).length <= 128);
});
test('risk classification fails conservatively for unknown or destructive tools', () => {
  assert.equal(classify('delete_repository', { readOnlyHint: true }), 'admin');
  assert.equal(classify('execute_command'), 'admin');
  assert.equal(classify('mystery_operation', { readOnlyHint: true }), 'write');
  assert.equal(classify('get_secret', { destructiveHint: true }), 'admin');
});
test('server URLs reject private hosts, embedded credentials, queries, and redirects to new hosts', () => {
  for (const url of [
    'http://localhost/mcp',
    'https://127.0.0.1/mcp',
    'https://169.254.169.254/mcp',
    'https://github.com.evil.test/mcp',
    'https://user:secret@api.githubcopilot.com/mcp',
    'https://api.githubcopilot.com/mcp?token=secret',
    'https://api.githubcopilot.com:8443/mcp',
  ])
    assert.throws(() => validateServerUrl(url, {}));
  assert.equal(validateServerUrl('https://mcp.linear.app/mcp', {}).hostname, 'mcp.linear.app');
});
test('API rejects cross-origin writes before modifying data', async () => {
  const response = await request(
    '/profile',
    'PATCH',
    { name: 'Attacker' },
    { origin: 'https://evil.example' },
  );
  assert.equal(response.status, 403);
  assert.equal(
    (await first<{ name: string }>(db, "SELECT name FROM users WHERE id='user_demo'"))!.name,
    'Alex Morgan',
  );
});
test('connection access defaults to read and bulk-enables the selected tool types', async () => {
  const response = await request('/connections', 'POST', {
    name: 'Another GitHub',
    provider: 'github',
    scope: 'personal',
    server_url: 'http://127.0.0.1:8790/github/mcp',
    auth_type: 'none',
  });
  assert.equal(response.status, 201);
  const { id } = (await response.json()) as { id: string };
  const c = await conn(id);
  const tools = await all<Tool>(db, 'SELECT * FROM tools WHERE connection_id=?', id);
  assert.equal(tools.length, 6);
  assert.equal(c.access_mode, 'read');
  assert.ok(
    tools
      .filter((t) => t.risk_level === 'read')
      .every((t) => t.enabled === 1 && t.review_state === 'reviewed'),
  );
  assert.ok(tools.filter((t) => t.risk_level !== 'read').every((t) => t.enabled === 0));

  assert.equal(
    (await request(`/connections/${id}`, 'PATCH', { access_mode: 'read_write' })).status,
    200,
  );
  const readWriteTools = await all<Tool>(db, 'SELECT * FROM tools WHERE connection_id=?', id);
  assert.ok(
    readWriteTools
      .filter((t) => t.risk_level !== 'admin')
      .every((t) => t.enabled === 1 && t.review_state === 'reviewed'),
  );
  assert.ok(readWriteTools.filter((t) => t.risk_level === 'admin').every((t) => !t.enabled));

  assert.equal(
    (await request(`/connections/${id}`, 'PATCH', { access_mode: 'write' })).status,
    200,
  );
  const writeTools = await all<Tool>(db, 'SELECT * FROM tools WHERE connection_id=?', id);
  assert.ok(writeTools.filter((t) => t.risk_level === 'write').every((t) => t.enabled === 1));
  assert.ok(writeTools.filter((t) => t.risk_level !== 'write').every((t) => t.enabled === 0));
});
test('legacy SSE connections discover tools and forward bearer credentials', async () => {
  const previousFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  const authenticated = new Set<string>();
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(request.headers.get('authorization'), 'Bearer legacy-token');
    if (url.pathname === '/sse' && request.method === 'GET') {
      authenticated.add('sse');
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller;
            controller.enqueue(
              encoder.encode('event: endpoint\ndata: /messages?sessionId=test\n\n'),
            );
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    }
    if (url.pathname === '/messages' && request.method === 'POST') {
      authenticated.add('messages');
      const message = (await request.json()) as { id?: string | number; method: string };
      if (message.id !== undefined) {
        const result =
          message.method === 'initialize'
            ? {
                protocolVersion: '2025-03-26',
                capabilities: { tools: {} },
                serverInfo: { name: 'legacy-sse-fixture', version: '1.0.0' },
              }
            : {
                tools: [
                  {
                    name: 'search_records',
                    description: 'Search database records.',
                    inputSchema: { type: 'object', properties: {} },
                  },
                ],
              };
        stream?.enqueue(
          encoder.encode(
            `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`,
          ),
        );
      }
      return new Response(null, { status: 202 });
    }
    throw new Error(`Unexpected legacy SSE request: ${request.method} ${request.url}`);
  };
  const connection: Connection = {
    id: 'legacy_sse',
    scope: 'personal',
    user_id: 'user_demo',
    workspace_id: null,
    name: 'Legacy SSE',
    provider: 'custom',
    namespace: 'legacy_sse',
    server_url: 'http://127.0.0.1:8790/sse',
    auth_type: 'bearer',
    access_mode: 'read',
    status: 'connected',
    is_demo: 0,
    capabilities: '{}',
    created_at: new Date().toISOString(),
  };
  try {
    const discovery = await discover(env, connection, { token: 'legacy-token' });
    assert.deepEqual(
      discovery.tools.map((tool) => tool.name),
      ['search_records'],
    );
    assert.deepEqual([...authenticated].sort(), ['messages', 'sse']);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
test('gateway supports SDK initialize, tools/list, and tools/call across two upstream servers', async () => {
  const issued = await issueClient();
  await request(`/clients/${issued.id}/permissions`, 'PUT', {
    connection_id: 'demo_linear',
    permission: 'read',
  });
  const client = new McpClient({ name: 'integration-test', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL(env.GATEWAY_URL), {
    requestInit: { headers: { Authorization: `Bearer ${issued.token}` } },
    fetch: async (input, init) => gateway.fetch(new Request(input, init), env),
  });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.some((t) => t.name === 'github_list_issues'));
    assert.ok(tools.some((t) => t.name === 'linear_search_issues'));
    assert.ok(!tools.some((t) => t.name.includes('create_issue')));
    for (const name of ['github_list_issues', 'linear_search_issues']) {
      const result = await client.callTool({ name, arguments: { query: 'auth' } });
      assert.equal(result.isError, undefined);
      assert.ok(JSON.stringify(result).includes('auth'));
    }
    assert.equal((await all(db, "SELECT * FROM tool_calls WHERE status='success'")).length, 2);
  } finally {
    await client.close();
  }
});
test('revoked and rotated client keys stop authenticating immediately', async () => {
  const issued = await issueClient();
  const rotated = await request(`/clients/${issued.id}/rotate`, 'POST', {});
  assert.equal(rotated.status, 200);
  assert.equal(
    (
      await gateway.fetch(
        rpcRequest(issued.token, { jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        env,
      )
    ).status,
    401,
  );
  const current = (await rotated.json()) as { token: string };
  await request(`/clients/${issued.id}`, 'DELETE', {});
  assert.equal(
    (
      await gateway.fetch(
        rpcRequest(current.token, { jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        env,
      )
    ).status,
    401,
  );
});
test('tool arguments are validated before a remote call', async () => {
  await assert.rejects(
    () => executeTool(env, 'user_demo', 'github_list_issues', { query: 123 }),
    /schema/,
  );
  assert.equal(
    (await first<{ status: string }>(db, 'SELECT status FROM tool_calls'))!.status,
    'error',
  );
});
test('denied calls are audited without leaking another user’s connection', async () => {
  await assert.rejects(
    () => executeTool(env, 'user_marie', 'gmail_search_emails', { token: 'never-log-this' }),
    /not permitted/,
  );
  const row = (await first<{ status: string; connection_id: string | null; arguments: string }>(
    db,
    'SELECT * FROM tool_calls',
  ))!;
  assert.equal(row.status, 'denied');
  assert.equal(row.connection_id, null);
  assert.ok(!row.arguments.includes('never-log-this'));
  assert.ok(row.arguments.includes('[redacted]'));
});
test('API never returns client token hashes or encrypted upstream credentials', async () => {
  const issued = await issueClient();
  await run(
    db,
    'INSERT INTO connection_credentials(connection_id,encrypted_credentials) VALUES(?,?)',
    'demo_github',
    await encrypt({ token: 'never-export-this' }, env.ENCRYPTION_KEY, 'demo_github'),
  );
  const text =
    (await (await request('/clients')).text()) + (await (await request('/connections')).text());
  assert.ok(!text.includes(issued.token));
  assert.ok(!text.includes(issued.client.credential_hash));
  assert.ok(!text.includes('encrypted_credentials'));
  assert.ok(!text.includes('never-export-this'));
});
test('registration creates a session and logout invalidates it', async () => {
  env.DEMO_MODE = 'false';
  const registration = await request('/auth/register', 'POST', {
    name: 'New person',
    email: 'codemers@apprentx.rocks',
    password: 'a-long-test-password',
  });
  assert.equal(registration.status, 200);
  const cookie = registration.headers.get('set-cookie')!.split(';')[0];
  assert.ok(cookie.startsWith('mack_session='));
  assert.equal((await request('/session', 'GET', undefined, { cookie })).status, 200);
  await request('/auth/logout', 'POST', {}, { cookie });
  assert.equal((await request('/session', 'GET', undefined, { cookie })).status, 401);
  const login = await request('/auth/login', 'POST', {
    email: 'codemers@apprentx.rocks',
    password: 'a-long-test-password',
  });
  assert.equal(login.status, 200);
});
test('expired sessions cannot authenticate when demo mode is disabled', async () => {
  env.DEMO_MODE = 'false';
  const value = token();
  await run(
    db,
    'INSERT INTO sessions(credential_hash,user_id,expires_at) VALUES(?,?,?)',
    await hash(value),
    'user_demo',
    Date.now() - 100,
  );
  await assert.rejects(
    () =>
      sessionUser(
        new Request('http://local', { headers: { cookie: `mack_session=${value}` } }),
        env,
      ),
    /Sign in/,
  );
});
test('invitation acceptance requires the invited email and only applies once', async () => {
  const response = await request('/workspaces/ws_apprentx/invitations', 'POST', {
    email: 'marie@example.com',
    role: 'member',
  });
  const { url } = (await response.json()) as { url: string };
  const inviteToken = new URL(url).searchParams.get('invite');
  assert.equal((await request('/invitations/accept', 'POST', { token: inviteToken })).status, 403);
  const session = token();
  await run(
    db,
    'INSERT INTO sessions(credential_hash,user_id,expires_at) VALUES(?,?,?)',
    await hash(session),
    'user_marie',
    Date.now() + 10000,
  );
  assert.equal(
    (
      await request(
        '/invitations/accept',
        'POST',
        { token: inviteToken },
        { cookie: `mack_session=${session}` },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        '/invitations/accept',
        'POST',
        { token: inviteToken },
        { cookie: `mack_session=${session}` },
      )
    ).status,
    403,
  );
});
test('team grant cannot refer to a personal connection', async () => {
  const response = await request('/workspaces/ws_apprentx/permissions', 'PUT', {
    connection_id: 'demo_gmail',
    subject_type: 'team',
    subject_id: 'team_engineering',
    permission: 'read',
  });
  assert.equal(response.status, 400);
});
test('rate limit uses an atomic counter and rejects excess requests', async () => {
  await rateLimit(db, 'test-limit', 2);
  await rateLimit(db, 'test-limit', 2);
  await assert.rejects(() => rateLimit(db, 'test-limit', 2), /Too many/);
});
test('database batches roll back partial mutations', async () => {
  await assert.rejects(() =>
    db.batch([
      db.prepare(
        "INSERT INTO users(id,email,name) VALUES('rollback','rollback@example.com','Rollback')",
      ),
      db.prepare(
        "INSERT INTO users(id,email,name) VALUES('rollback','duplicate@example.com','Duplicate')",
      ),
    ]),
  );
  assert.equal(await first(db, "SELECT id FROM users WHERE id='rollback'"), null);
});
test('deleting a connection removes its tools and permission grants', async () => {
  await issueClient();
  const response = await request('/connections/demo_github', 'DELETE', {});
  assert.equal(response.status, 200);
  assert.equal((await all(db, "SELECT * FROM tools WHERE connection_id='demo_github'")).length, 0);
  assert.equal(
    (await all(db, "SELECT * FROM permissions WHERE connection_id='demo_github'")).length,
    0,
  );
});

test('pending reviews cannot be bypassed by toggles or owner/client access', async () => {
  const t = await tool();
  await run(db, "UPDATE tools SET review_state='pending' WHERE id=?", t.id);
  assert.equal((await request(`/tools/${t.id}`, 'PATCH', { enabled: true })).status, 409);
  assert.equal(await canUse(db, 'user_demo', await conn(), await tool()), false);
  await assert.rejects(() => executeTool(env, 'user_demo', t.public_name, {}));
});
test('review records evidence, respects grants, and rejects stale definitions', async () => {
  const t = await tool();
  const review = {
    definition_hash: t.definition_hash,
    risk_level: 'write',
    note: 'Verified against upstream implementation.',
    enabled: true,
  };
  assert.equal(
    (await request(`/tools/${t.id}/review`, 'POST', { ...review, definition_hash: 'stale' }))
      .status,
    409,
  );
  assert.equal((await request(`/tools/${t.id}/review`, 'POST', review)).status, 200);
  assert.equal(await canUse(db, 'user_marie', await conn(), await tool()), false);
  assert.equal((await all(db, 'SELECT * FROM tool_reviews WHERE tool_id=?', t.id)).length, 1);
  const discovery = await discover(env, await conn());
  await saveDiscovery(env, await conn(), discovery);
  assert.equal((await tool()).risk_level, 'write');
  discovery.tools.find((x) => x.name === t.remote_name)!.description += ' Changed behavior';
  await saveDiscovery(env, await conn(), discovery);
  assert.equal((await tool()).review_state, 'pending');
  assert.equal((await tool()).enabled, 0);
  assert.equal((await request(`/tools/${t.id}/review`, 'POST', review)).status, 409);
});
test('hard destructive floor cannot be downgraded by review', async () => {
  const t = (await all<Tool>(db, "SELECT * FROM tools WHERE risk_floor='admin'"))[0];
  assert.equal(
    (
      await request(`/tools/${t.id}/review`, 'POST', {
        definition_hash: t.definition_hash,
        risk_level: 'read',
        note: 'Looks safe according to metadata.',
        enabled: true,
      })
    ).status,
    400,
  );
});
test('workspace members cannot approve tools', async () => {
  const value = token();
  await run(
    db,
    'INSERT INTO sessions(credential_hash,user_id,expires_at) VALUES(?,?,?)',
    await hash(value),
    'user_marie',
    Date.now() + 60000,
  );
  const t = await tool();
  const response = await request(
    `/tools/${t.id}/review`,
    'POST',
    {
      definition_hash: t.definition_hash,
      risk_level: 'read',
      note: 'Attempted member review.',
      enabled: true,
    },
    { cookie: `mack_session=${value}` },
  );
  assert.equal(response.status, 404);
  assert.equal((await all(db, 'SELECT * FROM tool_reviews')).length, 0);
});

test('registration rejects other addresses without creating accounts or sessions', async () => {
  env.DEMO_MODE = 'false';
  for (const email of [
    'other@apprentx.rocks',
    'codemers@example.com',
    'codemers+test@apprentx.rocks',
  ]) {
    const response = await request('/auth/register', 'POST', {
      email,
      password: 'a-long-test-password',
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(await first(db, 'SELECT id FROM users WHERE email=?', email), null);
  }
});
test('registration normalizes casing for the single allowed address', async () => {
  env.DEMO_MODE = 'false';
  const response = await request('/auth/register', 'POST', {
    email: 'Codemers@Apprentx.Rocks',
    password: 'a-long-test-password',
  });
  assert.equal(response.status, 200);
  assert.ok(await first(db, 'SELECT id FROM users WHERE email=?', 'codemers@apprentx.rocks'));
});

test('MCP transport uses Worker-compatible redirects and never follows upstream redirects', async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (_input, init) => {
      calls++;
      assert.equal(init?.redirect, 'manual');
      return new Response(null, { status: 307, headers: { location: 'https://evil.test/mcp' } });
    };
    await assert.rejects(
      () =>
        withRemote(
          env,
          { id: 'test', server_url: 'https://mcp.linear.app/mcp', auth_type: 'none' },
          async () => {},
        ),
      /redirect/i,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previous;
  }
});

test('2020-12 remote schemas validate before execution and reject extra arguments', async () => {
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
    additionalProperties: false,
  };
  await run(
    db,
    'UPDATE tools SET input_schema=? WHERE public_name=?',
    JSON.stringify(schema),
    'github_list_issues',
  );
  const result = await executeTool(env, 'user_demo', 'github_list_issues', { query: 'test' });
  assert.notEqual(result.isError, true);
  for (const args of [{ query: 'test', extra: true }, { query: 123 }, {}]) {
    await assert.rejects(
      () => executeTool(env, 'user_demo', 'github_list_issues', args),
      /Arguments do not match/,
    );
  }
});
