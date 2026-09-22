import { assess, definitionHash } from '../../classification/src/index';
import type { Tool as RemoteTool } from '@modelcontextprotocol/sdk/types.js';
import { all, run, type Env } from '../../db/src/index';
import { withRemote, type Credentials } from '../../mcp/src/index';
import { id, type AccessMode, type Connection, type Risk, type Tool } from '../../shared/src/index';
export function classify(name: string, annotations?: RemoteTool['annotations']): Risk {
  if (
    /(delete|remove|destroy|transfer|publish|admin|revoke|execute|shell|eval|sql|run_code)/i.test(
      name,
    ) ||
    annotations?.destructiveHint === true
  )
    return 'admin';
  if (/^(get|list|search|fetch|read|find|query|count)[_.-]/i.test(name)) return 'read';
  return 'write';
}
export function namespace(name: string, connectionId: string) {
  return `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 32) || 'server'
  }_${connectionId.slice(-12)}`;
}
export async function publicName(prefix: string, remoteName: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(remoteName)),
  );
  const digest = Array.from(bytes.slice(0, 6), (b) => b.toString(16).padStart(2, '0')).join('');
  const base = `${prefix}_${remoteName.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
  return /^[a-zA-Z0-9_.-]+$/.test(remoteName) && base.length <= 128
    ? base
    : `${base.slice(0, 115)}_${digest}`;
}
export async function discover(env: Env, connection: Connection, credentials?: Credentials) {
  return withRemote(
    env,
    connection,
    async (remote) => {
      const capabilities = remote.getServerCapabilities() || {};
      const tools: RemoteTool[] = [];
      let cursor: string | undefined;
      if (capabilities.tools) {
        const seen = new Set<string>();
        do {
          const page = await remote.listTools(cursor ? { cursor } : undefined);
          tools.push(...page.tools);
          cursor = page.nextCursor;
          if (tools.length > 1000 || (cursor && seen.has(cursor)))
            throw new Error('Invalid or excessive remote pagination');
          if (cursor) seen.add(cursor);
        } while (cursor);
      }
      const resources = capabilities.resources ? await remote.listResources() : undefined;
      const prompts = capabilities.prompts ? await remote.listPrompts() : undefined;
      if (new Set(tools.map((t) => t.name)).size !== tools.length)
        throw new Error('Duplicate remote tool names');
      return {
        tools,
        capabilities: {
          ...capabilities,
          resourceCount: resources?.resources.length || 0,
          promptCount: prompts?.prompts.length || 0,
        },
      };
    },
    credentials,
  );
}
export async function saveDiscovery(
  env: Env,
  connection: Connection,
  discovery: Awaited<ReturnType<typeof discover>>,
) {
  const previous = await all<Tool>(
    env.DB,
    'SELECT * FROM tools WHERE connection_id=?',
    connection.id,
  );
  const statements = [];
  for (const t of discovery.tools) {
    const old = previous.find((p) => p.remote_name === t.name);
    const risk = classify(t.name, t.annotations);
    const digest = await definitionHash(t);
    if (old?.definition_hash === digest) continue;
    // Revoke the old definition before waiting on an external classification service.
    statements.push(
      env.DB.prepare(
        `INSERT INTO tools(id,connection_id,remote_name,public_name,description,input_schema,risk_level,enabled,definition_hash,risk_floor,review_state,classification_status) VALUES(?,?,?,?,?,?,?,0,?,?,'pending','pending') ON CONFLICT(connection_id,remote_name) DO UPDATE SET description=excluded.description,input_schema=excluded.input_schema,risk_level=excluded.risk_level,enabled=0,definition_hash=excluded.definition_hash,risk_floor=excluded.risk_floor,review_state='pending',classification_status='pending',suggested_risk=NULL,classification_probability=NULL,reviewed_by=NULL,reviewed_at=NULL,review_note=NULL`,
      ).bind(
        old?.id || id('tool'),
        connection.id,
        t.name,
        await publicName(connection.namespace, t.name),
        t.description || '',
        JSON.stringify(t.inputSchema),
        risk,
        digest,
        risk === 'admin' ? 'admin' : 'read',
      ),
    );
  }
  for (const old of previous)
    if (!discovery.tools.some((t) => t.name === old.remote_name))
      statements.push(env.DB.prepare('DELETE FROM tools WHERE id=?').bind(old.id));
  statements.push(
    env.DB.prepare("UPDATE connections SET status='connected',capabilities=? WHERE id=?").bind(
      JSON.stringify(discovery.capabilities),
      connection.id,
    ),
  );
  await env.DB.batch(statements);
  // Bound concurrency and total external evaluations per discovery.
  let evaluations = 0;
  const deadline = Date.now() + 20000;
  for (const t of discovery.tools) {
    const digest = await definitionHash(t);
    const old = previous.find((p) => p.remote_name === t.name);
    if (
      old?.definition_hash === digest &&
      !(
        env.AI_GATEWAY_API_KEY &&
        ['error', 'not_configured', 'pending'].includes(old.classification_status)
      )
    )
      continue;
    const result =
      evaluations++ < 20 && Date.now() < deadline
        ? await assess(t, connection.is_demo ? undefined : env.AI_GATEWAY_API_KEY)
        : { status: 'uncertain', suggestion: 'unknown', probability: null };
    await run(
      env.DB,
      'UPDATE tools SET classification_status=?,suggested_risk=?,classification_probability=? WHERE connection_id=? AND remote_name=? AND definition_hash=?',
      result.status,
      result.suggestion,
      result.probability,
      connection.id,
      t.name,
      digest,
    );
  }
}

export async function applyConnectionAccessMode(
  env: Env,
  connectionId: string,
  reviewerId: string,
  mode: AccessMode,
) {
  const tools = await all<Tool>(env.DB, 'SELECT * FROM tools WHERE connection_id=?', connectionId);
  const note = `Enabled by connection access policy: ${mode.replace('_', ' + ')}`;
  const statements = [
    env.DB.prepare('UPDATE connections SET access_mode=? WHERE id=?').bind(mode, connectionId),
  ];
  for (const tool of tools) {
    const allowed =
      tool.risk_floor !== 'admin' &&
      tool.risk_level !== 'admin' &&
      Boolean(tool.definition_hash) &&
      (mode === 'read_write' || tool.risk_level === mode);
    if (!allowed) {
      statements.push(env.DB.prepare('UPDATE tools SET enabled=0 WHERE id=?').bind(tool.id));
      continue;
    }
    if (tool.review_state !== 'reviewed')
      statements.push(
        env.DB.prepare(
          'INSERT INTO tool_reviews(id,tool_id,definition_hash,reviewer_id,risk_level,note) VALUES(?,?,?,?,?,?)',
        ).bind(id('review'), tool.id, tool.definition_hash, reviewerId, tool.risk_level, note),
      );
    statements.push(
      env.DB.prepare(
        "UPDATE tools SET review_state='reviewed',enabled=1,reviewed_by=?,reviewed_at=datetime('now'),review_note=? WHERE id=?",
      ).bind(reviewerId, note, tool.id),
    );
  }
  await env.DB.batch(statements);
}
