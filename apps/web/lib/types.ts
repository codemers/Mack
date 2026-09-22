export type Page = 'connections' | 'chat' | 'clients' | 'activity' | 'team' | 'settings';
export type Permission = 'none' | 'read' | 'write' | 'admin';
export type AccessMode = 'read' | 'write' | 'read_write';
export interface User {
  id: string;
  name: string;
  email: string;
}
export interface Workspace {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
}
export interface Session {
  user: User;
  workspaces: Workspace[];
  demo: boolean;
  gatewayUrl: string;
}
export interface Tool {
  id: string;
  connection_id: string;
  remote_name: string;
  public_name: string;
  description: string;
  input_schema: string;
  risk_level: 'read' | 'write' | 'admin';
  enabled: number;
  definition_hash: string;
  review_state: 'pending' | 'reviewed';
  risk_floor: 'read' | 'admin';
  classification_status: string;
  suggested_risk: string | null;
  classification_probability: number | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}
export interface Connection {
  oauth_provider?: string | null;
  id: string;
  name: string;
  provider: string;
  scope: 'personal' | 'workspace';
  workspace_id: string | null;
  status: 'connected' | 'error' | 'paused';
  server_url: string;
  auth_type: string;
  access_mode: AccessMode;
  is_demo: number;
  tools: Tool[];
  canManage: boolean;
  capabilities: string;
}
export interface Client {
  id: string;
  name: string;
  type: string;
  workspace_id: string | null;
  token_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  oauth_client_id?: string | null;
}
export interface Grant {
  id: string;
  connection_id: string;
  subject_type: 'client' | 'team' | 'user';
  subject_id: string;
  permission: Permission;
  tool_id: string | null;
}
export interface Activity {
  id: string;
  user_name: string;
  client_name: string;
  connection_name: string;
  connection_id: string | null;
  tool_name: string;
  arguments: string;
  status: 'success' | 'error' | 'denied';
  duration_ms: number;
  created_at: string;
  error: string | null;
}
export interface AppData {
  session: Session;
  connections: Connection[];
  clients: Client[];
  grants: Grant[];
  activity: Activity[];
  workspace: string;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
}
