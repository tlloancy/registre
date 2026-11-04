CREATE TABLE documents_organisme (
  code TEXT PRIMARY KEY,
  libelle TEXT NOT NULL CHECK (length(trim(libelle)) > 0),
  sha256 TEXT NOT NULL CHECK (
    length(sha256) = 64
    AND sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  r2_cle TEXT NOT NULL CHECK (r2_cle = 'organisme/' || sha256),
  taille_octets INTEGER NOT NULL CHECK (taille_octets > 0),
  pose_le TEXT NOT NULL CHECK (pose_le GLOB '*Z')
);

CREATE TRIGGER documents_organisme_no_update
BEFORE UPDATE ON documents_organisme
BEGIN
  SELECT RAISE(ABORT, 'document organisme fige');
END;

CREATE TRIGGER documents_organisme_no_delete
BEFORE DELETE ON documents_organisme
BEGIN
  SELECT RAISE(ABORT, 'document organisme conserve');
END;
