import { all, first, type Database } from '../../db/src/index';
import {
  HttpError,
  type Connection,
  type Tool,
  type Grant,
  type Client,
  type Role,
  type Permission,
} from '../../shared/src/index';
const levels: Record<Permission, number> = { none: 0, read: 1, write: 2, admin: 3 };
export async function role(db: Database, workspaceId: string, userId: string) {
  return (
    await first<{ role: Role }>(
      db,
      'SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?',
      workspaceId,
      userId,
    )
  )?.role;
}
export async function requireManager(db: Database, workspaceId: string, userId: string) {
  const r = await role(db, workspaceId, userId);
  if (r !== 'owner' && r !== 'admin')
    throw new HttpError(403, 'Workspace admin access is required.');
}
export async function canManage(db: Database, connection: Connection, userId: string) {
  if (connection.scope === 'personal') return connection.user_id === userId;
  const r = await role(db, connection.workspace_id!, userId);
  return r === 'owner' || r === 'admin';
}
function grantLevel(grants: Grant[], tool: Tool) {
  const applicable = grants.filter((g) => !g.tool_id || g.tool_id === tool.id);
  if (applicable.some((g) => g.permission === 'none')) return 0;
  const exact = applicable.filter((g) => g.tool_id === tool.id);
  return Math.max(0, ...(exact.length ? exact : applicable).map((g) => levels[g.permission]));
}
export async function canUse(
  db: Database,
  userId: string,
  connection: Connection,
  tool: Tool,
  client?: Client,
) {
  if (tool.review_state !== 'reviewed' || !tool.enabled || connection.status !== 'connected')
    return false;
  if (client && (client.user_id !== userId || client.revoked_at)) return false;
  let userLevel = 0;
  if (connection.scope === 'personal') {
    if (connection.user_id !== userId) return false;
    userLevel = 3;
  } else {
    if (client && connection.workspace_id !== client.workspace_id) return false;
    const r = await role(db, connection.workspace_id!, userId);
    if (!r) return false;
    if (r === 'owner' || r === 'admin') userLevel = 3;
    else {
      const grants = await all<Grant>(
        db,
        `SELECT p.* FROM permissions p WHERE p.connection_id=? AND ((p.subject_type='user' AND p.subject_id=?) OR (p.subject_type='team' AND p.subject_id IN (SELECT tm.team_id FROM team_members tm JOIN teams t ON t.id=tm.team_id WHERE tm.user_id=? AND t.workspace_id=?)))`,
        connection.id,
        userId,
        userId,
        connection.workspace_id,
      );
      userLevel = grantLevel(grants, tool);
    }
  }
  if (userLevel < levels[tool.risk_level]) return false;
  if (client) {
    const grants = await all<Grant>(
      db,
      "SELECT * FROM permissions WHERE connection_id=? AND subject_type='client' AND subject_id=?",
      connection.id,
      client.id,
    );
    return grantLevel(grants, tool) >= levels[tool.risk_level];
  }
  return true;
}
export async function visibleConnections(
  db: Database,
  userId: string,
  workspaceId?: string | null,
): Promise<Connection[]> {
  return all<Connection>(
    db,
    `SELECT c.* FROM connections c WHERE (c.scope='personal' AND c.user_id=?) OR (c.scope='workspace' AND c.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=?) AND (? IS NULL OR c.workspace_id=?)) ORDER BY c.created_at,c.name`,
    userId,
    userId,
    workspaceId ?? null,
    workspaceId ?? null,
  );
}
export async function availableTools(db: Database, userId: string, client?: Client) {
  const connections = await visibleConnections(db, userId, client?.workspace_id);
  const result: (Tool & { connection: Connection })[] = [];
  for (const connection of connections)
    for (const tool of await all<Tool>(
      db,
      'SELECT * FROM tools WHERE connection_id=? ORDER BY public_name',
      connection.id,
    ))
      if (await canUse(db, userId, connection, tool, client)) result.push({ ...tool, connection });
  return result.sort((a, b) => a.public_name.localeCompare(b.public_name));
}
