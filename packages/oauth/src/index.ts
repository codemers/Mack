import {
  discoverOAuthServerInfo,
  extractWWWAuthenticateParams,
  registerClient,
  startAuthorization,
  exchangeAuthorization,
  refreshAuthorization,
  type OAuthServerInfo,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { first, run, type Env } from '../../db/src/index';
import { encrypt, decrypt, token, hash } from '../../crypto/src/index';
import { HttpError } from '../../shared/src/index';

export const providers: Record<
  string,
  { origins: string[]; defaultScope: string; appRequired?: boolean }
> = {
  'api.githubcopilot.com': {
    origins: ['https://api.githubcopilot.com', 'https://github.com'],
    defaultScope: 'repo read:org',
    appRequired: true,
  },
  'mcp.slack.com': {
    origins: ['https://mcp.slack.com', 'https://slack.com'],
    defaultScope: 'search:read.public channels:history channels:read users:read',
    appRequired: true,
  },
  'mcp.linear.app': { origins: ['https://mcp.linear.app'], defaultScope: 'read' },
  'mcp.notion.com': { origins: ['https://mcp.notion.com'], defaultScope: 'default' },
  'mcp.stripe.com': {
    origins: ['https://mcp.stripe.com', 'https://access.stripe.com'],
    defaultScope: '',
  },
};
export interface OAuthState {
  serverUrl: string;
  redirectUri: string;
  info: OAuthServerInfo;
  client: OAuthClientInformationMixed;
  resource?: string;
  verifier: string;
  scope: string;
  tokens?: OAuthTokens;
  expiresAt?: number;
}
export interface OAuthCredentials {
  token: string;
  oauth: OAuthState;
}
export function allowedOrigins(env: Env, serverUrl: string) {
  const url = new URL(serverUrl);
  return (
    providers[url.hostname]?.origins || [
      url.origin,
      ...(env.OAUTH_ALLOWED_ORIGINS || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    ]
  );
}
export function assertOAuthUrl(env: Env, serverUrl: string, raw: string) {
  const url = new URL(raw);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    !allowedOrigins(env, serverUrl).includes(url.origin)
  )
    throw new HttpError(400, 'OAuth endpoint is not approved for this server.');
  return url;
}
export function oauthFetch(env: Env, serverUrl: string): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    assertOAuthUrl(env, serverUrl, url);
    const response = await fetch(input, {
      ...init,
      headers: { Accept: 'application/json', ...Object.fromEntries(new Headers(init?.headers)) },
      redirect: 'error',
      signal: AbortSignal.any([AbortSignal.timeout(12000), ...(init?.signal ? [init.signal] : [])]),
    });
    if (!response.body) return response;
    const reader = response.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 256 * 1024) throw new HttpError(502, 'OAuth response is too large.');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
function validateInfo(env: Env, serverUrl: string, info: OAuthServerInfo) {
  const m = info.authorizationServerMetadata;
  if (!m || !m.authorization_endpoint || !m.token_endpoint)
    throw new HttpError(400, 'This server did not advertise usable OAuth metadata.');
  for (const url of [
    info.authorizationServerUrl,
    m.issuer,
    m.authorization_endpoint,
    m.token_endpoint,
    m.registration_endpoint,
  ].filter(Boolean))
    assertOAuthUrl(env, serverUrl, url!);
  if (
    new URL(m.issuer).href.replace(/\/$/, '') !==
    new URL(info.authorizationServerUrl).href.replace(/\/$/, '')
  )
    throw new HttpError(400, 'OAuth issuer does not match discovery.');
  if (!m.code_challenge_methods_supported?.includes('S256'))
    throw new HttpError(400, 'This OAuth server must support PKCE S256.');
  if (info.resourceMetadata) {
    const resource = new URL(info.resourceMetadata.resource),
      server = new URL(serverUrl);
    if (
      resource.origin !== server.origin ||
      !(
        server.pathname === resource.pathname ||
        server.pathname.startsWith(resource.pathname.replace(/\/$/, '') + '/')
      )
    )
      throw new HttpError(400, 'OAuth resource does not match the MCP endpoint.');
  }
}
export async function beginOAuth(env: Env, serverUrl: string, scope?: string) {
  const fetchFn = oauthFetch(env, serverUrl);
  const challenge = await fetchFn(serverUrl, {
    method: 'GET',
    headers: { Accept: 'application/json, text/event-stream' },
  });
  const metadataUrl = extractWWWAuthenticateParams(challenge).resourceMetadataUrl;
  const info = await discoverOAuthServerInfo(serverUrl, {
    resourceMetadataUrl: metadataUrl,
    fetchFn,
  });
  validateInfo(env, serverUrl, info);
  const redirectUri = `${env.WEB_ORIGIN}/api/oauth/callback`;
  const host = new URL(serverUrl).hostname;
  let configured: Record<string, { client_id: string; client_secret?: string; scope?: string }> =
    {};
  try {
    configured = JSON.parse(env.OAUTH_CLIENTS_JSON || '{}');
  } catch {
    throw new HttpError(503, 'OAuth app configuration is invalid.');
  }
  const app = configured[host];
  const selectedScope =
    scope ??
    app?.scope ??
    providers[host]?.defaultScope ??
    info.resourceMetadata?.scopes_supported?.join(' ') ??
    '';
  const advertisedScopes = [
    ...(info.authorizationServerMetadata?.scopes_supported || []),
    ...(info.resourceMetadata?.scopes_supported || []),
  ];
  if (
    advertisedScopes.length &&
    selectedScope
      .split(/\s+/)
      .filter(Boolean)
      .some((s) => !advertisedScopes.includes(s))
  )
    throw new HttpError(400, 'Requested OAuth scope is not supported by this provider.');
  let client: OAuthClientInformationMixed;
  if (app?.client_id)
    client = {
      client_id: app.client_id,
      ...(app.client_secret ? { client_secret: app.client_secret } : {}),
    };
  else {
    if (providers[host]?.appRequired || !info.authorizationServerMetadata?.registration_endpoint)
      throw new HttpError(
        409,
        'An administrator must configure a registered OAuth app for this provider.',
      );
    client = await registerClient(info.authorizationServerUrl, {
      metadata: info.authorizationServerMetadata,
      clientMetadata: {
        client_name: 'Mack',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      scope: selectedScope || undefined,
      fetchFn,
    });
  }
  const state = token();
  const resource = info.resourceMetadata?.resource;
  const authorization = await startAuthorization(info.authorizationServerUrl, {
    metadata: info.authorizationServerMetadata,
    clientInformation: client,
    redirectUrl: redirectUri,
    scope: selectedScope || undefined,
    state,
    resource: resource ? new URL(resource) : undefined,
  });
  assertOAuthUrl(env, serverUrl, authorization.authorizationUrl.href);
  const payload: OAuthState = {
    serverUrl,
    redirectUri,
    info,
    client,
    resource,
    verifier: authorization.codeVerifier,
    scope: selectedScope,
  };
  return { state, payload, url: authorization.authorizationUrl.href };
}
function validateTokens(serverUrl: string, tokens: OAuthTokens) {
  // Slack's user-token endpoint labels bearer credentials as "user".
  if (new URL(serverUrl).hostname === 'mcp.slack.com' && tokens.token_type.toLowerCase() === 'user')
    tokens.token_type = 'Bearer';
  if (tokens.token_type.toLowerCase() !== 'bearer')
    throw new HttpError(400, 'Unsupported OAuth token type.');
}
export async function completeOAuth(env: Env, state: OAuthState, code: string) {
  validateInfo(env, state.serverUrl, state.info);
  const tokens = await exchangeAuthorization(state.info.authorizationServerUrl, {
    metadata: state.info.authorizationServerMetadata,
    clientInformation: state.client,
    authorizationCode: code,
    codeVerifier: state.verifier,
    redirectUri: state.redirectUri,
    resource: state.resource ? new URL(state.resource) : undefined,
    fetchFn: oauthFetch(env, state.serverUrl),
  });
  validateTokens(state.serverUrl, tokens);
  state.verifier = '';
  state.tokens = tokens;
  state.expiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined;
  return { token: tokens.access_token, oauth: state };
}
export async function refreshCredentials(
  env: Env,
  connectionId: string,
  current: OAuthCredentials,
): Promise<OAuthCredentials> {
  if (!current.oauth.expiresAt || current.oauth.expiresAt > Date.now() + 60000) return current;
  const owner = token();
  const lock = await first(
    env.DB,
    'INSERT INTO oauth_refresh_locks(connection_id,owner,expires_at) VALUES(?,?,?) ON CONFLICT(connection_id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE oauth_refresh_locks.expires_at<? RETURNING owner',
    connectionId,
    owner,
    Date.now() + 30000,
    Date.now(),
  );
  if (!lock) throw new HttpError(409, 'OAuth credentials are refreshing. Retry shortly.');
  try {
    const row = await first<{ encrypted_credentials: string }>(
      env.DB,
      'SELECT encrypted_credentials FROM connection_credentials WHERE connection_id=?',
      connectionId,
    );
    if (!row) throw new HttpError(409, 'Reconnect this OAuth connection.');
    const latest = await decrypt<OAuthCredentials>(
      row.encrypted_credentials,
      env.ENCRYPTION_KEY,
      connectionId,
    );
    if (!latest.oauth) throw new HttpError(409, 'Connection credentials changed. Retry.');
    if (!latest.oauth.expiresAt || latest.oauth.expiresAt > Date.now() + 60000) return latest;
    const s = latest.oauth;
    if (!s.tokens?.refresh_token)
      throw new HttpError(409, 'OAuth access expired. Reconnect this connection.');
    validateInfo(env, s.serverUrl, s.info);
    const tokens = await refreshAuthorization(s.info.authorizationServerUrl, {
      metadata: s.info.authorizationServerMetadata,
      clientInformation: s.client,
      refreshToken: s.tokens.refresh_token,
      resource: s.resource ? new URL(s.resource) : undefined,
      fetchFn: oauthFetch(env, s.serverUrl),
    });
    validateTokens(s.serverUrl, tokens);
    const next: OAuthCredentials = {
      token: tokens.access_token,
      oauth: {
        ...s,
        tokens,
        expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
      },
    };
    const updated = await first(
      env.DB,
      "UPDATE connection_credentials SET encrypted_credentials=?,updated_at=datetime('now') WHERE connection_id=? AND encrypted_credentials=? RETURNING connection_id",
      await encrypt(next, env.ENCRYPTION_KEY, connectionId),
      connectionId,
      row.encrypted_credentials,
    );
    if (!updated) throw new HttpError(409, 'Connection changed during refresh. Retry.');
    return next;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(409, 'OAuth refresh failed. Reconnect this connection.');
  } finally {
    await run(
      env.DB,
      'DELETE FROM oauth_refresh_locks WHERE connection_id=? AND owner=?',
      connectionId,
      owner,
    );
  }
}
export const stateKey = (state: string) => hash(state);
