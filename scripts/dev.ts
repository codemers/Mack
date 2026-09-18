import { createServer } from 'node:http';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { LocalDatabase } from './database';
import { fixtureFetch } from './fixtures';
import { seed } from './seed';
import api from '../apps/api/src/index';
import gateway from '../apps/gateway/src/index';
import type { Env } from '../packages/db/src/index';
mkdirSync('.data', { recursive: true });
if (!existsSync('.data/encryption.key'))
  writeFileSync('.data/encryption.key', randomBytes(32).toString('base64'), { mode: 0o600 });
const env: Env = {
  DB: new LocalDatabase('.data/mack.sqlite'),
  ENCRYPTION_KEY: readFileSync('.data/encryption.key', 'utf8').trim(),
  WEB_ORIGIN: 'http://127.0.0.1:3000',
  GATEWAY_URL: 'http://127.0.0.1:8788/mcp',
  DEMO_MODE: process.env.DEMO_MODE ?? 'true',
  DEV_REMOTE_ORIGIN: 'http://127.0.0.1:8790',
  AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
  MCP_ALLOWED_HOSTS: process.env.MCP_ALLOWED_HOSTS,
};
async function listen(port: number, handler: (request: Request) => Promise<Response> | Response) {
  const server = createServer(async (req, res) => {
    try {
      if (!['127.0.0.1', 'localhost'].includes((req.headers.host || '').split(':')[0])) {
        res.writeHead(403);
        res.end('Host not allowed');
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) {
          res.writeHead(413);
          res.end('Request too large');
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers))
        if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      const body = Buffer.concat(chunks);
      const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
        method: req.method,
        headers,
        ...(body.length ? { body } : {}),
      });
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(500);
      res.end('Local request failed.');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}
const servers: ReturnType<typeof createServer>[] = [];
try {
  servers.push(await listen(8790, fixtureFetch));
  if (env.DEMO_MODE === 'true') await seed(env);
  servers.push(await listen(8787, (request) => api.fetch(request, env)));
  servers.push(await listen(8788, (request) => gateway.fetch(request, env)));
  const web = spawn('npm', ['run', 'dev:web'], { stdio: 'inherit', env: process.env });
  console.log(
    '\nMack is starting at http://127.0.0.1:3000\nMCP gateway: http://127.0.0.1:8788/mcp\nDemo data is stored in .data/mack.sqlite.\n',
  );
  const stop = () => {
    web.kill('SIGTERM');
    for (const server of servers) server.close();
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  web.on('exit', stop);
} catch (e) {
  for (const server of servers) server.close();
  console.error(e);
  process.exit(1);
}
