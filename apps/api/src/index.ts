import {
  beginOAuth,
  oauthScopeOptions,
  completeOAuth,
  stateKey,
  providers as oauthProviders,
  type OAuthState,
} from '../../../packages/oauth/src/index';
import {
  approveIncomingAuthorization,
  denyIncomingAuthorization,
  incomingAuthorizationDetails,
} from '../../../packages/oauth-server/src/index';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { all, first, run, type Env } from '../../../packages/db/src/index';
import { sessionUser, checkOrigin, rateLimit } from '../../../packages/auth/src/index';
import {
  token,
  hash,
  passwordHash,
  checkPassword,
  encrypt,
  decrypt,
} from '../../../packages/crypto/src/index';
import {
  visibleConnections,
  canManage,
  canUse,
  requireManager,
  role,
  availableTools,
} from '../../../packages/permissions/src/index';
import { discover, saveDiscovery, namespace } from '../../../packages/tool-registry/src/index';
import { validateServerUrl } from '../../../packages/mcp/src/index';
import {
  HttpError,
  id,
  type User,
  type Connection,
  type Tool,
  type Client,
  type Grant,
} from '../../../packages/shared/src/index';
import { executeTool } from '../../gateway/src/service';
const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();
const nameSchema = z.string().trim().min(1).max(80);
const permissionSchema = z.enum(['none', 'read', 'write', 'admin']);
app.use('*', bodyLimit({ maxSize: 1024 * 1024 }));
app.use('*', async (c, next) => {
  checkOrigin(c.req.raw, c.env);
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  if (
    !['GET', 'HEAD'].includes(c.req.method) &&
    !c.req.header('content-type')?.startsWith('application/json')
  )
    throw new HttpError(415, 'Send an application/json body.');
  await next();
});
app.onError((error, c) => {
  if (error instanceof HttpError) return c.json({ error: error.message }, error.status as 400);
  if (error instanceof z.ZodError)
    return c.json(
      { error: error.issues.map((i) => `${i.path.join('.') || 'Input'}: ${i.message}`).join('; ') },
      400,
    );
  if (error instanceof SyntaxError) return c.json({ error: 'Invalid JSON.' }, 400);
  console.error('API error:', error instanceof Error ? error.name : 'Unknown');
  return c.json({ error: 'The request could not be completed. Please try again.' }, 500);
});
app.get('/health', (c) => c.json({ service: 'mack-api', status: 'ok' }));
async function createSession(db: Env['DB'], userId: string) {
  const value = token();
  await run(
    db,
    'INSERT INTO sessions(credential_hash,user_id,expires_at) VALUES(?,?,?)',
    await hash(value),
    userId,
    Date.now() + 7 * 86400000,
  );
  return value;
}
const cookie = (value: string, env: Env, age = 604800) =>
  `mack_session=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${age}${env.WEB_ORIGIN.startsWith('https:') ? '; Secure' : ''}`;
for (const mode of ['register', 'login'] as const)
  app.post(`/api/auth/${mode}`, async (c) => {
    await rateLimit(
      c.env.DB,
      `auth-ip:${await hash(c.req.header('cf-connecting-ip') || 'local')}`,
      30,
    );
    const data = z
      .object({
        email: z
          .string()
          .email()
          .max(254)
          .transform((s) => s.toLowerCase()),
        password: z.string().min(12).max(128),
        name: nameSchema.optional(),
      })
      .parse(await c.req.json());
    if (mode === 'register' && data.email !== 'codemers@apprentx.rocks')
      throw new HttpError(403, 'Account registration is restricted.');
    await rateLimit(c.env.DB, `auth:${await hash(data.email)}`, 10);
    let user = await first<User & { password_hash: string | null }>(
      c.env.DB,
      'SELECT * FROM users WHERE email=?',
      data.email,
    );
    if (mode === 'register') {
      if (user) throw new HttpError(409, 'This account already exists. Sign in instead.');
      const userId = id('user');
      const name = data.name || data.email.split('@')[0];
      await run(
        c.env.DB,
        'INSERT INTO users(id,email,name,password_hash) VALUES(?,?,?,?)',
        userId,
        data.email,
        name,
        await passwordHash(data.password),
      );
      user = { id: userId, name, email: data.email, password_hash: null };
    } else if (!user?.password_hash || !(await checkPassword(data.password, user.password_hash)))
      throw new HttpError(401, 'Email or password is incorrect.');
    c.header('Set-Cookie', cookie(await createSession(c.env.DB, user.id), c.env));
    return c.json({ user: { id: user.id, name: user.name, email: user.email } });
  });
app.post('/api/auth/logout', async (c) => {
  const value = c.req
    .header('cookie')
    ?.split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith('mack_session='))
    ?.slice(13);
  if (value) await run(c.env.DB, 'DELETE FROM sessions WHERE credential_hash=?', await hash(value));
  c.header('Set-Cookie', cookie('', c.env, 0));
  return c.json({ ok: true });
});
app.use('/api/*', async (c, next) => {
  c.set('user', await sessionUser(c.req.raw, c.env));
  await rateLimit(c.env.DB, `api:${c.get('user').id}`, 240);
  await next();
});
app.get('/api/session', async (c) =>
  c.json({
    user: c.get('user'),
    demo: c.env.DEMO_MODE === 'true',
    gatewayUrl: c.env.GATEWAY_URL,
    workspaces: await all(
      c.env.DB,
      'SELECT w.*,m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=?',
      c.get('user').id,
    ),
  }),
);
app.get('/api/oauth/providers', async (c) => {
  let configured: Record<string, { client_id?: string; client_secret?: string }> = {};
  try {
    configured = JSON.parse(c.env.OAUTH_CLIENTS_JSON || '{}');
  } catch {}
  return c.json({
    callbackUrl: `${c.env.WEB_ORIGIN}/api/oauth/callback`,
    providers: Object.fromEntries(
      Object.entries(oauthProviders).map(([host, p]) => [
        host,
        {
          defaultScope: p.defaultScope,
          ready:
            !p.appRequired ||
            Boolean(configured[host]?.client_id && configured[host]?.client_secret),
          appRequired: Boolean(p.appRequired),
        },
      ]),
    ),
  });
});
app.post('/api/oauth/scopes', async (c) => {
  const { server_url } = z.object({ server_url: z.string().max(2048) }).parse(await c.req.json());
  validateServerUrl(server_url, c.env);
  return c.json(await oauthScopeOptions(c.env, server_url));
});
app.post('/api/oauth/start', async (c) => {
  const data = z
    .object({
      name: nameSchema,
      provider: z.string().max(30),
      server_url: z.string().max(2048),
      scope: z.enum(['personal', 'workspace']),
      workspace_id: z.string().optional(),
      oauth_scope: z.string().max(2000).optional(),
      connection_id: z.string().optional(),
    })
    .parse(await c.req.json());
  validateServerUrl(data.server_url, c.env);
  if (data.scope === 'workspace') {
    if (!data.workspace_id) throw new HttpError(400, 'Choose a workspace.');
    await requireManager(c.env.DB, data.workspace_id, c.get('user').id);
  }
  if (data.connection_id) {
    const existing = await managedConnection(c.env, data.connection_id, c.get('user').id);
    if (
      existing.server_url !== data.server_url ||
      existing.scope !== data.scope ||
      existing.workspace_id !== (data.workspace_id || null)
    )
      throw new HttpError(400, 'Reconnect must keep the same server and scope.');
  }
  await rateLimit(c.env.DB, `oauth:${c.get('user').id}`, 10);
  const flow = await beginOAuth(c.env, data.server_url, data.oauth_scope);
  const key = await stateKey(flow.state);
  await run(c.env.DB, 'DELETE FROM oauth_requests WHERE expires_at<?', Date.now());
  await run(
    c.env.DB,
    'INSERT INTO oauth_requests(state_hash,user_id,encrypted_payload,expires_at) VALUES(?,?,?,?)',
    key,
    c.get('user').id,
    await encrypt({ data, oauth: flow.payload }, c.env.ENCRYPTION_KEY, key),
    Date.now() + 10 * 60000,
  );
  return c.json({ url: flow.url });
});
app.get('/api/oauth/callback', async (c) => {
  c.header('Referrer-Policy', 'no-referrer');
  const state = c.req.query('state');
  if (!state || state.length > 256) throw new HttpError(400, 'Invalid OAuth state. Start again.');
  const key = await stateKey(state);
  const pending = await first<{ encrypted_payload: string }>(
    c.env.DB,
    'DELETE FROM oauth_requests WHERE state_hash=? AND user_id=? AND expires_at>? RETURNING encrypted_payload',
    key,
    c.get('user').id,
    Date.now(),
  );
  if (!pending) throw new HttpError(400, 'OAuth request expired or was already used. Start again.');
  const finish = (result: string) =>
    c.redirect(`${c.env.WEB_ORIGIN}/?oauth=${result}#connections`, 303);
  if (c.req.query('error')) return finish('cancelled');
  const code = c.req.query('code');
  if (!code || code.length > 8192) return finish('failed');
  const payload = await decrypt<{
    data: {
      name: string;
      provider: string;
      server_url: string;
      scope: 'personal' | 'workspace';
      workspace_id?: string;
      connection_id?: string;
    };
    oauth: OAuthState;
  }>(pending.encrypted_payload, c.env.ENCRYPTION_KEY, key);
  const { data, oauth } = payload;
  validateServerUrl(data.server_url, c.env);
  if (oauth.redirectUri !== `${c.env.WEB_ORIGIN}/api/oauth/callback`) return finish('failed');
  if (
    ((oauth.info.authorizationServerMetadata as Record<string, unknown> | undefined)
      ?.authorization_response_iss_parameter_supported &&
      !c.req.query('iss')) ||
    (c.req.query('iss') && c.req.query('iss') !== oauth.info.authorizationServerMetadata?.issuer)
  )
    return finish('failed');
  if (data.scope === 'workspace')
    await requireManager(c.env.DB, data.workspace_id!, c.get('user').id);
  if (data.connection_id) await managedConnection(c.env, data.connection_id, c.get('user').id);
  let credentials;
  try {
    credentials = await completeOAuth(c.env, oauth, code);
  } catch {
    return finish('failed');
  }
  const connectionId = data.connection_id || id('conn');
  const connection: Connection = {
    id: connectionId,
    name: data.name,
    provider: data.provider,
    server_url: data.server_url,
    scope: data.scope,
    user_id: data.scope === 'personal' ? c.get('user').id : null,
    workspace_id: data.scope === 'workspace' ? data.workspace_id! : null,
    auth_type: 'bearer',
    oauth_provider: new URL(data.server_url).hostname,
    namespace: namespace(data.name, connectionId),
    status: 'error',
    is_demo: 0,
    capabilities: '{}',
    created_at: new Date().toISOString(),
  };
  const statements = [];
  if (data.connection_id) {
    statements.push(
      c.env.DB.prepare(
        "UPDATE connections SET auth_type='bearer',oauth_provider=?,status='error' WHERE id=?",
      ).bind(connection.oauth_provider, connectionId),
    );
    statements.push(
      c.env.DB.prepare(
        "UPDATE tools SET enabled=0,review_state='pending' WHERE connection_id=?",
      ).bind(connectionId),
    );
  } else
    statements.push(
      c.env.DB.prepare(
        'INSERT INTO connections(id,scope,user_id,workspace_id,name,provider,namespace,server_url,auth_type,status,oauth_provider) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      ).bind(
        connection.id,
        connection.scope,
        connection.user_id,
        connection.workspace_id,
        connection.name,
        connection.provider,
        connection.namespace,
        connection.server_url,
        connection.auth_type,
        connection.status,
        connection.oauth_provider,
      ),
    );
  statements.push(
    c.env.DB.prepare(
      "INSERT INTO connection_credentials(connection_id,encrypted_credentials) VALUES(?,?) ON CONFLICT(connection_id) DO UPDATE SET encrypted_credentials=excluded.encrypted_credentials,updated_at=datetime('now')",
    ).bind(connectionId, await encrypt(credentials, c.env.ENCRYPTION_KEY, connectionId)),
  );
  await c.env.DB.batch(statements);
  const saved = (await first<Connection>(
    c.env.DB,
    'SELECT * FROM connections WHERE id=?',
    connectionId,
  ))!;
  try {
    await saveDiscovery(c.env, saved, await discover(c.env, saved));
  } catch {
    return finish('discovery_failed');
  }
  return finish('connected');
});
app.get('/api/oauth/incoming/:id', async (c) =>
  c.json(await incomingAuthorizationDetails(c.env, c.req.param('id'), c.get('user').id)),
);
app.post('/api/oauth/incoming/:id/deny', async (c) =>
  c.json(await denyIncomingAuthorization(c.env, c.req.param('id'))),
);
app.post('/api/oauth/incoming/:id/approve', async (c) => {
  const data = z
    .object({
      name: nameSchema.optional(),
      workspace_id: z.string().nullable().optional(),
      permissions: z
        .array(z.object({ connection_id: z.string(), permission: permissionSchema }))
        .max(100),
    })
    .parse(await c.req.json());
  return c.json(await approveIncomingAuthorization(c.env, c.req.param('id'), c.get('user'), data));
});
app.patch('/api/profile', async (c) => {
  const data = z.object({ name: nameSchema }).parse(await c.req.json());
  await run(c.env.DB, 'UPDATE users SET name=? WHERE id=?', data.name, c.get('user').id);
  return c.json({ ok: true });
});
app.post('/api/workspaces', async (c) => {
  const data = z.object({ name: nameSchema }).parse(await c.req.json());
  const workspaceId = id('ws');
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO workspaces(id,name,slug,created_by) VALUES(?,?,?,?)').bind(
      workspaceId,
      data.name,
      namespace(data.name, workspaceId),
      c.get('user').id,
    ),
    c.env.DB.prepare(
      "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(?,?,'owner')",
    ).bind(workspaceId, c.get('user').id),
  ]);
  return c.json({ id: workspaceId }, 201);
});
app.get('/api/connections', async (c) => {
  const rows = await visibleConnections(c.env.DB, c.get('user').id);
  const result = [];
  for (const connection of rows) {
    const manage = await canManage(c.env.DB, connection, c.get('user').id);
    const tools = await all<Tool>(
      c.env.DB,
      'SELECT * FROM tools WHERE connection_id=? ORDER BY risk_level,remote_name',
      connection.id,
    );
    const visible = [];
    for (const t of tools)
      if (manage || (await canUse(c.env.DB, c.get('user').id, connection, t))) visible.push(t);
    if (manage || visible.length) result.push({ ...connection, tools: visible, canManage: manage });
  }
  return c.json({ connections: result });
});
app.post('/api/connections', async (c) => {
  const data = z
    .object({
      name: nameSchema,
      provider: z.string().max(30).default('custom'),
      scope: z.enum(['personal', 'workspace']),
      workspace_id: z.string().optional(),
      server_url: z.string().max(2048),
      auth_type: z.enum(['none', 'bearer', 'api_key']),
      token: z.string().max(8192).optional(),
      header: z
        .string()
        .regex(/^X-[a-zA-Z0-9-]+$/i)
        .max(80)
        .optional(),
    })
    .parse(await c.req.json());
  validateServerUrl(data.server_url, c.env);
  if (data.scope === 'workspace') {
    if (!data.workspace_id) throw new HttpError(400, 'Choose a workspace.');
    await requireManager(c.env.DB, data.workspace_id, c.get('user').id);
  }
  if (data.auth_type !== 'none' && !data.token?.trim())
    throw new HttpError(400, 'Enter credentials for this connection.');
  const connectionId = id('conn');
  const connection: Connection = {
    id: connectionId,
    name: data.name,
    namespace: namespace(data.name, connectionId),
    provider: data.provider,
    scope: data.scope,
    user_id: data.scope === 'personal' ? c.get('user').id : null,
    workspace_id: data.scope === 'workspace' ? data.workspace_id! : null,
    server_url: data.server_url,
    auth_type: data.auth_type,
    status: 'connected',
    is_demo: 0,
    capabilities: '{}',
    created_at: new Date().toISOString(),
  };
  const credentials =
    data.auth_type !== 'none'
      ? { token: data.token!, header: data.header || 'X-API-Key' }
      : undefined;
  let discovery;
  try {
    discovery = await discover(c.env, connection, credentials);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(
      502,
      'Could not discover this MCP server. Check its URL and authentication.',
    );
  }
  const statements = [
    c.env.DB.prepare(
      'INSERT INTO connections(id,scope,user_id,workspace_id,name,provider,namespace,server_url,auth_type,status) VALUES(?,?,?,?,?,?,?,?,?,?)',
    ).bind(
      connection.id,
      connection.scope,
      connection.user_id,
      connection.workspace_id,
      connection.name,
      connection.provider,
      connection.namespace,
      connection.server_url,
      connection.auth_type,
      connection.status,
    ),
  ];
  if (credentials)
    statements.push(
      c.env.DB.prepare(
        'INSERT INTO connection_credentials(connection_id,encrypted_credentials) VALUES(?,?)',
      ).bind(connection.id, await encrypt(credentials, c.env.ENCRYPTION_KEY, connection.id)),
    );
  await c.env.DB.batch(statements);
  try {
    await saveDiscovery(c.env, connection, discovery);
  } catch (e) {
    await run(c.env.DB, 'DELETE FROM connections WHERE id=?', connection.id);
    throw e;
  }
  return c.json({ id: connection.id }, 201);
});
async function managedConnection(env: Env, connectionId: string, userId: string) {
  const connection = await first<Connection>(
    env.DB,
    'SELECT * FROM connections WHERE id=?',
    connectionId,
  );
  if (!connection || !(await canManage(env.DB, connection, userId)))
    throw new HttpError(404, 'Connection not found.');
  return connection;
}
app.post('/api/connections/:id/sync', async (c) => {
  const connection = await managedConnection(c.env, c.req.param('id'), c.get('user').id);
  try {
    await saveDiscovery(c.env, connection, await discover(c.env, connection));
  } catch {
    await run(c.env.DB, "UPDATE connections SET status='error' WHERE id=?", connection.id);
    throw new HttpError(502, 'Discovery failed. Check the server and update its credentials.');
  }
  return c.json({ ok: true });
});
app.patch('/api/connections/:id', async (c) => {
  const connection = await managedConnection(c.env, c.req.param('id'), c.get('user').id);
  const data = z
    .object({
      status: z.enum(['connected', 'paused']).optional(),
      name: nameSchema.optional(),
      token: z.string().min(1).max(8192).optional(),
      header: z
        .string()
        .regex(/^X-[a-zA-Z0-9-]+$/i)
        .max(80)
        .optional(),
    })
    .parse(await c.req.json());
  if (data.token) {
    if (connection.oauth_provider)
      throw new HttpError(400, 'Use OAuth reconnect to update this connection.');
    if (connection.auth_type === 'none')
      throw new HttpError(400, 'This server does not use credentials.');
    await run(
      c.env.DB,
      "INSERT INTO connection_credentials(connection_id,encrypted_credentials) VALUES(?,?) ON CONFLICT(connection_id) DO UPDATE SET encrypted_credentials=excluded.encrypted_credentials,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
      connection.id,
      await encrypt(
        { token: data.token, header: data.header || 'X-API-Key' },
        c.env.ENCRYPTION_KEY,
        connection.id,
      ),
    );
  }
  if (data.status)
    await run(c.env.DB, 'UPDATE connections SET status=? WHERE id=?', data.status, connection.id);
  if (data.name)
    await run(c.env.DB, 'UPDATE connections SET name=? WHERE id=?', data.name, connection.id);
  return c.json({ ok: true });
});
app.delete('/api/connections/:id', async (c) => {
  const connection = await managedConnection(c.env, c.req.param('id'), c.get('user').id);
  await run(c.env.DB, 'DELETE FROM connections WHERE id=?', connection.id);
  return c.json({ ok: true });
});
app.patch('/api/tools/:id', async (c) => {
  const t = await first<Tool>(c.env.DB, 'SELECT * FROM tools WHERE id=?', c.req.param('id'));
  if (!t) throw new HttpError(404, 'Tool not found.');
  await managedConnection(c.env, t.connection_id, c.get('user').id);
  const data = z.object({ enabled: z.boolean() }).parse(await c.req.json());
  if (data.enabled && t.review_state !== 'reviewed')
    throw new HttpError(409, 'Review this tool before enabling it.');
  await run(
    c.env.DB,
    "UPDATE tools SET enabled=? WHERE id=? AND review_state='reviewed'",
    Number(data.enabled),
    t.id,
  );
  return c.json({ ok: true });
});
app.post('/api/tools/:id/review', async (c) => {
  const t = await first<Tool>(c.env.DB, 'SELECT * FROM tools WHERE id=?', c.req.param('id'));
  if (!t) throw new HttpError(404, 'Tool not found.');
  await managedConnection(c.env, t.connection_id, c.get('user').id);
  const data = z
    .object({
      definition_hash: z.string().min(1),
      risk_level: z.enum(['read', 'write', 'admin']),
      note: z.string().trim().min(10).max(2000),
      enabled: z.boolean(),
    })
    .parse(await c.req.json());
  if (data.definition_hash !== t.definition_hash)
    throw new HttpError(409, 'Tool definition changed. Refresh and review again.');
  if (t.risk_floor === 'admin' && data.risk_level !== 'admin')
    throw new HttpError(400, 'Destructive or execution tools require admin access.');
  const reviewId = id('review');
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO tool_reviews(id,tool_id,definition_hash,reviewer_id,risk_level,note) SELECT ?,id,definition_hash,?,?,? FROM tools WHERE id=? AND definition_hash=?',
    ).bind(reviewId, c.get('user').id, data.risk_level, data.note, t.id, data.definition_hash),
    c.env.DB.prepare(
      "UPDATE tools SET risk_level=?,review_state='reviewed',enabled=?,reviewed_by=?,reviewed_at=datetime('now'),review_note=? WHERE id=? AND definition_hash=?",
    ).bind(
      data.risk_level,
      Number(data.enabled),
      c.get('user').id,
      data.note,
      t.id,
      data.definition_hash,
    ),
  ]);
  if (!(await first(c.env.DB, 'SELECT id FROM tool_reviews WHERE id=?', reviewId)))
    throw new HttpError(409, 'Tool definition changed. Refresh and review again.');
  return c.json({ ok: true });
});
app.get('/api/clients', async (c) =>
  c.json({
    clients: await all(
      c.env.DB,
      'SELECT id,user_id,workspace_id,name,type,token_prefix,last_used_at,revoked_at,created_at,oauth_client_id FROM clients WHERE user_id=? ORDER BY created_at DESC',
      c.get('user').id,
    ),
    permissions: await all(
      c.env.DB,
      "SELECT p.* FROM permissions p JOIN clients c ON c.id=p.subject_id WHERE p.subject_type='client' AND c.user_id=?",
      c.get('user').id,
    ),
  }),
);
app.post('/api/clients', async (c) => {
  const data = z
    .object({
      name: nameSchema,
      type: z.enum(['claude', 'chatgpt', 'cursor', 'windsurf', 'custom']),
      workspace_id: z.string().nullable().optional(),
      permissions: z
        .array(z.object({ connection_id: z.string(), permission: permissionSchema }))
        .max(100),
    })
    .parse(await c.req.json());
  if (data.workspace_id && !(await role(c.env.DB, data.workspace_id, c.get('user').id)))
    throw new HttpError(403, 'Workspace access is required.');
  const visible = await visibleConnections(c.env.DB, c.get('user').id, data.workspace_id);
  const unique = new Set<string>();
  for (const grant of data.permissions) {
    const conn = visible.find((x) => x.id === grant.connection_id);
    if (!conn || (conn.scope === 'workspace' && conn.workspace_id !== data.workspace_id))
      throw new HttpError(403, 'This connection is not available to the client.');
    if (unique.has(grant.connection_id)) throw new HttpError(400, 'Duplicate connection grant.');
    unique.add(grant.connection_id);
  }
  const value = token();
  const clientId = id('client');
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO clients(id,user_id,workspace_id,name,type,credential_hash,token_prefix) VALUES(?,?,?,?,?,?,?)',
    ).bind(
      clientId,
      c.get('user').id,
      data.workspace_id || null,
      data.name,
      data.type,
      await hash(value),
      value.slice(0, 13),
    ),
    ...data.permissions.map((g) =>
      c.env.DB.prepare(
        "INSERT INTO permissions(id,workspace_id,connection_id,subject_type,subject_id,permission) VALUES(?,?,?,'client',?,?)",
      ).bind(id('grant'), data.workspace_id || null, g.connection_id, clientId, g.permission),
    ),
  ]);
  return c.json({ id: clientId, token: value, endpoint: c.env.GATEWAY_URL }, 201);
});
async function ownedClient(env: Env, clientId: string, userId: string) {
  const client = await first<Client>(
    env.DB,
    'SELECT * FROM clients WHERE id=? AND user_id=? AND revoked_at IS NULL',
    clientId,
    userId,
  );
  if (!client) throw new HttpError(404, 'Client not found.');
  return client;
}
app.post('/api/clients/:id/rotate', async (c) => {
  const client = await ownedClient(c.env, c.req.param('id'), c.get('user').id);
  if (client.oauth_client_id)
    throw new HttpError(
      400,
      'OAuth clients refresh through the connected app. Revoke this client to disconnect it.',
    );
  const value = token();
  await run(
    c.env.DB,
    'UPDATE clients SET credential_hash=?,token_prefix=? WHERE id=?',
    await hash(value),
    value.slice(0, 13),
    client.id,
  );
  return c.json({ token: value, endpoint: c.env.GATEWAY_URL });
});
app.delete('/api/clients/:id', async (c) => {
  const client = await ownedClient(c.env, c.req.param('id'), c.get('user').id);
  await run(
    c.env.DB,
    "UPDATE clients SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
    client.id,
  );
  return c.json({ ok: true });
});
app.put('/api/clients/:id/permissions', async (c) => {
  const client = await ownedClient(c.env, c.req.param('id'), c.get('user').id);
  const data = z
    .object({ connection_id: z.string(), permission: permissionSchema })
    .parse(await c.req.json());
  const connection = (
    await visibleConnections(c.env.DB, c.get('user').id, client.workspace_id)
  ).find((x) => x.id === data.connection_id);
  if (
    !connection ||
    (connection.scope === 'workspace' && connection.workspace_id !== client.workspace_id)
  )
    throw new HttpError(403, 'Connection unavailable.');
  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM permissions WHERE subject_type='client' AND subject_id=? AND connection_id=? AND tool_id IS NULL",
    ).bind(client.id, data.connection_id),
    c.env.DB.prepare(
      "INSERT INTO permissions(id,workspace_id,connection_id,subject_type,subject_id,permission) VALUES(?,?,?,'client',?,?)",
    ).bind(id('grant'), client.workspace_id, data.connection_id, client.id, data.permission),
  ]);
  return c.json({ ok: true });
});
app.get('/api/activity', async (c) => {
  const workspace = c.req.query('workspace');
  if (workspace) await requireManager(c.env.DB, workspace, c.get('user').id);
  return c.json({
    activity: await all(
      c.env.DB,
      `SELECT tc.*,u.name AS user_name FROM tool_calls tc JOIN users u ON u.id=tc.user_id WHERE ${workspace ? 'tc.workspace_id=?' : 'tc.user_id=?'} ORDER BY tc.created_at DESC LIMIT 200`,
      workspace || c.get('user').id,
    ),
  });
});
app.get('/api/playground/tools', async (c) =>
  c.json({ tools: await availableTools(c.env.DB, c.get('user').id) }),
);
app.post('/api/playground/call', async (c) => {
  const data = z
    .object({ name: z.string().max(128), arguments: z.record(z.unknown()) })
    .parse(await c.req.json());
  return c.json(await executeTool(c.env, c.get('user').id, data.name, data.arguments));
});
app.get('/api/workspaces/:id/members', async (c) => {
  const workspace = c.req.param('id');
  if (!(await role(c.env.DB, workspace, c.get('user').id)))
    throw new HttpError(403, 'Workspace access required.');
  return c.json({
    members: await all(
      c.env.DB,
      'SELECT u.id,u.name,u.email,m.role FROM users u JOIN workspace_members m ON u.id=m.user_id WHERE m.workspace_id=?',
      workspace,
    ),
    teams: await all(c.env.DB, 'SELECT * FROM teams WHERE workspace_id=?', workspace),
    teamMembers: await all(
      c.env.DB,
      'SELECT tm.* FROM team_members tm JOIN teams t ON t.id=tm.team_id WHERE t.workspace_id=?',
      workspace,
    ),
    invitations: await all(
      c.env.DB,
      'SELECT id,email,role,expires_at FROM invitations WHERE workspace_id=? AND accepted_at IS NULL AND expires_at>?',
      workspace,
      Date.now(),
    ),
    permissions: await all(
      c.env.DB,
      "SELECT * FROM permissions WHERE workspace_id=? AND subject_type IN ('user','team')",
      workspace,
    ),
  });
});
app.post('/api/workspaces/:id/invitations', async (c) => {
  const workspace = c.req.param('id');
  await requireManager(c.env.DB, workspace, c.get('user').id);
  const data = z
    .object({
      email: z
        .string()
        .email()
        .transform((s) => s.toLowerCase()),
      role: z.enum(['member', 'admin']),
    })
    .parse(await c.req.json());
  if (data.role === 'admin' && (await role(c.env.DB, workspace, c.get('user').id)) !== 'owner')
    throw new HttpError(403, 'Only the owner can invite admins.');
  const value = token();
  await run(
    c.env.DB,
    'INSERT INTO invitations(id,workspace_id,email,role,token_hash,expires_at) VALUES(?,?,?,?,?,?)',
    id('invite'),
    workspace,
    data.email,
    data.role,
    await hash(value),
    Date.now() + 7 * 86400000,
  );
  return c.json({ url: `${c.env.WEB_ORIGIN}/?invite=${encodeURIComponent(value)}` }, 201);
});
app.post('/api/invitations/accept', async (c) => {
  const data = z.object({ token: z.string() }).parse(await c.req.json());
  const invite = await first<{ id: string; email: string; workspace_id: string; role: string }>(
    c.env.DB,
    'SELECT * FROM invitations WHERE token_hash=? AND expires_at>? AND accepted_at IS NULL',
    await hash(data.token),
    Date.now(),
  );
  if (!invite || invite.email !== c.get('user').email)
    throw new HttpError(403, 'This invitation is expired or belongs to another email.');
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(?,?,?) ON CONFLICT(workspace_id,user_id) DO NOTHING',
    ).bind(invite.workspace_id, c.get('user').id, invite.role),
    c.env.DB.prepare(
      "UPDATE invitations SET accepted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
    ).bind(invite.id),
  ]);
  return c.json({ ok: true });
});
app.delete('/api/workspaces/:workspace/members/:user', async (c) => {
  const workspace = c.req.param('workspace');
  await requireManager(c.env.DB, workspace, c.get('user').id);
  const targetRole = await role(c.env.DB, workspace, c.req.param('user'));
  const ownRole = await role(c.env.DB, workspace, c.get('user').id);
  if (targetRole === 'owner' || (targetRole === 'admin' && ownRole !== 'owner'))
    throw new HttpError(403, 'You cannot remove this member.');
  await c.env.DB.batch([
    c.env.DB.prepare(
      'DELETE FROM team_members WHERE user_id=? AND team_id IN (SELECT id FROM teams WHERE workspace_id=?)',
    ).bind(c.req.param('user'), workspace),
    c.env.DB.prepare(
      "DELETE FROM permissions WHERE workspace_id=? AND subject_type='user' AND subject_id=?",
    ).bind(workspace, c.req.param('user')),
    c.env.DB.prepare('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?').bind(
      workspace,
      c.req.param('user'),
    ),
  ]);
  return c.json({ ok: true });
});
app.post('/api/workspaces/:id/teams', async (c) => {
  const workspace = c.req.param('id');
  await requireManager(c.env.DB, workspace, c.get('user').id);
  const data = z
    .object({ name: nameSchema, member_ids: z.array(z.string()).max(100) })
    .parse(await c.req.json());
  for (const userId of data.member_ids)
    if (!(await role(c.env.DB, workspace, userId)))
      throw new HttpError(400, 'Every team member must belong to this workspace.');
  const teamId = id('team');
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO teams(id,workspace_id,name) VALUES(?,?,?)').bind(
      teamId,
      workspace,
      data.name,
    ),
    ...Array.from(new Set(data.member_ids)).map((userId) =>
      c.env.DB.prepare('INSERT INTO team_members(team_id,user_id) VALUES(?,?)').bind(
        teamId,
        userId,
      ),
    ),
  ]);
  return c.json({ id: teamId }, 201);
});
app.put('/api/workspaces/:id/permissions', async (c) => {
  const workspace = c.req.param('id');
  await requireManager(c.env.DB, workspace, c.get('user').id);
  const data = z
    .object({
      connection_id: z.string(),
      tool_id: z.string().nullable().optional(),
      subject_type: z.enum(['user', 'team']),
      subject_id: z.string(),
      permission: permissionSchema,
    })
    .parse(await c.req.json());
  const connection = await managedConnection(c.env, data.connection_id, c.get('user').id);
  if (connection.workspace_id !== workspace)
    throw new HttpError(400, 'Connection must belong to this workspace.');
  if (
    data.subject_type === 'user'
      ? !(await role(c.env.DB, workspace, data.subject_id))
      : !(await first(
          c.env.DB,
          'SELECT id FROM teams WHERE workspace_id=? AND id=?',
          workspace,
          data.subject_id,
        ))
  )
    throw new HttpError(400, 'The subject must belong to this workspace.');
  if (
    data.tool_id &&
    !(await first(
      c.env.DB,
      'SELECT id FROM tools WHERE id=? AND connection_id=?',
      data.tool_id,
      connection.id,
    ))
  )
    throw new HttpError(400, 'Tool does not belong to this connection.');
  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM permissions WHERE connection_id=? AND subject_type=? AND subject_id=? AND COALESCE(tool_id,'')=?",
    ).bind(data.connection_id, data.subject_type, data.subject_id, data.tool_id || ''),
    c.env.DB.prepare(
      'INSERT INTO permissions(id,workspace_id,connection_id,tool_id,subject_type,subject_id,permission) VALUES(?,?,?,?,?,?,?)',
    ).bind(
      id('grant'),
      workspace,
      data.connection_id,
      data.tool_id || null,
      data.subject_type,
      data.subject_id,
      data.permission,
    ),
  ]);
  return c.json({ ok: true });
});
export default app;
