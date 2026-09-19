import type { Env } from '../../db/src/index';
import { corsHeaders, mcpPath, oauthErrorResponse, oauthJson } from './util';
import { registerOAuthClient } from './clients';
import { exchangeToken, metadataDocument, revokeToken, startAuthorization } from './tokens';

export { challengeHeaders, issuer, resourceUrl, withCors } from './util';
export {
  approveIncomingAuthorization,
  denyIncomingAuthorization,
  incomingAuthorizationDetails,
} from './tokens';

function isWellKnown(path: string, suffix: string, extraPath: string) {
  return (
    path === `/.well-known/${suffix}` ||
    path === `/.well-known/${suffix}${extraPath}` ||
    path === `${extraPath}/.well-known/${suffix}`
  );
}

function oauthPath(pathname: string, env: Env) {
  const path = pathname.replace(/\/$/, '') || '/';
  const suffix = mcpPath(env);
  return (
    path.startsWith('/.well-known/') ||
    path === '/oauth/authorize' ||
    path === '/oauth/token' ||
    path === '/oauth/register' ||
    path === '/register' ||
    path === '/oauth/revoke' ||
    (suffix && path === `${suffix}/.well-known/openid-configuration`)
  );
}

export async function handleAuthorizationServer(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '') || '/';
  const suffix = mcpPath(env);
  if (request.method === 'OPTIONS' && oauthPath(path, env))
    return new Response(null, { status: 204, headers: corsHeaders() });
  if (!oauthPath(path, env)) return null;
  try {
    const meta = metadataDocument(env);
    if (isWellKnown(path, 'oauth-protected-resource', suffix)) {
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return oauthJson(
          { error: 'invalid_request', error_description: 'Method not allowed.' },
          405,
        );
      return oauthJson(meta.resource);
    }
    if (
      isWellKnown(path, 'oauth-authorization-server', suffix) ||
      isWellKnown(path, 'openid-configuration', suffix)
    ) {
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return oauthJson(
          { error: 'invalid_request', error_description: 'Method not allowed.' },
          405,
        );
      return oauthJson(meta.authorizationServer);
    }
    if (path === '/oauth/register' || path === '/register') {
      if (request.method !== 'POST')
        return oauthJson(
          { error: 'invalid_request', error_description: 'Method not allowed.' },
          405,
        );
      return await registerOAuthClient(request, env);
    }
    if (path === '/oauth/authorize') {
      if (request.method !== 'GET')
        return oauthJson(
          { error: 'invalid_request', error_description: 'Method not allowed.' },
          405,
        );
      return await startAuthorization(request, env);
    }
    if (path === '/oauth/token') {
      if (request.method !== 'POST')
        return oauthJson(
          { error: 'invalid_request', error_description: 'Method not allowed.' },
          405,
        );
      return await exchangeToken(request, env);
    }
    if (path === '/oauth/revoke') {
      if (request.method !== 'POST')
        return oauthJson(
          { error: 'invalid_request', error_description: 'Method not allowed.' },
          405,
        );
      return await revokeToken(request, env);
    }
    return null;
  } catch (error) {
    return oauthErrorResponse(error);
  }
}
