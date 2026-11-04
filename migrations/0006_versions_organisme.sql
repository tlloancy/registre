CREATE TABLE versions_organisme (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL CHECK (length(code) > 0 AND code NOT GLOB '*[^a-z_]*'),
  version INTEGER NOT NULL CHECK (version >= 1),
  pose_le TEXT NOT NULL CHECK (pose_le GLOB '*Z'),
  origine TEXT NOT NULL CHECK (origine IN ('depot', 'produit')),
  sha256 TEXT NOT NULL CHECK (
    length(sha256) = 64
    AND sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  r2_cle TEXT NOT NULL CHECK (r2_cle = 'audit/' || sha256),
  taille_octets INTEGER NOT NULL CHECK (taille_octets > 0),
  UNIQUE (code, version)
);

CREATE TRIGGER versions_organisme_version
BEFORE INSERT ON versions_organisme
WHEN NEW.version IS NOT (
  SELECT COALESCE(MAX(version), 0) + 1
    FROM versions_organisme
   WHERE code = NEW.code
)
BEGIN
  SELECT RAISE(ABORT, 'version hors sequence');
END;

CREATE TRIGGER versions_organisme_no_update
BEFORE UPDATE ON versions_organisme
BEGIN
  SELECT RAISE(ABORT, 'versions organisme append-only');
END;

CREATE TRIGGER versions_organisme_no_delete
BEFORE DELETE ON versions_organisme
BEGIN
  SELECT RAISE(ABORT, 'versions organisme append-only');
END;
