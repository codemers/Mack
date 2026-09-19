import { first, run, type Env } from '../../db/src/index';
import { encrypt, decrypt, hash, token } from '../../crypto/src/index';
import { HttpError, id, type Permission, type User } from '../../shared/src/index';
import { visibleConnections, role } from '../../permissions/src/index';
import { rateLimit } from '../../auth/src/index';
import {
  ACCESS_TTL_MS,
  CODE_TTL_MS,
  OAuthError,
  REFRESH_TTL_MS,
  assertRedirectUri,
  asHttpError,
  canonicalResource,
  clientType,
  corsHeaders,
  issuer,
  oauthJson,
  pkceChallenge,
  requestIp,
  resourceUrl,
  sameResource,
  timingEqual,
} from './util';
import { registeredRedirect, resolveOAuthClient, type OAuthClientRow } from './clients';

export interface AuthzPayload {
  client_id: string;
  oauth_client_id: string;
  client_name: string;
  redirect_uri: string;
  state: string | null;
  code_challenge: string;
  resource: string;
  scope: string;
}

function redirectWith(redirectUri: string, params: Record<string, string | undefined>, env: Env) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  url.searchParams.set('iss', issuer(env));
  return Response.redirect(url.href, 302);
}

function parseGrant(value: string | null): 'authorization_code' | 'refresh_token' {
  if (value === 'authorization_code' || value === 'refresh_token') return value;
  throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token.');
}

async function clientSecretMatches(client: OAuthClientRow, secret: string | null) {
  if (client.token_endpoint_auth_method === 'none') return !secret;
  if (!secret || !client.client_secret_hash) return false;
  return timingEqual(await hash(secret), client.client_secret_hash);
}

async function authenticateOAuthClient(request: Request, params: URLSearchParams, env: Env) {
  let clientId = params.get('client_id');
  let secret = params.get('client_secret');
  const header = request.headers.get('authorization');
  if (header?.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6));
      const i = decoded.indexOf(':');
      const basicId = decodeURIComponent(decoded.slice(0, i));
      const basicSecret = decodeURIComponent(decoded.slice(i + 1));
      if (clientId && clientId !== basicId)
        throw new OAuthError('invalid_client', 'Client authentication mismatch.', 401);
      clientId = basicId;
      secret = basicSecret;
    } catch (error) {
      if (error instanceof OAuthError) throw error;
      throw new OAuthError('invalid_client', 'Client authentication is invalid.', 401);
    }
  }
  if (!clientId) throw new OAuthError('invalid_client', 'client_id is required.', 401);
  const client = await resolveOAuthClient(env, clientId);
  const method = client.token_endpoint_auth_method;
  if (method === 'none') {
    if (secret) throw new OAuthError('invalid_client', 'This client does not use a secret.', 401);
  } else if (method === 'client_secret_post' || method === 'client_secret_basic') {
    if (!(await clientSecretMatches(client, secret)))
      throw new OAuthError('invalid_client', 'Invalid client credentials.', 401);
  } else {
    const _never: never = method;
    throw new OAuthError(
      'invalid_client',
      `Unsupported token authentication method: ${_never}`,
      401,
    );
  }
  return client;
}

export async function startAuthorization(request: Request, env: Env) {
  const url = new URL(request.url);
  await rateLimit(env.DB, `oauth-authorize:${await hash(requestIp(request))}`, 60);
  const fail = (
    error: string,
    description: string,
    redirectUri?: string,
    state?: string | null,
  ) => {
    if (!redirectUri) throw new OAuthError(error, description);
    return redirectWith(
      redirectUri,
      { error, error_description: description, state: state || undefined },
      env,
    );
  };
  const clientId = url.searchParams.get('client_id') || '';
  const requestedRedirect = url.searchParams.get('redirect_uri');
  const state = url.searchParams.get('state');
  if (state && state.length > 256) throw new OAuthError('invalid_request', 'state is too long.');
  let client: OAuthClientRow;
  try {
    client = await resolveOAuthClient(env, clientId);
  } catch (error) {
    if (error instanceof OAuthError) return fail(error.error, error.message);
    throw error;
  }
  if (!requestedRedirect) return fail('invalid_request', 'redirect_uri is required.');
  let redirectUri: string;
  try {
    redirectUri = registeredRedirect(client, assertRedirectUri(requestedRedirect));
  } catch (error) {
    return fail(
      'invalid_request',
      error instanceof Error ? error.message : 'Invalid redirect URI.',
    );
  }
  if (url.searchParams.get('response_type') !== 'code')
    return fail(
      'unsupported_response_type',
      'Mack only supports the authorization code flow.',
      redirectUri,
      state,
    );
  const challenge = url.searchParams.get('code_challenge') || '';
  const method = url.searchParams.get('code_challenge_method');
  if (method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge))
    return fail('invalid_request', 'PKCE S256 is required.', redirectUri, state);
  let resource: string;
  try {
    resource = sameResource(env, url.searchParams.get('resource'));
  } catch (error) {
    return fail(
      error instanceof OAuthError ? error.error : 'invalid_target',
      error instanceof Error ? error.message : 'Invalid resource.',
      redirectUri,
      state,
    );
  }
  const requestToken = token();
  const key = await hash(requestToken);
  const payload: AuthzPayload = {
    client_id: client.client_id,
    oauth_client_id: client.id,
    client_name: client.client_name,
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    resource,
    scope: url.searchParams.get('scope') || 'mcp',
  };
  await run(env.DB, 'DELETE FROM oauth_authz_requests WHERE expires_at<?', Date.now());
  await run(
    env.DB,
    'INSERT INTO oauth_authz_requests(request_hash,encrypted_payload,expires_at) VALUES(?,?,?)',
    key,
    await encrypt(payload, env.ENCRYPTION_KEY, key),
    Date.now() + CODE_TTL_MS,
  );
  const next = new URL('/oauth/authorize', env.WEB_ORIGIN);
  next.searchParams.set('request', requestToken);
  return new Response(null, { status: 302, headers: { Location: next.href, ...corsHeaders() } });
}

async function consumeAuthzRequest(env: Env, requestToken: string) {
  if (!requestToken || requestToken.length > 256)
    throw new HttpError(400, 'This authorization request is invalid.');
  const key = await hash(requestToken);
  const row = await first<{ encrypted_payload: string }>(
    env.DB,
    'DELETE FROM oauth_authz_requests WHERE request_hash=? AND expires_at>? RETURNING encrypted_payload',
    key,
    Date.now(),
  );
  if (!row) throw new HttpError(400, 'This authorization request expired or was already used.');
  return decrypt<AuthzPayload>(row.encrypted_payload, env.ENCRYPTION_KEY, key);
}

async function peekAuthzRequest(env: Env, requestToken: string) {
  if (!requestToken || requestToken.length > 256)
    throw new HttpError(400, 'This authorization request is invalid.');
  const key = await hash(requestToken);
  const row = await first<{ encrypted_payload: string }>(
    env.DB,
    'SELECT encrypted_payload FROM oauth_authz_requests WHERE request_hash=? AND expires_at>?',
    key,
    Date.now(),
  );
  if (!row) throw new HttpError(400, 'This authorization request expired or was already used.');
  return decrypt<AuthzPayload>(row.encrypted_payload, env.ENCRYPTION_KEY, key);
}

export async function incomingAuthorizationDetails(env: Env, requestToken: string, userId: string) {
  try {
    const payload = await peekAuthzRequest(env, requestToken);
    const connections = await visibleConnections(env.DB, userId);
    return {
      client_name: payload.client_name,
      client_id: payload.client_id,
      redirect_uri: payload.redirect_uri,
      resource: payload.resource,
      connections: connections.map((c) => ({
        id: c.id,
        name: c.name,
        provider: c.provider,
        scope: c.scope,
        workspace_id: c.workspace_id,
      })),
    };
  } catch (error) {
    throw asHttpError(error);
  }
}

export async function denyIncomingAuthorization(env: Env, requestToken: string) {
  try {
    const payload = await consumeAuthzRequest(env, requestToken);
    const url = new URL(payload.redirect_uri);
    url.searchParams.set('error', 'access_denied');
    url.searchParams.set('error_description', 'The user declined access.');
    if (payload.state) url.searchParams.set('state', payload.state);
    url.searchParams.set('iss', issuer(env));
    return { redirect: url.href };
  } catch (error) {
    throw asHttpError(error);
  }
}

export async function approveIncomingAuthorization(
  env: Env,
  requestToken: string,
  user: User,
  data: {
    workspace_id?: string | null;
    name?: string;
    permissions: { connection_id: string; permission: Permission }[];
  },
) {
  try {
    const payload = await consumeAuthzRequest(env, requestToken);
    if (data.workspace_id && !(await role(env.DB, data.workspace_id, user.id)))
      throw new HttpError(403, 'Workspace access is required.');
    const visible = await visibleConnections(env.DB, user.id, data.workspace_id);
    const unique = new Set<string>();
    for (const grant of data.permissions) {
      const connection = visible.find((x) => x.id === grant.connection_id);
      if (
        !connection ||
        (connection.scope === 'workspace' && connection.workspace_id !== data.workspace_id)
      )
        throw new HttpError(403, 'This connection is not available to the client.');
      if (unique.has(grant.connection_id)) throw new HttpError(400, 'Duplicate connection grant.');
      unique.add(grant.connection_id);
    }
    const type = clientType(payload.client_name, payload.client_id);
    const name = (data.name?.trim() || payload.client_name).slice(0, 80);
    let client = await first<{ id: string }>(
      env.DB,
      "SELECT id FROM clients WHERE user_id=? AND oauth_client_id=? AND IFNULL(workspace_id,'')=? AND revoked_at IS NULL",
      user.id,
      payload.oauth_client_id,
      data.workspace_id || '',
    );
    const clientId = client?.id || id('client');
    const placeholder = token();
    const statements = [];
    if (!client) {
      statements.push(
        env.DB.prepare(
          'INSERT INTO clients(id,user_id,workspace_id,name,type,credential_hash,token_prefix,oauth_client_id) VALUES(?,?,?,?,?,?,?,?)',
        ).bind(
          clientId,
          user.id,
          data.workspace_id || null,
          name,
          type,
          await hash(placeholder),
          'oauth',
          payload.oauth_client_id,
        ),
      );
    } else {
      statements.push(
        env.DB.prepare('UPDATE clients SET name=?,type=? WHERE id=?').bind(name, type, clientId),
      );
      statements.push(
        env.DB.prepare("DELETE FROM permissions WHERE subject_type='client' AND subject_id=?").bind(
          clientId,
        ),
      );
    }
    for (const grant of data.permissions)
      statements.push(
        env.DB.prepare(
          "INSERT INTO permissions(id,workspace_id,connection_id,subject_type,subject_id,permission) VALUES(?,?,?,'client',?,?)",
        ).bind(
          id('grant'),
          data.workspace_id || null,
          grant.connection_id,
          clientId,
          grant.permission,
        ),
      );
    const code = token();
    statements.push(
      env.DB.prepare(
        'INSERT INTO oauth_authorization_codes(code_hash,oauth_client_id,mack_client_id,user_id,redirect_uri,code_challenge,resource,expires_at) VALUES(?,?,?,?,?,?,?,?)',
      ).bind(
        await hash(code),
        payload.oauth_client_id,
        clientId,
        user.id,
        payload.redirect_uri,
        payload.code_challenge,
        payload.resource,
        Date.now() + CODE_TTL_MS,
      ),
    );
    await env.DB.batch(statements);
    const url = new URL(payload.redirect_uri);
    url.searchParams.set('code', code);
    if (payload.state) url.searchParams.set('state', payload.state);
    url.searchParams.set('iss', issuer(env));
    return { redirect: url.href };
  } catch (error) {
    throw asHttpError(error);
  }
}

async function issueTokens(
  env: Env,
  client: OAuthClientRow,
  mackClientId: string,
  userId: string,
  resource: string,
) {
  const access = token();
  const refresh = token();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_refresh_tokens WHERE mack_client_id=?').bind(mackClientId),
    env.DB.prepare(
      'INSERT INTO oauth_access_tokens(token_hash,oauth_client_id,mack_client_id,resource,expires_at) VALUES(?,?,?,?,?)',
    ).bind(await hash(access), client.id, mackClientId, resource, Date.now() + ACCESS_TTL_MS),
    env.DB.prepare(
      'INSERT INTO oauth_refresh_tokens(token_hash,oauth_client_id,mack_client_id,user_id,resource,expires_at) VALUES(?,?,?,?,?,?)',
    ).bind(
      await hash(refresh),
      client.id,
      mackClientId,
      userId,
      resource,
      Date.now() + REFRESH_TTL_MS,
    ),
  ]);
  return oauthJson({
    access_token: access,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_MS / 1000,
    refresh_token: refresh,
    scope: 'mcp',
  });
}

export async function exchangeToken(request: Request, env: Env) {
  await rateLimit(env.DB, `oauth-token:${await hash(requestIp(request))}`, 60);
  await run(env.DB, 'DELETE FROM oauth_authorization_codes WHERE expires_at<?', Date.now());
  await run(env.DB, 'DELETE FROM oauth_access_tokens WHERE expires_at<?', Date.now());
  const type = request.headers.get('content-type') || '';
  if (type && !type.startsWith('application/x-www-form-urlencoded'))
    throw new OAuthError(
      'invalid_request',
      'Token requests must use application/x-www-form-urlencoded.',
    );
  const params = new URLSearchParams(await request.text());
  const client = await authenticateOAuthClient(request, params, env);
  const grantType = parseGrant(params.get('grant_type'));
  const resource = sameResource(env, params.get('resource'));
  switch (grantType) {
    case 'authorization_code': {
      const code = params.get('code') || '';
      const verifier = params.get('code_verifier') || '';
      const redirectUri = params.get('redirect_uri') || '';
      if (!code || !verifier || !redirectUri)
        throw new OAuthError(
          'invalid_request',
          'code, code_verifier, and redirect_uri are required.',
        );
      if (verifier.length < 43 || verifier.length > 128)
        throw new OAuthError('invalid_grant', 'PKCE verifier is invalid.');
      const row = await first<{
        oauth_client_id: string;
        mack_client_id: string;
        user_id: string;
        redirect_uri: string;
        code_challenge: string;
        resource: string;
      }>(
        env.DB,
        'DELETE FROM oauth_authorization_codes WHERE code_hash=? AND expires_at>? RETURNING oauth_client_id,mack_client_id,user_id,redirect_uri,code_challenge,resource',
        await hash(code),
        Date.now(),
      );
      if (!row || row.oauth_client_id !== client.id)
        throw new OAuthError('invalid_grant', 'Authorization code is invalid or expired.');
      if (row.redirect_uri !== redirectUri)
        throw new OAuthError(
          'invalid_grant',
          'redirect_uri does not match the authorization request.',
        );
      if (row.resource !== resource)
        throw new OAuthError('invalid_grant', 'resource does not match the authorization request.');
      if (!timingEqual(await pkceChallenge(verifier), row.code_challenge))
        throw new OAuthError('invalid_grant', 'PKCE verification failed.');
      const mack = await first<{ id: string; revoked_at: string | null }>(
        env.DB,
        'SELECT id,revoked_at FROM clients WHERE id=?',
        row.mack_client_id,
      );
      if (!mack || mack.revoked_at)
        throw new OAuthError('invalid_grant', 'This client has been revoked.');
      return issueTokens(env, client, row.mack_client_id, row.user_id, resource);
    }
    case 'refresh_token': {
      const refresh = params.get('refresh_token') || '';
      if (!refresh) throw new OAuthError('invalid_request', 'refresh_token is required.');
      const row = await first<{
        oauth_client_id: string;
        mack_client_id: string;
        user_id: string;
        resource: string;
      }>(
        env.DB,
        'DELETE FROM oauth_refresh_tokens WHERE token_hash=? AND expires_at>? RETURNING oauth_client_id,mack_client_id,user_id,resource',
        await hash(refresh),
        Date.now(),
      );
      if (!row) {
        throw new OAuthError('invalid_grant', 'Refresh token is invalid or expired.');
      }
      if (row.oauth_client_id !== client.id) {
        await run(
          env.DB,
          'DELETE FROM oauth_refresh_tokens WHERE mack_client_id=?',
          row.mack_client_id,
        );
        throw new OAuthError('invalid_grant', 'Refresh token is invalid or expired.');
      }
      if (row.resource !== resource)
        throw new OAuthError('invalid_grant', 'resource does not match this refresh token.');
      const mack = await first<{ id: string; revoked_at: string | null }>(
        env.DB,
        'SELECT id,revoked_at FROM clients WHERE id=?',
        row.mack_client_id,
      );
      if (!mack || mack.revoked_at)
        throw new OAuthError('invalid_grant', 'This client has been revoked.');
      return issueTokens(env, client, row.mack_client_id, row.user_id, resource);
    }
    default: {
      const _never: never = grantType;
      throw new OAuthError('unsupported_grant_type', `Unsupported grant: ${_never}`);
    }
  }
}

export async function revokeToken(request: Request, env: Env) {
  const type = request.headers.get('content-type') || '';
  if (type && !type.startsWith('application/x-www-form-urlencoded'))
    throw new OAuthError(
      'invalid_request',
      'Revocation requests must use application/x-www-form-urlencoded.',
    );
  const params = new URLSearchParams(await request.text());
  const client = await authenticateOAuthClient(request, params, env);
  const value = params.get('token') || '';
  if (!value) throw new OAuthError('invalid_request', 'token is required.');
  const digest = await hash(value);
  const hint = params.get('token_type_hint');
  if (hint === 'access_token')
    await run(
      env.DB,
      'DELETE FROM oauth_access_tokens WHERE token_hash=? AND oauth_client_id=?',
      digest,
      client.id,
    );
  else if (hint === 'refresh_token')
    await run(
      env.DB,
      'DELETE FROM oauth_refresh_tokens WHERE token_hash=? AND oauth_client_id=?',
      digest,
      client.id,
    );
  else {
    await run(
      env.DB,
      'DELETE FROM oauth_refresh_tokens WHERE token_hash=? AND oauth_client_id=?',
      digest,
      client.id,
    );
    await run(
      env.DB,
      'DELETE FROM oauth_access_tokens WHERE token_hash=? AND oauth_client_id=?',
      digest,
      client.id,
    );
  }
  return new Response(null, { status: 200, headers: corsHeaders() });
}

export function metadataDocument(env: Env) {
  const origin = issuer(env);
  const resource = resourceUrl(env);
  return {
    resource: {
      resource,
      authorization_servers: [origin],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp'],
      resource_documentation: env.WEB_ORIGIN,
    },
    authorizationServer: {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      revocation_endpoint: `${origin}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      revocation_endpoint_auth_methods_supported: [
        'none',
        'client_secret_post',
        'client_secret_basic',
      ],
      scopes_supported: ['mcp'],
      authorization_response_iss_parameter_supported: true,
      client_id_metadata_document_supported: true,
      require_pkce: true,
    },
  };
}

export { canonicalResource };
