import { first, run, type Env } from '../../db/src/index';
import { hash } from '../../crypto/src/index';
import { id } from '../../shared/src/index';
import { OAuthError, assertCimdUrl, assertRedirectUri, oauthJson, requestIp } from './util';
import { rateLimit } from '../../auth/src/index';

export interface OAuthClientRow {
  id: string;
  client_id: string;
  client_name: string;
  token_endpoint_auth_method: 'none' | 'client_secret_post' | 'client_secret_basic';
  client_secret_hash: string | null;
  redirect_uris: string;
  grant_types: string;
  response_types: string;
  metadata: string;
  kind: 'dcr' | 'cimd';
  fetched_at: number | null;
}

export function parseRedirectUris(value: string) {
  return JSON.parse(value) as string[];
}

function validateRedirectList(uris: unknown) {
  if (!Array.isArray(uris) || !uris.length || uris.length > 8)
    throw new OAuthError('invalid_redirect_uri', 'Provide between 1 and 8 redirect URIs.');
  return [...new Set(uris.map((uri) => assertRedirectUri(String(uri).slice(0, 2048))))];
}

export function registeredRedirect(client: OAuthClientRow, redirectUri: string) {
  if (!parseRedirectUris(client.redirect_uris).includes(redirectUri))
    throw new OAuthError('invalid_request', 'Redirect URI is not registered for this client.');
  return redirectUri;
}

async function saveClient(
  env: Env,
  row: Omit<OAuthClientRow, 'fetched_at'> & { fetched_at?: number | null },
) {
  await run(
    env.DB,
    'INSERT INTO oauth_clients(id,client_id,client_name,token_endpoint_auth_method,client_secret_hash,redirect_uris,grant_types,response_types,metadata,kind,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(client_id) DO UPDATE SET client_name=excluded.client_name,token_endpoint_auth_method=excluded.token_endpoint_auth_method,client_secret_hash=excluded.client_secret_hash,redirect_uris=excluded.redirect_uris,grant_types=excluded.grant_types,response_types=excluded.response_types,metadata=excluded.metadata,kind=excluded.kind,fetched_at=excluded.fetched_at',
    row.id,
    row.client_id,
    row.client_name,
    row.token_endpoint_auth_method,
    row.client_secret_hash,
    row.redirect_uris,
    row.grant_types,
    row.response_types,
    row.metadata,
    row.kind,
    row.fetched_at ?? Date.now(),
  );
}

export async function loadOAuthClient(env: Env, clientId: string) {
  return first<OAuthClientRow>(env.DB, 'SELECT * FROM oauth_clients WHERE client_id=?', clientId);
}

async function fetchCimdDocument(clientId: string) {
  const url = assertCimdUrl(clientId);
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(12000),
  });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new OAuthError('invalid_client', 'Client ID metadata documents cannot redirect.');
  }
  if (!response.ok)
    throw new OAuthError('invalid_client', 'Could not fetch the client ID metadata document.');
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 64 * 1024)
    throw new OAuthError('invalid_client', 'Client ID metadata document is too large.');
  const reader = response.body?.getReader();
  if (!reader) throw new OAuthError('invalid_client', 'Client ID metadata document was empty.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024)
        throw new OAuthError('invalid_client', 'Client ID metadata document is too large.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let document: {
    client_id?: string;
    client_name?: string;
    redirect_uris?: unknown;
    token_endpoint_auth_method?: string;
    grant_types?: string[];
    response_types?: string[];
  };
  try {
    document = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new OAuthError('invalid_client', 'Client ID metadata document is not valid JSON.');
  }
  if (document.client_id !== url.href)
    throw new OAuthError('invalid_client', 'Client ID metadata document does not match its URL.');
  if (!document.client_name || typeof document.client_name !== 'string')
    throw new OAuthError('invalid_client', 'Client ID metadata document is missing a name.');
  const method = document.token_endpoint_auth_method || 'none';
  if (method !== 'none')
    throw new OAuthError(
      'invalid_client',
      'Client ID metadata documents must use public PKCE clients.',
    );
  return {
    client_id: url.href,
    client_name: document.client_name.slice(0, 80),
    redirect_uris: validateRedirectList(document.redirect_uris),
    token_endpoint_auth_method: 'none' as const,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    metadata: JSON.stringify(document).slice(0, 16 * 1024),
  };
}

export async function resolveOAuthClient(env: Env, clientId: string) {
  if (!clientId || clientId.length > 2048)
    throw new OAuthError('invalid_client', 'Unknown OAuth client.');
  const existing = await loadOAuthClient(env, clientId);
  if (clientId.startsWith('https://')) {
    if (
      existing &&
      existing.kind === 'cimd' &&
      existing.fetched_at &&
      existing.fetched_at > Date.now() - 3600000
    )
      return existing;
    const document = await fetchCimdDocument(clientId);
    const row: OAuthClientRow = {
      id: existing?.id || id('oauth'),
      client_id: document.client_id,
      client_name: document.client_name,
      token_endpoint_auth_method: document.token_endpoint_auth_method,
      client_secret_hash: null,
      redirect_uris: JSON.stringify(document.redirect_uris),
      grant_types: JSON.stringify(document.grant_types),
      response_types: JSON.stringify(document.response_types),
      metadata: document.metadata,
      kind: 'cimd',
      fetched_at: Date.now(),
    };
    await saveClient(env, row);
    return row;
  }
  if (!existing) throw new OAuthError('invalid_client', 'Unknown OAuth client.');
  return existing;
}

export async function registerOAuthClient(request: Request, env: Env) {
  await rateLimit(env.DB, `oauth-dcr:${await hash(requestIp(request))}`, 20, 3600000);
  if (Number(request.headers.get('content-length') || 0) > 16 * 1024)
    throw new OAuthError('invalid_client_metadata', 'Registration request is too large.');
  const type = request.headers.get('content-type') || '';
  if (type && !type.startsWith('application/json'))
    throw new OAuthError('invalid_client_metadata', 'Register with an application/json body.');
  let data: Record<string, unknown>;
  try {
    data = (await request.json()) as Record<string, unknown>;
  } catch {
    throw new OAuthError('invalid_client_metadata', 'Registration body is not valid JSON.');
  }
  const redirectUris = validateRedirectList(data.redirect_uris);
  const method =
    typeof data.token_endpoint_auth_method === 'string' ? data.token_endpoint_auth_method : 'none';
  if (method !== 'none' && method !== 'client_secret_post' && method !== 'client_secret_basic')
    throw new OAuthError(
      'invalid_client_metadata',
      'Unsupported token endpoint authentication method.',
    );
  const grantTypes = Array.isArray(data.grant_types)
    ? data.grant_types.map(String)
    : ['authorization_code', 'refresh_token'];
  if (grantTypes.some((g) => g !== 'authorization_code' && g !== 'refresh_token'))
    throw new OAuthError(
      'invalid_client_metadata',
      'Only authorization_code and refresh_token grants are supported.',
    );
  const responseTypes = Array.isArray(data.response_types)
    ? data.response_types.map(String)
    : ['code'];
  if (responseTypes.some((g) => g !== 'code'))
    throw new OAuthError('invalid_client_metadata', 'Only the code response type is supported.');
  const confidential = method !== 'none';
  const secret = confidential
    ? btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '')
    : undefined;
  const clientId = id('oid');
  const name =
    typeof data.client_name === 'string' && data.client_name.trim()
      ? data.client_name.trim().slice(0, 80)
      : 'MCP client';
  await saveClient(env, {
    id: id('oauth'),
    client_id: clientId,
    client_name: name,
    token_endpoint_auth_method: method,
    client_secret_hash: secret ? await hash(secret) : null,
    redirect_uris: JSON.stringify(redirectUris),
    grant_types: JSON.stringify([...new Set([...grantTypes, 'refresh_token'])]),
    response_types: JSON.stringify(['code']),
    metadata: JSON.stringify(data).slice(0, 16 * 1024),
    kind: 'dcr',
    fetched_at: Date.now(),
  });
  return oauthJson(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: method,
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    },
    201,
  );
}
