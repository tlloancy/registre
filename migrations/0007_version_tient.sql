ALTER TABLE versions_organisme ADD COLUMN tient INTEGER NOT NULL DEFAULT 1 CHECK (tient IN (0, 1));
