ALTER TABLE connections ADD COLUMN oauth_provider TEXT;
CREATE TABLE oauth_requests (
 state_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 encrypted_payload TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE oauth_refresh_locks (
 connection_id TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
 owner TEXT NOT NULL, expires_at INTEGER NOT NULL
);
