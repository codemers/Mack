import { HttpError } from '../../shared/src/index';
import type { Env } from '../../db/src/index';

export class OAuthError extends Error {
  constructor(
    public error: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export const ACCESS_TTL_MS = 3600 * 1000;
export const REFRESH_TTL_MS = 30 * 86400 * 1000;
export const CODE_TTL_MS = 10 * 60 * 1000;
const encoder = new TextEncoder();

export function issuer(env: Env) {
  return new URL(env.GATEWAY_URL).origin;
}

export function resourceUrl(env: Env) {
  return canonicalResource(env.GATEWAY_URL);
}

export function mcpPath(env: Env) {
  const path = new URL(env.GATEWAY_URL).pathname;
  return path === '/' ? '' : path.replace(/\/$/, '');
}

export function canonicalResource(value: string) {
  const url = new URL(value);
  url.hash = '';
  url.username = '';
  url.password = '';
  if (
    (url.protocol === 'https:' && url.port === '443') ||
    (url.protocol === 'http:' && url.port === '80')
  )
    url.port = '';
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, '');
  return url.href;
}

export function sameResource(env: Env, value: string | null) {
  if (!value) return resourceUrl(env);
  try {
    if (canonicalResource(value) !== resourceUrl(env))
      throw new OAuthError('invalid_target', 'The resource does not match this Mack gateway.');
    return resourceUrl(env);
  } catch (error) {
    if (error instanceof OAuthError) throw error;
    throw new OAuthError('invalid_target', 'The resource is not a valid URL.');
  }
}

export function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
  };
}

export function oauthJson(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...corsHeaders(), ...extra } });
}

export function oauthErrorResponse(error: unknown) {
  if (error instanceof OAuthError)
    return oauthJson({ error: error.error, error_description: error.message }, error.status);
  console.error('OAuth error:', error instanceof Error ? error.name : 'Unknown');
  return oauthJson(
    { error: 'server_error', error_description: 'The request could not be completed.' },
    500,
  );
}

export function challengeHeaders(env: Env, invalid = false) {
  const params = [
    `realm="mack"`,
    `resource_metadata="${issuer(env)}/.well-known/oauth-protected-resource"`,
    `scope="mcp"`,
  ];
  if (invalid) params.splice(1, 0, 'error="invalid_token"');
  return { 'WWW-Authenticate': `Bearer ${params.join(', ')}` };
}

export async function pkceChallenge(verifier: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier)));
  return btoa(String.fromCharCode(...digest))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export function timingEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isPrivateHostname(host: string) {
  const hostname = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  )
    return true;
  const ipv4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(hostname);
  if (ipv4) {
    const [a, b] = ipv4.slice(1, 3).map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80');
}

export function isLoopbackHostname(host: string) {
  const hostname = host.toLowerCase().replace(/^\[|\]$/g, '');
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
}

export function assertRedirectUri(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OAuthError('invalid_request', 'Redirect URI is not a valid URL.');
  }
  if (url.username || url.password || url.hash)
    throw new OAuthError(
      'invalid_request',
      'Redirect URI cannot include credentials or a fragment.',
    );
  if (url.protocol === 'https:') {
    if (isPrivateHostname(url.hostname) && !isLoopbackHostname(url.hostname))
      throw new OAuthError('invalid_request', 'Redirect URI host is not allowed.');
    return url.href;
  }
  if (url.protocol === 'http:' && isLoopbackHostname(url.hostname)) return url.href;
  if (
    /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) &&
    !['javascript:', 'data:', 'file:', 'vbscript:'].includes(url.protocol)
  )
    return url.href;
  throw new OAuthError(
    'invalid_request',
    'Redirect URI must be HTTPS, loopback HTTP, or a native app URI.',
  );
}

export function assertCimdUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OAuthError('invalid_client', 'Client ID metadata URL is invalid.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new OAuthError('invalid_client', 'Client ID metadata documents must be HTTPS URLs.');
  if (url.port && url.port !== '443')
    throw new OAuthError('invalid_client', 'Client ID metadata documents must use port 443.');
  if (!url.pathname || url.pathname === '/')
    throw new OAuthError('invalid_client', 'Client ID metadata documents must include a path.');
  if (isPrivateHostname(url.hostname) || isLoopbackHostname(url.hostname))
    throw new OAuthError(
      'invalid_client',
      'Client ID metadata documents cannot use private hosts.',
    );
  return url;
}

export function clientType(name: string, clientId: string) {
  const value = `${name} ${clientId}`.toLowerCase();
  if (value.includes('chatgpt') || value.includes('openai')) return 'chatgpt';
  if (value.includes('claude') || value.includes('anthropic')) return 'claude';
  if (value.includes('cursor')) return 'cursor';
  if (value.includes('windsurf')) return 'windsurf';
  return 'custom';
}

export function requestIp(request: Request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'local'
  );
}

export function asHttpError(error: unknown) {
  if (error instanceof HttpError) return error;
  if (error instanceof OAuthError) return new HttpError(error.status, error.message);
  return new HttpError(500, 'The request could not be completed. Please try again.');
}
