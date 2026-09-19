CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  client_name TEXT NOT NULL,
  token_endpoint_auth_method TEXT NOT NULL,
  client_secret_hash TEXT,
  redirect_uris TEXT NOT NULL,
  grant_types TEXT NOT NULL,
  response_types TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  kind TEXT NOT NULL CHECK(kind IN ('dcr','cimd')),
  fetched_at INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE oauth_authz_requests (
  request_hash TEXT PRIMARY KEY,
  encrypted_payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE oauth_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  oauth_client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  mack_client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE oauth_access_tokens (
  token_hash TEXT PRIMARY KEY,
  oauth_client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  mack_client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  oauth_client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  mack_client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
ALTER TABLE clients ADD COLUMN oauth_client_id TEXT REFERENCES oauth_clients(id);
CREATE INDEX oauth_access_tokens_client ON oauth_access_tokens(mack_client_id);
CREATE INDEX oauth_refresh_tokens_client ON oauth_refresh_tokens(mack_client_id);
CREATE INDEX clients_oauth_client ON clients(oauth_client_id);
