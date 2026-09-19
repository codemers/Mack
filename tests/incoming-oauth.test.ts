import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LocalDatabase } from '../scripts/database';
import { seed } from '../scripts/seed';
import { fixtureFetch } from '../scripts/fixtures';
import api from '../apps/api/src/index';
import gateway from '../apps/gateway/src/index';
import { all, first, run, type Env } from '../packages/db/src/index';
import { pkceChallenge } from '../packages/oauth-server/src/util';
import type { Client } from '../packages/shared/src/index';

let db: LocalDatabase;
let env: Env;
const originalFetch = globalThis.fetch;

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
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin === 'http://127.0.0.1:8790') return fixtureFetch(request);
    throw new Error('Tests cannot access external services');
  };
  await seed(env);
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  db.close();
});

function gatewayRequest(path: string, init: RequestInit = {}) {
  return gateway.fetch(new Request(`http://127.0.0.1:8788${path}`, init), env);
}
function apiRequest(path: string, method = 'GET', body?: unknown) {
  return api.fetch(
    new Request(`http://127.0.0.1:3000/api${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    env,
  );
}
function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function registerClient(redirect = 'https://chatgpt.com/connector_platform_oauth_redirect') {
  const response = await gatewayRequest('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'ChatGPT',
      redirect_uris: [redirect],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  assert.equal(response.status, 201);
  return (await response.json()) as { client_id: string };
}

async function beginAuthorize(
  clientId: string,
  challenge: string,
  extra: Record<string, string> = {},
) {
  const url = new URL('http://127.0.0.1:8788/oauth/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set(
    'redirect_uri',
    extra.redirect_uri || 'https://chatgpt.com/connector_platform_oauth_redirect',
  );
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', extra.state || 'client-state');
  url.searchParams.set('resource', extra.resource || env.GATEWAY_URL);
  if (extra.scope) url.searchParams.set('scope', extra.scope);
  return gatewayRequest(url.pathname + url.search);
}

async function completeConsent(authorize: Response, permission = 'read') {
  assert.equal(authorize.status, 302);
  const location = new URL(authorize.headers.get('location') || '');
  assert.equal(location.origin + location.pathname, 'http://127.0.0.1:3000/oauth/authorize');
  const requestId = location.searchParams.get('request') || '';
  const details = await apiRequest('/oauth/incoming/' + encodeURIComponent(requestId));
  assert.equal(details.status, 200);
  const body = (await details.json()) as { connections: { id: string }[] };
  const approved = await apiRequest(
    '/oauth/incoming/' + encodeURIComponent(requestId) + '/approve',
    'POST',
    {
      workspace_id: 'ws_apprentx',
      permissions: [{ connection_id: 'demo_github', permission }],
    },
  );
  assert.equal(approved.status, 200);
  const { redirect } = (await approved.json()) as { redirect: string };
  const callback = new URL(redirect);
  return { requestId, body, callback };
}

async function listTools(accessToken: string) {
  const client = new McpClient({ name: 'oauth-test', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL(env.GATEWAY_URL), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
    fetch: async (input, init) => gateway.fetch(new Request(input, init), env),
  });
  await client.connect(transport);
  try {
    return await client.listTools();
  } finally {
    await client.close();
  }
}

async function exchange(
  clientId: string,
  code: string,
  verifier: string,
  extra: Record<string, string> = {},
) {
  const params = new URLSearchParams({
    grant_type: extra.grant_type || 'authorization_code',
    client_id: clientId,
    redirect_uri: extra.redirect_uri || 'https://chatgpt.com/connector_platform_oauth_redirect',
    resource: extra.resource || env.GATEWAY_URL,
    ...(extra.grant_type === 'refresh_token'
      ? { refresh_token: extra.refresh_token || '' }
      : { code, code_verifier: verifier }),
  });
  return gatewayRequest('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params,
  });
}

test('unauthenticated MCP requests advertise protected resource metadata', async () => {
  const response = await gatewayRequest('/mcp', {
    method: 'POST',
    headers: { Accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  });
  assert.equal(response.status, 401);
  const challenge = response.headers.get('www-authenticate') || '';
  assert.match(
    challenge,
    /resource_metadata="http:\/\/127.0.0.1:8788\/.well-known\/oauth-protected-resource"/,
  );
  assert.match(challenge, /scope="mcp"/);
  const metadata = await gatewayRequest('/.well-known/oauth-protected-resource');
  assert.equal(metadata.status, 200);
  const body = (await metadata.json()) as {
    resource: string;
    authorization_servers: string[];
  };
  assert.equal(body.resource, env.GATEWAY_URL);
  assert.deepEqual(body.authorization_servers, ['http://127.0.0.1:8788']);
  const as = await gatewayRequest('/.well-known/oauth-authorization-server');
  const asBody = (await as.json()) as {
    authorization_endpoint: string;
    registration_endpoint: string;
    code_challenge_methods_supported: string[];
    client_id_metadata_document_supported: boolean;
  };
  assert.equal(asBody.authorization_endpoint, 'http://127.0.0.1:8788/oauth/authorize');
  assert.equal(asBody.registration_endpoint, 'http://127.0.0.1:8788/oauth/register');
  assert.deepEqual(asBody.code_challenge_methods_supported, ['S256']);
  assert.equal(asBody.client_id_metadata_document_supported, true);
  assert.equal((await gatewayRequest('/.well-known/oauth-protected-resource/mcp')).status, 200);
  assert.equal((await gatewayRequest('/.well-known/openid-configuration')).status, 200);
});

test('OAuth DCR, PKCE, consent and token exchange can list granted tools', async () => {
  const { verifier, challenge } = pkce();
  assert.equal(await pkceChallenge(verifier), challenge);
  const { client_id } = await registerClient();
  const { callback } = await completeConsent(await beginAuthorize(client_id, challenge));
  assert.equal(callback.searchParams.get('state'), 'client-state');
  assert.equal(callback.searchParams.get('iss'), 'http://127.0.0.1:8788');
  const tokenResponse = await exchange(
    client_id,
    callback.searchParams.get('code') || '',
    verifier,
  );
  assert.equal(tokenResponse.status, 200);
  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
  };
  assert.equal(tokens.token_type, 'Bearer');
  assert.equal(tokens.expires_in, 3600);
  assert.ok(!JSON.stringify(tokens).includes(verifier));
  const { tools } = await listTools(tokens.access_token);
  assert.ok(tools.some((t) => t.name === 'github_list_issues'));
  assert.ok(!tools.some((t) => t.name === 'linear_search_issues'));
  const oauthClient = (await first<Client>(
    db,
    'SELECT * FROM clients WHERE oauth_client_id IS NOT NULL',
  ))!;
  assert.equal(oauthClient.type, 'chatgpt');
  assert.equal(oauthClient.token_prefix, 'oauth');
});

test('PKCE mismatch, reused codes and resource mismatch are rejected', async () => {
  const { verifier, challenge } = pkce();
  const { client_id } = await registerClient();
  const { callback } = await completeConsent(await beginAuthorize(client_id, challenge));
  const code = callback.searchParams.get('code') || '';
  assert.equal((await exchange(client_id, code, 'a'.repeat(43))).status, 400);
  assert.equal((await exchange(client_id, code, verifier)).status, 400);
  const { verifier: v2, challenge: c2 } = pkce();
  const second = await completeConsent(await beginAuthorize(client_id, c2));
  const code2 = second.callback.searchParams.get('code') || '';
  assert.equal((await exchange(client_id, code2, v2)).status, 200);
  assert.equal((await exchange(client_id, code2, v2)).status, 400);
  const { verifier: v3, challenge: c3 } = pkce();
  const third = await completeConsent(await beginAuthorize(client_id, c3));
  assert.equal(
    (
      await exchange(client_id, third.callback.searchParams.get('code') || '', v3, {
        resource: 'https://evil.example/mcp',
      })
    ).status,
    400,
  );
});

test('consent denial redirects to the client without issuing tokens', async () => {
  const { challenge } = pkce();
  const { client_id } = await registerClient();
  const authorize = await beginAuthorize(client_id, challenge);
  const requestId =
    new URL(authorize.headers.get('location') || '').searchParams.get('request') || '';
  const denied = await apiRequest(
    '/oauth/incoming/' + encodeURIComponent(requestId) + '/deny',
    'POST',
    {},
  );
  assert.equal(denied.status, 200);
  const { redirect } = (await denied.json()) as { redirect: string };
  const url = new URL(redirect);
  assert.equal(url.searchParams.get('error'), 'access_denied');
  assert.equal((await all(db, 'SELECT * FROM oauth_authorization_codes')).length, 0);
  assert.equal(
    (await all(db, 'SELECT * FROM clients WHERE oauth_client_id IS NOT NULL')).length,
    0,
  );
});

test('refresh rotates tokens and reuse of the old refresh token fails', async () => {
  const { verifier, challenge } = pkce();
  const { client_id } = await registerClient();
  const { callback } = await completeConsent(await beginAuthorize(client_id, challenge));
  const firstToken = (await (
    await exchange(client_id, callback.searchParams.get('code') || '', verifier)
  ).json()) as { access_token: string; refresh_token: string };
  const refreshed = await exchange(client_id, '', '', {
    grant_type: 'refresh_token',
    refresh_token: firstToken.refresh_token,
  });
  assert.equal(refreshed.status, 200);
  const next = (await refreshed.json()) as { access_token: string; refresh_token: string };
  assert.notEqual(next.access_token, firstToken.access_token);
  assert.equal(
    (
      await exchange(client_id, '', '', {
        grant_type: 'refresh_token',
        refresh_token: firstToken.refresh_token,
      })
    ).status,
    400,
  );
  const { tools } = await listTools(next.access_token);
  assert.ok(tools.some((t) => t.name === 'github_list_issues'));
});

test('expired OAuth access tokens cannot call the gateway', async () => {
  const { verifier, challenge } = pkce();
  const { client_id } = await registerClient();
  const { callback } = await completeConsent(await beginAuthorize(client_id, challenge));
  const tokens = (await (
    await exchange(client_id, callback.searchParams.get('code') || '', verifier)
  ).json()) as { access_token: string };
  await run(db, 'UPDATE oauth_access_tokens SET expires_at=0');
  const response = await gatewayRequest('/mcp', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  assert.equal(response.status, 401);
  assert.match(response.headers.get('www-authenticate') || '', /invalid_token/);
});

test('CIMD clients are fetched over HTTPS and private metadata hosts are rejected', async () => {
  const metadata = {
    client_id: 'https://chatgpt.com/oauth/mack/client.json',
    client_name: 'ChatGPT',
    redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
    token_endpoint_auth_method: 'none',
  };
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === metadata.client_id) return Response.json(metadata);
    const request = new Request(input, init);
    if (new URL(request.url).origin === 'http://127.0.0.1:8790') return fixtureFetch(request);
    throw new Error('Unexpected network request: ' + url);
  };
  const { verifier, challenge } = pkce();
  const { callback } = await completeConsent(await beginAuthorize(metadata.client_id, challenge));
  const tokens = await exchange(
    metadata.client_id,
    callback.searchParams.get('code') || '',
    verifier,
  );
  assert.equal(tokens.status, 200);
  const privateHost = await beginAuthorize('https://127.0.0.1/client.json', challenge);
  assert.equal(privateHost.status, 400);
});

test('OAuth client keys cannot be rotated and revoke stops gateway access', async () => {
  const { verifier, challenge } = pkce();
  const { client_id } = await registerClient();
  const { callback } = await completeConsent(await beginAuthorize(client_id, challenge));
  const tokens = (await (
    await exchange(client_id, callback.searchParams.get('code') || '', verifier)
  ).json()) as { access_token: string };
  const row = (await first<Client>(db, 'SELECT * FROM clients WHERE oauth_client_id IS NOT NULL'))!;
  const rotated = await apiRequest(`/clients/${row.id}/rotate`, 'POST', {});
  assert.equal(rotated.status, 400);
  assert.equal((await apiRequest(`/clients/${row.id}`, 'DELETE', {})).status, 200);
  assert.equal(
    (
      await gatewayRequest('/mcp', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      })
    ).status,
    401,
  );
});
