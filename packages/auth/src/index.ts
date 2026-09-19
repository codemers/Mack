import { first, run, type Env, type Database } from '../../db/src/index';
import { hash } from '../../crypto/src/index';
import { HttpError, type User, type Client } from '../../shared/src/index';
import { canonicalResource } from '../../oauth-server/src/util';
export async function sessionUser(request: Request, env: Env): Promise<User> {
  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith('mack_session='))
    ?.slice(13);
  if (cookie) {
    const user = await first<User>(
      env.DB,
      'SELECT u.id,u.email,u.name FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.credential_hash=? AND s.expires_at>?',
      await hash(cookie),
      Date.now(),
    );
    if (user) return user;
  }
  if (env.DEMO_MODE === 'true') {
    const user = await first<User>(
      env.DB,
      'SELECT id,email,name FROM users WHERE id=?',
      'user_demo',
    );
    if (user) return user;
  }
  throw new HttpError(401, 'Sign in to continue.');
}
function gatewayResource(value: string) {
  return canonicalResource(value);
}

export async function authenticateClient(request: Request, env: Env): Promise<Client> {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer '))
    throw new HttpError(401, 'A Mack client token is required.');
  const digest = await hash(authorization.slice(7));
  const oauth = await first<Client & { resource: string }>(
    env.DB,
    'SELECT c.*, t.resource FROM oauth_access_tokens t JOIN clients c ON c.id=t.mack_client_id WHERE t.token_hash=? AND t.expires_at>? AND c.revoked_at IS NULL',
    digest,
    Date.now(),
  );
  const client =
    oauth && gatewayResource(oauth.resource) === gatewayResource(env.GATEWAY_URL)
      ? oauth
      : await first<Client>(
          env.DB,
          'SELECT * FROM clients WHERE credential_hash=? AND revoked_at IS NULL',
          digest,
        );
  if (!client) throw new HttpError(401, 'Invalid or revoked client token.');
  if (
    client.workspace_id &&
    !(await first(
      env.DB,
      'SELECT 1 FROM workspace_members WHERE workspace_id=? AND user_id=?',
      client.workspace_id,
      client.user_id,
    ))
  )
    throw new HttpError(403, 'Workspace membership has been removed.');
  return client;
}
export async function rateLimit(db: Database, key: string, limit = 120, windowMs = 60000) {
  const now = Date.now();
  const row = await first<{ count: number }>(
    db,
    `INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END, reset_at=CASE WHEN reset_at<=? THEN ? ELSE reset_at END RETURNING count`,
    key,
    now + windowMs,
    now,
    now,
    now + windowMs,
  );
  if (row && row.count > limit)
    throw new HttpError(429, 'Too many requests. Try again in a minute.');
}
export function checkOrigin(request: Request, env: Env) {
  const origin = request.headers.get('origin');
  if (origin && origin !== env.WEB_ORIGIN) throw new HttpError(403, 'Origin is not allowed.');
}
