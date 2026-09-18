import { validateToolArguments } from './schema';
import { first, run, type Env } from '../../../packages/db/src/index';
import { canUse } from '../../../packages/permissions/src/index';
import { withRemote } from '../../../packages/mcp/src/index';
import {
  HttpError,
  id,
  type Client,
  type Connection,
  type Tool,
} from '../../../packages/shared/src/index';
const sensitive = /token|password|secret|authorization|credential|api.?key/i;
function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[nested]';
  if (Array.isArray(value)) return value.slice(0, 30).map((x) => redact(x, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        sensitive.test(k) ? '[redacted]' : redact(v, depth + 1),
      ]),
    );
  return typeof value === 'string' && value.length > 1000 ? value.slice(0, 1000) + '…' : value;
}
export async function executeTool(
  env: Env,
  userId: string,
  name: string,
  args: Record<string, unknown>,
  client?: Client,
) {
  const start = Date.now();
  const tool = await first<Tool>(env.DB, 'SELECT * FROM tools WHERE public_name=?', name);
  const connection = tool
    ? await first<Connection>(env.DB, 'SELECT * FROM connections WHERE id=?', tool.connection_id)
    : null;
  let status: 'success' | 'denied' | 'error' = 'error';
  let error: string | null = null;
  try {
    if (!tool || !connection || !(await canUse(env.DB, userId, connection, tool, client))) {
      status = 'denied';
      throw new HttpError(403, 'This tool is unavailable or not permitted.');
    }
    let valid: boolean;
    try {
      valid = validateToolArguments(tool.input_schema, args);
    } catch {
      throw new HttpError(400, 'The remote tool schema is not supported.');
    }
    if (!valid) throw new HttpError(400, 'Arguments do not match the tool input schema.');
    const result = await withRemote(env, connection, (remote) =>
      remote.callTool({ name: tool.remote_name, arguments: args }),
    );
    status = result.isError ? 'error' : 'success';
    if (result.isError) error = 'Remote tool reported an error.';
    return result;
  } catch (e) {
    error =
      e instanceof HttpError
        ? e.message
        : 'Remote MCP request failed. Check the server URL and credentials.';
    throw e instanceof HttpError ? e : new HttpError(502, error);
  } finally {
    // Denied calls do not reveal the existence or owner of another user's connection.
    await run(
      env.DB,
      `INSERT INTO tool_calls(id,user_id,workspace_id,client_id,client_name,connection_id,connection_name,tool_id,tool_name,arguments,status,duration_ms,error) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id('call'),
      userId,
      status === 'denied' ? null : (connection?.workspace_id ?? null),
      client?.id ?? null,
      client?.name || 'Mack playground',
      status === 'denied' ? null : (connection?.id ?? null),
      status === 'denied' ? 'Unavailable' : connection?.name || 'Unknown',
      status === 'denied' ? null : (tool?.id ?? null),
      name,
      JSON.stringify(redact(args)).slice(0, 12000),
      status,
      Date.now() - start,
      error,
    );
  }
}
