import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { LocalDatabase } from '../scripts/database';
import { fixtureFetch } from '../scripts/fixtures';
import api from '../apps/api/src/index';
import { all, first, run, type Env } from '../packages/db/src/index';
import { decrypt, encrypt, hash, token } from '../packages/crypto/src/index';
import {
  beginOAuth,
  assertOAuthUrl,
  refreshCredentials,
  type OAuthCredentials,
} from '../packages/oauth/src/index';
import type { Tool, Connection } from '../packages/shared/src/index';
import { canUse } from '../packages/permissions/src/index';
let db: LocalDatabase, env: Env;
const originalFetch = globalThis.fetch;
let exchanges: number, refreshes: number, failToken: boolean, verifier: string;
beforeEach(async () => {
  db = new LocalDatabase();
  env = {
    DB: db,
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    WEB_ORIGIN: 'https://mack.test',
    GATEWAY_URL: 'https://gateway.test/mcp',
    DEMO_MODE: 'true',
  };
  await run(
    db,
    "INSERT INTO users(id,email,name) VALUES('user_demo','codemers@apprentx.rocks','Test'),('other','other@example.com','Other')",
  );
  exchanges = 0;
  refreshes = 0;
  failToken = false;
  verifier = '';
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const host = url.origin;
    if (url.pathname.includes('oauth-protected-resource'))
      return Response.json({ resource: host + '/mcp', authorization_servers: [host] });
    if (url.pathname.includes('oauth-authorization-server'))
      return Response.json({
        issuer: host,
        authorization_endpoint: host + '/authorize',
        token_endpoint: host + '/token',
        registration_endpoint: host + '/register',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
        scopes_supported: [
          'read',
          'write',
          'default',
          'repo',
          'read:org',
          'search:read.public',
          'channels:history',
          'channels:read',
          'users:read',
        ],
      });
    if (url.pathname === '/register')
      return Response.json(
        { ...((await req.json()) as object), client_id: 'test-client' },
        { status: 201 },
      );
    if (url.pathname === '/token') {
      const params = new URLSearchParams(await req.text());
      if (params.get('grant_type') === 'refresh_token') refreshes++;
      else {
        exchanges++;
        verifier = params.get('code_verifier') || '';
        assert.ok(verifier.length >= 43);
        assert.equal(params.get('redirect_uri'), 'https://mack.test/api/oauth/callback');
      }
      if (failToken) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      return Response.json({
        access_token: 'private-access-token',
        token_type: 'Bearer',
        refresh_token: 'private-refresh-token',
        expires_in: 3600,
        scope: 'read',
      });
    }
    if (url.pathname === '/mcp' && req.method === 'GET')
      return new Response('', {
        status: 401,
        headers: {
          'WWW-Authenticate': `Bearer resource_metadata="${host}/.well-known/oauth-protected-resource"`,
        },
      });
    if (url.pathname === '/mcp')
      return fixtureFetch(new Request('http://127.0.0.1:8790/linear/mcp', req));
    throw new Error('Unexpected network request');
  };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  db.close();
});
const request = (
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  api.fetch(
    new Request('https://mack.test/api' + path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    env,
  );
async function start() {
  const response = await request('/oauth/start', 'POST', {
    name: 'Linear OAuth',
    provider: 'linear',
    server_url: 'https://mcp.linear.app/mcp',
    scope: 'personal',
  });
  assert.equal(response.status, 200);
  const result = (await response.json()) as { url: string };
  return new URL(result.url);
}
async function finish(url: URL) {
  return request('/oauth/callback?state=' + url.searchParams.get('state') + '&code=test-code');
}
test('OAuth PKCE callback stores encrypted tokens, discovers blocked tools and consumes state once', async () => {
  const url = await start();
  assert.equal(url.searchParams.get('scope'), 'read');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  const pending = await first<{ encrypted_payload: string }>(
    db,
    'SELECT encrypted_payload FROM oauth_requests',
  );
  assert.ok(pending);
  assert.ok(!pending.encrypted_payload.includes('test-client'));
  const response = await finish(url);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'https://mack.test/?oauth=connected#connections');
  assert.equal(
    (await hash(verifier)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''),
    url.searchParams.get('code_challenge'),
  );
  const connection = (await all<Connection>(db, 'SELECT * FROM connections'))[0];
  assert.equal(connection.oauth_provider, 'mcp.linear.app');
  const tools = await all<Tool>(db, 'SELECT * FROM tools');
  assert.ok(tools.length > 0);
  assert.ok(tools.every((t) => t.enabled === 0 && t.review_state === 'pending'));
  assert.equal(await canUse(db, 'user_demo', connection, tools[0]), false);
  const row = (await first<{ encrypted_credentials: string }>(
    db,
    'SELECT encrypted_credentials FROM connection_credentials',
  ))!;
  assert.ok(!row.encrypted_credentials.includes('private-access-token'));
  assert.ok(!(await (await request('/connections')).text()).includes('private-refresh-token'));
  assert.equal((await finish(url)).status, 400);
  assert.equal(exchanges, 1);
});
test('wrong users and expired requests cannot exchange authorization codes', async () => {
  const url = await start();
  const session = token();
  await run(
    db,
    'INSERT INTO sessions(credential_hash,user_id,expires_at) VALUES(?,?,?)',
    await hash(session),
    'other',
    Date.now() + 60000,
  );
  assert.equal(
    (
      await request(
        '/oauth/callback?state=' + url.searchParams.get('state') + '&code=x',
        'GET',
        undefined,
        { cookie: `mack_session=${session}` },
      )
    ).status,
    400,
  );
  await run(db, 'UPDATE oauth_requests SET expires_at=0');
  assert.equal((await finish(url)).status, 400);
  assert.equal(exchanges, 0);
});
test('consent denial and token errors create no connections', async () => {
  let url = await start();
  let response = await request(
    '/oauth/callback?state=' + url.searchParams.get('state') + '&error=access_denied',
  );
  assert.ok(response.headers.get('location')?.includes('cancelled'));
  url = await start();
  failToken = true;
  response = await finish(url);
  assert.ok(response.headers.get('location')?.includes('failed'));
  assert.equal((await all(db, 'SELECT * FROM connections')).length, 0);
});
test('untrusted OAuth endpoints and issuer substitution are rejected', async () => {
  for (const target of [
    'http://mcp.linear.app/token',
    'https://127.0.0.1/token',
    'https://github.com/token',
    'https://mcp.linear.app@evil.test/token',
  ])
    assert.throws(() => assertOAuthUrl(env, 'https://mcp.linear.app/mcp', target));
  const url = await start();
  const response = await request(
    '/oauth/callback?state=' + url.searchParams.get('state') + '&code=x&iss=https://evil.test',
  );
  assert.ok(response.headers.get('location')?.includes('failed'));
  assert.equal(exchanges, 0);
});
test('GitHub and Slack require configured apps, Notion dynamically registers', async () => {
  for (const host of ['api.githubcopilot.com', 'mcp.slack.com'])
    await assert.rejects(() => beginOAuth(env, `https://${host}/mcp`), /registered OAuth app/);
  env.OAUTH_CLIENTS_JSON = JSON.stringify({
    'api.githubcopilot.com': { client_id: 'github-app', client_secret: 'private-app-secret' },
    'mcp.slack.com': { client_id: 'slack-app', client_secret: 'private-app-secret' },
  });
  for (const host of ['api.githubcopilot.com', 'mcp.slack.com']) {
    const flow = await beginOAuth(env, `https://${host}/mcp`);
    assert.ok(!flow.url.includes('private-app-secret'));
    assert.ok(flow.payload.client.client_secret);
  }
  assert.equal((await beginOAuth(env, 'https://mcp.notion.com/mcp')).payload.scope, 'default');
});
test('expired tokens refresh once and rotation stays encrypted', async () => {
  await finish(await start());
  const c = (await all<Connection>(db, 'SELECT * FROM connections'))[0];
  const row = (await first<{ encrypted_credentials: string }>(
    db,
    'SELECT encrypted_credentials FROM connection_credentials',
  ))!;
  const credentials = await decrypt<OAuthCredentials>(
    row.encrypted_credentials,
    env.ENCRYPTION_KEY,
    c.id,
  );
  credentials.oauth.expiresAt = Date.now() - 1000;
  await run(
    db,
    'UPDATE connection_credentials SET encrypted_credentials=? WHERE connection_id=?',
    await encrypt(credentials, env.ENCRYPTION_KEY, c.id),
    c.id,
  );
  const next = await refreshCredentials(env, c.id, credentials);
  assert.ok(next.oauth.expiresAt! > Date.now());
  assert.equal(refreshes, 1);
  await refreshCredentials(env, c.id, credentials);
  assert.equal(refreshes, 1);
  await run(
    db,
    'INSERT INTO oauth_refresh_locks(connection_id,owner,expires_at) VALUES(?,?,?)',
    c.id,
    'someone',
    Date.now() + 60000,
  );
  await assert.rejects(() => refreshCredentials(env, c.id, credentials), /refreshing/);
  assert.equal(refreshes, 1);
});

test('GitHub scopes may come from resource metadata instead of issuer metadata', async () => {
  const mock = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const response = await mock(input, init);
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('oauth-protected-resource')) {
      const body = (await response.json()) as object;
      return Response.json({ ...body, scopes_supported: ['repo', 'read:org'] });
    }
    if (url.includes('oauth-authorization-server')) {
      const body = (await response.json()) as object;
      return Response.json({ ...body, scopes_supported: ['offline_access'] });
    }
    return response;
  };
  env.OAUTH_CLIENTS_JSON = JSON.stringify({
    'api.githubcopilot.com': { client_id: 'test', client_secret: 'secret' },
  });
  assert.equal(
    (await beginOAuth(env, 'https://api.githubcopilot.com/mcp')).payload.scope,
    'repo read:org',
  );
});
test('Slack user token responses are usable as bearer credentials', async () => {
  const mock = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const response = await mock(input, init);
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.pathname === '/token') {
      const body = (await response.json()) as object;
      return Response.json({ ...body, ok: true, token_type: 'user' });
    }
    return response;
  };
  env.OAUTH_CLIENTS_JSON = JSON.stringify({
    'mcp.slack.com': { client_id: 'test', client_secret: 'secret' },
  });
  const response = await request('/oauth/start', 'POST', {
    name: 'Slack',
    provider: 'slack',
    server_url: 'https://mcp.slack.com/mcp',
    scope: 'personal',
  });
  assert.equal(response.status, 200);
  const { url } = (await response.json()) as { url: string };
  assert.ok((await finish(new URL(url))).headers.get('location')?.includes('connected'));
});
test('workspace authorization is rechecked after OAuth consent', async () => {
  await run(
    db,
    "INSERT INTO workspaces(id,name,slug,created_by) VALUES('ws','Test','test','user_demo')",
  );
  await run(
    db,
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES('ws','user_demo','admin')",
  );
  const response = await request('/oauth/start', 'POST', {
    name: 'Linear',
    provider: 'linear',
    server_url: 'https://mcp.linear.app/mcp',
    scope: 'workspace',
    workspace_id: 'ws',
  });
  assert.equal(response.status, 200);
  const { url } = (await response.json()) as { url: string };
  await run(db, "DELETE FROM workspace_members WHERE workspace_id='ws'");
  assert.equal((await finish(new URL(url))).status, 403);
  assert.equal(exchanges, 0);
});
