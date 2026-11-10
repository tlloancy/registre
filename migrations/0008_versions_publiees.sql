CREATE TABLE versions_publiees (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL CHECK (code IN ('certificat', 'catalogue', 'reglement', 'cgv')),
  version INTEGER NOT NULL CHECK (version >= 1),
  pose_le TEXT NOT NULL CHECK (pose_le GLOB '*Z'),
  sha256 TEXT NOT NULL CHECK (
    length(sha256) = 64
    AND sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  r2_cle TEXT NOT NULL CHECK (r2_cle = 'organisme/' || sha256),
  taille_octets INTEGER NOT NULL CHECK (taille_octets > 0),
  UNIQUE (code, version)
);

CREATE TRIGGER versions_publiees_version
BEFORE INSERT ON versions_publiees
WHEN NEW.version IS NOT (
  SELECT COALESCE(MAX(version), 0) + 1
    FROM versions_publiees
   WHERE code = NEW.code
)
BEGIN
  SELECT RAISE(ABORT, 'version hors sequence');
END;

CREATE TRIGGER versions_publiees_no_update
BEFORE UPDATE ON versions_publiees
BEGIN
  SELECT RAISE(ABORT, 'versions publiees append-only');
END;

CREATE TRIGGER versions_publiees_no_delete
BEFORE DELETE ON versions_publiees
BEGIN
  SELECT RAISE(ABORT, 'versions publiees append-only');
END;

INSERT INTO versions_publiees (id, code, version, pose_le, sha256, r2_cle, taille_octets)
SELECT code || '-1', code, 1, pose_le, sha256, r2_cle, taille_octets
  FROM documents_organisme;
