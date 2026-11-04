ALTER TABLE normes_sources ADD COLUMN releve TEXT NOT NULL DEFAULT '';

CREATE TRIGGER traces_no_update
BEFORE UPDATE ON traces
BEGIN
  SELECT RAISE(ABORT, 'traces append-only');
END;

CREATE TRIGGER traces_no_delete
BEFORE DELETE ON traces
BEGIN
  SELECT RAISE(ABORT, 'traces append-only');
END;
