ALTER TABLE connections ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'read' CHECK(access_mode IN ('read','write','read_write'));
