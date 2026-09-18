export type Risk = 'read' | 'write' | 'admin';
export type Permission = 'none' | Risk;
export type Role = 'owner' | 'admin' | 'member';
export interface User {
  id: string;
  name: string;
  email: string;
}
export interface Connection {
  oauth_provider?: string | null;
  id: string;
  scope: 'personal' | 'workspace';
  user_id: string | null;
  workspace_id: string | null;
  name: string;
  provider: string;
  namespace: string;
  server_url: string;
  auth_type: 'none' | 'bearer' | 'api_key';
  status: 'connected' | 'error' | 'paused';
  is_demo: number;
  capabilities: string;
  created_at: string;
}
export interface Tool {
  id: string;
  connection_id: string;
  remote_name: string;
  public_name: string;
  description: string;
  input_schema: string;
  risk_level: Risk;
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
export interface Client {
  id: string;
  user_id: string;
  workspace_id: string | null;
  name: string;
  type: string;
  credential_hash: string;
  token_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}
export interface Grant {
  id: string;
  workspace_id: string | null;
  connection_id: string;
  tool_id: string | null;
  subject_type: 'user' | 'team' | 'client';
  subject_id: string;
  permission: Permission;
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}
