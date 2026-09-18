import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { first, type Env } from '../../db/src/index';
import { decrypt } from '../../crypto/src/index';
import { HttpError, type Connection } from '../../shared/src/index';
export interface Credentials {
  token: string;
  header?: string;
}
const defaultHosts = [
  'api.githubcopilot.com',
  'mcp.linear.app',
  'mcp.notion.com',
  'mcp.slack.com',
  'mcp.stripe.com',
];
export function validateServerUrl(
  raw: string,
  env: Pick<Env, 'DEV_REMOTE_ORIGIN' | 'MCP_ALLOWED_HOSTS'>,
) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, 'Enter a valid MCP server URL.');
  }
  if (url.username || url.password || url.hash || url.search)
    throw new HttpError(
      400,
      'Server URLs cannot contain credentials, query strings, or fragments.',
    );
  if (env.DEV_REMOTE_ORIGIN && url.origin === env.DEV_REMOTE_ORIGIN) return url;
  if (url.protocol !== 'https:' || (url.port && url.port !== '443'))
    throw new HttpError(400, 'Remote servers must use HTTPS on port 443.');
  const hosts =
    env.MCP_ALLOWED_HOSTS?.split(',').map((x) => x.trim().toLowerCase()) || defaultHosts;
  if (!hosts.includes(url.hostname.toLowerCase()))
    throw new HttpError(
      400,
      `This server host is not allowed. Add ${url.hostname} to MCP_ALLOWED_HOSTS on both Workers first.`,
    );
  return url;
}
export async function withRemote<T>(
  env: Env,
  connection: Pick<Connection, 'id' | 'server_url' | 'auth_type'>,
  action: (client: Client) => Promise<T>,
  supplied?: Credentials,
): Promise<T> {
  const url = validateServerUrl(connection.server_url, env);
  let credentials = supplied;
  if (!credentials && connection.auth_type !== 'none') {
    const row = await first<{ encrypted_credentials: string }>(
      env.DB,
      'SELECT encrypted_credentials FROM connection_credentials WHERE connection_id=?',
      connection.id,
    );
    if (!row) throw new HttpError(409, 'Reconnect this server to restore its credentials.');
    credentials = await decrypt<Credentials>(
      row.encrypted_credentials,
      env.ENCRYPTION_KEY,
      connection.id,
    );
  }
  const headers: Record<string, string> = {};
  if (credentials) {
    if (connection.auth_type === 'bearer') headers.Authorization = `Bearer ${credentials.token}`;
    if (connection.auth_type === 'api_key')
      headers[credentials.header || 'X-API-Key'] = credentials.token;
  }
  const client = new Client({ name: 'mack', version: '0.1.0' });
  const safeFetch: typeof fetch = async (input, init) => {
    const target = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (target.origin !== url.origin || target.pathname !== url.pathname)
      throw new HttpError(502, 'Remote server attempted to change its endpoint.');
    const response = await fetch(input, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.any([AbortSignal.timeout(20000), ...(init?.signal ? [init.signal] : [])]),
    });
    if (Number(response.headers.get('content-length') || 0) > 4 * 1024 * 1024)
      throw new HttpError(502, 'Remote response exceeds 4 MB.');
    if (!response.body) return response;
    let received = 0;
    const bounded = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.byteLength;
          if (received > 4 * 1024 * 1024) {
            controller.error(new Error('Remote response exceeds 4 MB.'));
            return;
          }
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(bounded, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers },
    fetch: safeFetch,
  });
  try {
    await client.connect(transport);
    return await action(client);
  } finally {
    await transport.terminateSession().catch(() => undefined);
    await client.close().catch(() => undefined);
  }
}
