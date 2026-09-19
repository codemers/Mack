import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { authenticateClient, checkOrigin, rateLimit } from '../../../packages/auth/src/index';
import { availableTools } from '../../../packages/permissions/src/index';
import { run, type Env } from '../../../packages/db/src/index';
import { HttpError } from '../../../packages/shared/src/index';
import {
  challengeHeaders,
  handleAuthorizationServer,
} from '../../../packages/oauth-server/src/index';
import { executeTool } from './service';
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ service: 'mack-gateway', status: 'ok' });
    const oauth = await handleAuthorizationServer(request, env);
    if (oauth) return oauth;
    if (url.pathname !== '/mcp') return Response.json({ error: 'Not found' }, { status: 404 });
    try {
      checkOrigin(request, env);
      const client = await authenticateClient(request, env);
      await rateLimit(env.DB, `client:${client.id}`);
      if (Number(request.headers.get('content-length') || 0) > 1024 * 1024)
        throw new HttpError(413, 'Request is too large.');
      if (request.method === 'POST' && request.body) {
        const reader = request.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1024 * 1024) {
            await reader.cancel();
            throw new HttpError(413, 'Request is too large.');
          }
          chunks.push(value);
        }
        const body = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.byteLength;
        }
        request = new Request(request, { body });
      }
      const server = new Server(
        { name: 'mack', version: '0.1.0' },
        { capabilities: { tools: {} } },
      );
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: (await availableTools(env.DB, client.user_id, client)).map((t) => ({
          name: t.public_name,
          description: `${t.connection.name}: ${t.description}`,
          inputSchema: JSON.parse(t.input_schema),
          annotations: {
            readOnlyHint: t.risk_level === 'read',
            destructiveHint: t.risk_level === 'admin',
          },
        })),
      }));
      server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
        try {
          return await executeTool(
            env,
            client.user_id,
            params.name,
            params.arguments || {},
            client,
          );
        } catch (e) {
          if (e instanceof HttpError && e.status === 403)
            throw new McpError(
              ErrorCode.InvalidParams,
              'This tool is unavailable or not permitted.',
            );
          return {
            isError: true,
            content: [
              { type: 'text', text: e instanceof HttpError ? e.message : 'Tool call failed.' },
            ],
          };
        }
      });
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      let response: Response;
      try {
        response = await transport.handleRequest(request);
      } finally {
        await server.close();
      }
      await run(
        env.DB,
        "UPDATE clients SET last_used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
        client.id,
      );
      return response;
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      return Response.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32000,
            message: e instanceof HttpError ? e.message : 'Gateway request failed.',
          },
        },
        {
          status,
          headers:
            status === 401 ? challengeHeaders(env, request.headers.has('authorization')) : {},
        },
      );
    }
  },
};
