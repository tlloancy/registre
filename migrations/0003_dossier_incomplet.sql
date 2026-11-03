PRAGMA foreign_keys = OFF;

CREATE TABLE dossiers_nouv (
  id TEXT PRIMARY KEY,
  cree_le TEXT NOT NULL,
  stagiaire_nom TEXT NOT NULL CHECK (length(trim(stagiaire_nom)) > 0),
  stagiaire_email TEXT NOT NULL DEFAULT '',
  stagiaire_tel TEXT NOT NULL DEFAULT '',
  entreprise TEXT NOT NULL DEFAULT '',
  entreprise_siret TEXT NOT NULL DEFAULT '',
  entreprise_adresse TEXT NOT NULL DEFAULT '',
  representant TEXT NOT NULL DEFAULT '',
  financeur TEXT NOT NULL DEFAULT '',
  financeur_dossier TEXT NOT NULL DEFAULT '',
  programme_id TEXT,
  intitule TEXT NOT NULL CHECK (length(trim(intitule)) > 0),
  date_debut TEXT NOT NULL CHECK (date_debut GLOB '????-??-??'),
  date_fin TEXT CHECK (date_fin IS NULL OR date_fin GLOB '????-??-??'),
  heures_total INTEGER NOT NULL CHECK (heures_total >= 0),
  heures_coaching INTEGER NOT NULL CHECK (heures_coaching >= 0),
  heures_elearning INTEGER NOT NULL CHECK (heures_elearning >= 0),
  prix_ht_centimes INTEGER NOT NULL CHECK (prix_ht_centimes >= 0),
  tva_taux_bp INTEGER NOT NULL CHECK (tva_taux_bp >= 0),
  modalite TEXT NOT NULL CHECK (length(trim(modalite)) > 0),
  handicap INTEGER NOT NULL DEFAULT 0 CHECK (handicap IN (0, 1)),
  handicap_precision TEXT NOT NULL DEFAULT '',
  statut TEXT NOT NULL DEFAULT 'ouvert' CHECK (statut IN ('ouvert', 'en_cours', 'clos')),
  CHECK (date_fin IS NULL OR date_fin >= date_debut),
  FOREIGN KEY (programme_id) REFERENCES programmes(id)
);

INSERT INTO dossiers_nouv (
  id, cree_le, stagiaire_nom, stagiaire_email, stagiaire_tel,
  entreprise, entreprise_siret, entreprise_adresse, representant,
  financeur, financeur_dossier, programme_id, intitule,
  date_debut, date_fin, heures_total, heures_coaching, heures_elearning,
  prix_ht_centimes, tva_taux_bp, modalite, handicap, handicap_precision, statut
)
SELECT
  id, cree_le, stagiaire_nom, stagiaire_email, stagiaire_tel,
  entreprise, entreprise_siret, entreprise_adresse, representant,
  financeur, financeur_dossier, programme_id, intitule,
  date_debut, date_fin, heures_total, heures_coaching, heures_elearning,
  prix_ht_centimes, tva_taux_bp, modalite, handicap, handicap_precision, statut
FROM dossiers;

DROP TABLE dossiers;

ALTER TABLE dossiers_nouv RENAME TO dossiers;

PRAGMA foreign_keys = ON;
