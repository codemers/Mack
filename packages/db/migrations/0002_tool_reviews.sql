ALTER TABLE tools ADD COLUMN definition_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE tools ADD COLUMN review_state TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE tools ADD COLUMN risk_floor TEXT NOT NULL DEFAULT 'read';
ALTER TABLE tools ADD COLUMN classification_status TEXT NOT NULL DEFAULT 'not_configured';
ALTER TABLE tools ADD COLUMN suggested_risk TEXT;
ALTER TABLE tools ADD COLUMN classification_probability REAL;
ALTER TABLE tools ADD COLUMN reviewed_by TEXT;
ALTER TABLE tools ADD COLUMN reviewed_at TEXT;
ALTER TABLE tools ADD COLUMN review_note TEXT;
UPDATE tools SET enabled=0 WHERE connection_id IN (SELECT id FROM connections WHERE is_demo=0);
UPDATE tools SET review_state='reviewed',classification_status='demo',review_note='Bundled demo fixture' WHERE connection_id IN (SELECT id FROM connections WHERE is_demo=1);
CREATE TABLE tool_reviews(id TEXT PRIMARY KEY, tool_id TEXT NOT NULL, definition_hash TEXT NOT NULL, reviewer_id TEXT NOT NULL, risk_level TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));

UPDATE tools SET risk_floor='admin' WHERE risk_level='admin';
