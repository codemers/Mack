import { first, run, type Env } from '../packages/db/src/index';
import { discover, saveDiscovery } from '../packages/tool-registry/src/index';
import { providers } from './fixtures';
import type { Connection } from '../packages/shared/src/index';
export async function seed(env: Env) {
  if (await first(env.DB, 'SELECT id FROM users WHERE id=?', 'user_demo')) return;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users(id,email,name) VALUES(?,?,?)').bind(
      'user_demo',
      'alex@example.com',
      'Alex Morgan',
    ),
    env.DB.prepare('INSERT INTO users(id,email,name) VALUES(?,?,?)').bind(
      'user_marie',
      'marie@example.com',
      'Marie Chen',
    ),
    env.DB.prepare('INSERT INTO users(id,email,name) VALUES(?,?,?)').bind(
      'user_john',
      'john@example.com',
      'John Park',
    ),
    env.DB.prepare('INSERT INTO workspaces(id,name,slug,created_by) VALUES(?,?,?,?)').bind(
      'ws_apprentx',
      'Apprentx',
      'apprentx',
      'user_demo',
    ),
    env.DB.prepare(
      "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES('ws_apprentx','user_demo','owner'),('ws_apprentx','user_marie','member'),('ws_apprentx','user_john','admin')",
    ),
    env.DB.prepare(
      "INSERT INTO teams(id,workspace_id,name) VALUES('team_engineering','ws_apprentx','Engineering')",
    ),
    env.DB.prepare(
      "INSERT INTO team_members(team_id,user_id) VALUES('team_engineering','user_demo'),('team_engineering','user_marie')",
    ),
  ]);
  for (const [provider, def] of Object.entries(providers)) {
    const personal = ['gmail', 'drive'].includes(provider);
    const connectionId = `demo_${provider}`;
    await run(
      env.DB,
      'INSERT INTO connections(id,scope,user_id,workspace_id,name,provider,namespace,server_url,auth_type,status,is_demo) VALUES(?,?,?,?,?,?,?,?,?,?,1)',
      connectionId,
      personal ? 'personal' : 'workspace',
      personal ? 'user_demo' : null,
      personal ? null : 'ws_apprentx',
      def.name,
      provider,
      provider,
      `${env.DEV_REMOTE_ORIGIN}/${provider}/mcp`,
      'none',
      'connected',
    );
    const connection = (await first<Connection>(
      env.DB,
      'SELECT * FROM connections WHERE id=?',
      connectionId,
    ))!;
    await saveDiscovery(env, connection, await discover(env, connection));
    await run(
      env.DB,
      "UPDATE tools SET review_state='reviewed',classification_status='demo',review_note='Bundled demo fixture',enabled=CASE WHEN risk_level='read' THEN 1 ELSE 0 END WHERE connection_id=?",
      connection.id,
    );
    if (!personal)
      await run(
        env.DB,
        "INSERT INTO permissions(id,workspace_id,connection_id,subject_type,subject_id,permission) VALUES(?,? ,?,'team',?,'read')",
        `grant_${provider}`,
        'ws_apprentx',
        connectionId,
        'team_engineering',
      );
  }
}
