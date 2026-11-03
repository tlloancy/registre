-- Registre. Migration 0001.
-- BEGIN et END restent en majuscules. Les fins de ligne restent LF.
-- Le separateur distant de D1 exige le mot-cle d'ouverture en majuscules, et du LF.
--
-- Purge, migration dediee, jamais une route :
-- 1. INSERT audit, triggers encore la : action purge_annoncee.
--    Le detail porte l'identifiant du dossier et la demande, pas le nom.
-- 2. DROP TRIGGER retours_no_update, retours_no_delete,
--    derogation_no_update, derogation_no_delete,
--    audit_no_update, audit_no_delete.
-- 3. Anonymiser sur place. Ne pas supprimer le dossier tant qu'une ligne
--    l'encore reference.
-- 4. Supprimer un objet R2 seulement si plus aucune ligne retours ou devis
--    ne porte son sha256.
-- 5. Recreer ces triggers a l'identique.
-- 6. INSERT audit : action purge_faite.
-- devis_no_delete et devis_no_renumber ne sont pas deposes : le numero reste.
--
-- Mot de passe : aucune page. npm run mot-de-passe, plus tard, fait l'UPDATE.
-- PBKDF2-SHA-256, 100000 iterations, sel 16 octets. Le runtime de production
-- refuse au-dessus de 100000 (workerd limit-enforcer.h).

PRAGMA foreign_keys = ON;

CREATE TABLE reglages (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  nom TEXT NOT NULL DEFAULT '',
  siret TEXT NOT NULL DEFAULT '',
  nda TEXT NOT NULL DEFAULT '',
  adresse TEXT NOT NULL DEFAULT '',
  code_postal TEXT NOT NULL DEFAULT '',
  ville TEXT NOT NULL DEFAULT '',
  telephone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  ville_signature TEXT NOT NULL DEFAULT '',
  sous_traitance INTEGER NOT NULL DEFAULT 0 CHECK (sous_traitance IN (0, 1)),
  derogation_autorisee INTEGER NOT NULL DEFAULT 0 CHECK (derogation_autorisee IN (0, 1)),
  session_ttl_secondes INTEGER NOT NULL DEFAULT 28800 CHECK (session_ttl_secondes > 0),
  jeton_ttl_secondes INTEGER NOT NULL DEFAULT 2592000 CHECK (jeton_ttl_secondes > 0),
  connexion_seuil INTEGER NOT NULL DEFAULT 5 CHECK (connexion_seuil > 0),
  connexion_blocage_secondes INTEGER NOT NULL DEFAULT 900 CHECK (connexion_blocage_secondes > 0),
  depot_taille_max_octets INTEGER NOT NULL DEFAULT 10485760 CHECK (depot_taille_max_octets > 0),
  depot_types_autorises TEXT NOT NULL DEFAULT 'application/pdf,image/jpeg,image/png',
  retention_sauvegardes_jours INTEGER NOT NULL DEFAULT 30 CHECK (retention_sauvegardes_jours >= 1),
  fuseau TEXT NOT NULL DEFAULT 'Europe/Paris',
  satisfaction_note_min INTEGER,
  satisfaction_commentaire_ouvre INTEGER NOT NULL DEFAULT 1 CHECK (satisfaction_commentaire_ouvre IN (0, 1)),
  mot_de_passe_algo TEXT,
  mot_de_passe_iterations INTEGER,
  mot_de_passe_sel TEXT,
  mot_de_passe_hash TEXT,
  mot_de_passe_defini_le TEXT,
  CHECK (
    mot_de_passe_hash IS NULL
    OR (
      mot_de_passe_algo = 'PBKDF2-SHA-256'
      AND mot_de_passe_iterations = 100000
      AND mot_de_passe_sel IS NOT NULL
      AND length(trim(mot_de_passe_sel)) > 0
      AND mot_de_passe_defini_le GLOB '*Z'
    )
  )
);

INSERT INTO reglages (id) VALUES (1);

CREATE TABLE tentatives_connexion (
  ip TEXT PRIMARY KEY,
  echecs INTEGER NOT NULL DEFAULT 0 CHECK (echecs >= 0),
  bloque_jusqu_au TEXT,
  modifie_le TEXT NOT NULL
);

CREATE TABLE tentatives_globales (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  echecs INTEGER NOT NULL DEFAULT 0 CHECK (echecs >= 0),
  bloque_jusqu_au TEXT,
  modifie_le TEXT NOT NULL
);

INSERT INTO tentatives_globales (id, echecs, modifie_le)
VALUES (1, 0, '1970-01-01T00:00:00Z');

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  csrf_hash TEXT NOT NULL,
  creee_le TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  CHECK (expires_at > creee_le)
);

CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at_utc TEXT NOT NULL CHECK (at_utc GLOB '*Z'),
  acteur TEXT NOT NULL,
  ip TEXT,
  action TEXT NOT NULL,
  cible_type TEXT,
  cible_id TEXT,
  detail TEXT NOT NULL
);

CREATE TRIGGER audit_no_update
BEFORE UPDATE ON audit
BEGIN
  SELECT RAISE(ABORT, 'audit append-only');
END;

CREATE TRIGGER audit_no_delete
BEFORE DELETE ON audit
BEGIN
  SELECT RAISE(ABORT, 'audit append-only');
END;

CREATE TRIGGER audit_derogation_interrupteur
AFTER UPDATE OF derogation_autorisee ON reglages
WHEN OLD.derogation_autorisee IS NOT NEW.derogation_autorisee
BEGIN
  INSERT INTO audit (at_utc, acteur, ip, action, cible_type, cible_id, detail)
  VALUES (
    strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    'trigger',
    NULL,
    'derogation_interrupteur',
    'reglages',
    '1',
    json_object('avant', OLD.derogation_autorisee, 'apres', NEW.derogation_autorisee)
  );
END;

CREATE TABLE programmes (
  id TEXT PRIMARY KEY,
  intitule TEXT NOT NULL,
  public_vise TEXT NOT NULL DEFAULT '',
  heures_total INTEGER NOT NULL CHECK (heures_total >= 0),
  heures_coaching INTEGER NOT NULL CHECK (heures_coaching >= 0),
  heures_elearning INTEGER NOT NULL CHECK (heures_elearning >= 0),
  contenu TEXT NOT NULL DEFAULT ''
);

CREATE TABLE dossiers (
  id TEXT PRIMARY KEY,
  cree_le TEXT NOT NULL,
  stagiaire_nom TEXT NOT NULL CHECK (length(trim(stagiaire_nom)) > 0),
  stagiaire_email TEXT NOT NULL CHECK (length(trim(stagiaire_email)) > 0),
  stagiaire_tel TEXT NOT NULL DEFAULT '',
  entreprise TEXT NOT NULL DEFAULT '',
  entreprise_siret TEXT NOT NULL DEFAULT '',
  entreprise_adresse TEXT NOT NULL DEFAULT '',
  representant TEXT NOT NULL DEFAULT '',
  financeur TEXT NOT NULL CHECK (length(trim(financeur)) > 0),
  financeur_dossier TEXT NOT NULL DEFAULT '',
  programme_id TEXT,
  intitule TEXT NOT NULL CHECK (length(trim(intitule)) > 0),
  date_debut TEXT NOT NULL CHECK (date_debut GLOB '????-??-??'),
  date_fin TEXT NOT NULL CHECK (date_fin GLOB '????-??-??'),
  heures_total INTEGER NOT NULL CHECK (heures_total >= 0),
  heures_coaching INTEGER NOT NULL CHECK (heures_coaching >= 0),
  heures_elearning INTEGER NOT NULL CHECK (heures_elearning >= 0),
  prix_ht_centimes INTEGER NOT NULL CHECK (prix_ht_centimes >= 0),
  tva_taux_bp INTEGER NOT NULL CHECK (tva_taux_bp >= 0),
  modalite TEXT NOT NULL CHECK (length(trim(modalite)) > 0),
  handicap INTEGER NOT NULL DEFAULT 0 CHECK (handicap IN (0, 1)),
  handicap_precision TEXT NOT NULL DEFAULT '',
  statut TEXT NOT NULL DEFAULT 'ouvert' CHECK (statut IN ('ouvert', 'en_cours', 'clos')),
  CHECK (date_fin >= date_debut),
  FOREIGN KEY (programme_id) REFERENCES programmes(id)
);

CREATE TABLE seances (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL,
  jour TEXT NOT NULL CHECK (jour GLOB '????-??-??'),
  debut TEXT NOT NULL,
  fin TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (length(trim(mode)) > 0),
  lien TEXT NOT NULL DEFAULT '',
  statut TEXT NOT NULL DEFAULT 'prevue' CHECK (statut IN ('prevue', 'tenue', 'reportee')),
  remplacee_par TEXT,
  FOREIGN KEY (dossier_id) REFERENCES dossiers(id),
  FOREIGN KEY (remplacee_par) REFERENCES seances(id)
);

CREATE TABLE pieces (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL,
  code TEXT NOT NULL,
  seance_id TEXT NOT NULL DEFAULT '',
  libelle TEXT NOT NULL,
  indicateur TEXT,
  echeance TEXT CHECK (echeance IS NULL OR echeance GLOB '????-??-??'),
  echeance_verifiee_le TEXT,
  echeance_origine TEXT NOT NULL CHECK (echeance_origine IN ('commune', 'financeur', 'registre')),
  statut TEXT NOT NULL CHECK (statut IN ('attente', 'prete', 'envoyee', 'revenue', 'annulee')),
  derniere_version INTEGER,
  UNIQUE (dossier_id, code, seance_id),
  FOREIGN KEY (dossier_id) REFERENCES dossiers(id)
);

CREATE TABLE regles_financeur (
  id TEXT PRIMARY KEY,
  financeur TEXT NOT NULL,
  code TEXT NOT NULL,
  libelle TEXT NOT NULL,
  ancrage TEXT NOT NULL CHECK (ancrage IN ('creation', 'debut', 'fin')),
  sens TEXT NOT NULL CHECK (sens IN ('avant', 'apres')),
  valeur_jours INTEGER CHECK (valeur_jours IS NULL OR valeur_jours >= 0),
  verifie_le TEXT,
  source_note TEXT NOT NULL DEFAULT '',
  UNIQUE (financeur, code)
);

INSERT INTO regles_financeur (
  id, financeur, code, libelle, ancrage, sens, valeur_jours, verifie_le, source_note
) VALUES
  (
    'fifpl-demande', 'FIFPL', 'demande_prise_en_charge',
    'Demande de prise en charge', 'debut', 'apres', 10, NULL,
    'Cahier des charges relu le 2026-11-03. Date de verification non fournie : echeance non calculee.'
  ),
  (
    'fifpl-remboursement', 'FIFPL', 'dossier_remboursement',
    'Dossier de remboursement', 'fin', 'apres', 30, NULL,
    'Cahier des charges relu le 2026-11-03. Date de verification non fournie : echeance non calculee.'
  ),
  (
    'agefice-cfp', 'AGEFICE', 'rappel_cfp',
    'Rappel attestation CFP', 'fin', 'apres', NULL, NULL,
    'Seulement si debut et fin ne sont pas dans la meme annee civile. Aucun nombre de jours. Ne bloque pas la cloture.'
  );

CREATE TABLE exigences_financeur (
  id TEXT PRIMARY KEY,
  financeur TEXT NOT NULL,
  code_piece TEXT NOT NULL,
  libelle TEXT NOT NULL,
  statut_requis TEXT NOT NULL CHECK (statut_requis IN ('prete', 'revenue')),
  UNIQUE (financeur, code_piece)
);

INSERT INTO exigences_financeur (id, financeur, code_piece, libelle, statut_requis) VALUES
  ('agefice-convention', 'AGEFICE', 'convention', 'Convention signee', 'revenue'),
  ('agefice-programme', 'AGEFICE', 'programme', 'Programme', 'prete'),
  ('agefice-emargement', 'AGEFICE', 'emargement', 'Emargements', 'revenue'),
  ('agefice-attestation', 'AGEFICE', 'attestation', 'Attestation', 'prete'),
  ('agefice-facture', 'AGEFICE', 'facture_acquittee', 'Facture acquittee', 'prete');

CREATE TABLE sequences (
  cle TEXT NOT NULL,
  annee INTEGER NOT NULL,
  prochain INTEGER NOT NULL CHECK (prochain >= 1),
  PRIMARY KEY (cle, annee)
);

CREATE TRIGGER sequence_croissante
BEFORE UPDATE ON sequences
WHEN NEW.prochain <= OLD.prochain
BEGIN
  SELECT RAISE(ABORT, 'sequence en recul');
END;

CREATE TRIGGER sequence_no_delete
BEFORE DELETE ON sequences
BEGIN
  SELECT RAISE(ABORT, 'sequence conservee');
END;

CREATE TABLE devis (
  annee INTEGER NOT NULL,
  numero INTEGER NOT NULL CHECK (numero >= 1),
  dossier_id TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  statut TEXT NOT NULL CHECK (statut IN ('reserve', 'emis', 'annule')),
  montant_ht_centimes INTEGER NOT NULL CHECK (montant_ht_centimes >= 0),
  tva_taux_bp INTEGER NOT NULL CHECK (tva_taux_bp >= 0),
  montant_tva_centimes INTEGER NOT NULL CHECK (montant_tva_centimes >= 0),
  montant_ttc_centimes INTEGER NOT NULL,
  adresse_emise TEXT NOT NULL CHECK (length(trim(adresse_emise)) > 0),
  sha256 TEXT,
  r2_cle TEXT,
  PRIMARY KEY (annee, numero),
  FOREIGN KEY (dossier_id) REFERENCES dossiers(id),
  CHECK (montant_tva_centimes = (montant_ht_centimes * tva_taux_bp + 5000) / 10000),
  CHECK (montant_ttc_centimes = montant_ht_centimes + montant_tva_centimes),
  CHECK (
    (sha256 IS NULL AND r2_cle IS NULL)
    OR (
      sha256 IS NOT NULL
      AND r2_cle IS NOT NULL
      AND length(sha256) = 64
      AND sha256 NOT GLOB '*[^0-9a-f]*'
      AND r2_cle = 'devis/' || sha256
    )
  )
);

CREATE TRIGGER devis_no_delete
BEFORE DELETE ON devis
BEGIN
  SELECT RAISE(ABORT, 'numero conserve');
END;

CREATE TRIGGER devis_no_renumber
BEFORE UPDATE OF annee, numero ON devis
BEGIN
  SELECT RAISE(ABORT, 'numero fige');
END;

CREATE TRIGGER devis_montant_fige
BEFORE UPDATE OF montant_ht_centimes, tva_taux_bp, montant_tva_centimes, montant_ttc_centimes, adresse_emise
ON devis
BEGIN
  SELECT RAISE(ABORT, 'montant fige');
END;

CREATE TRIGGER devis_fichier_une_fois
BEFORE UPDATE OF sha256, r2_cle ON devis
WHEN OLD.sha256 IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'fichier devis deja ecrit');
END;

CREATE TRIGGER devis_statut
BEFORE UPDATE OF statut ON devis
WHEN NOT (
  (OLD.statut = 'reserve' AND NEW.statut IN ('emis', 'annule'))
  OR (OLD.statut = 'emis' AND NEW.statut = 'annule')
)
BEGIN
  SELECT RAISE(ABORT, 'statut devis');
END;

CREATE TABLE verrous (
  code TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  derogable INTEGER NOT NULL CHECK (derogable IN (0, 1)),
  indicateur TEXT
);

INSERT INTO verrous (code, action, derogable, indicateur) VALUES
  ('organisme_incomplet', 'generer_pdf', 0, NULL),
  ('convention_sans_analyse', 'generer_convention', 1, '4'),
  ('convocation_sans_positionnement', 'envoyer_convocation', 1, NULL),
  ('convocation_sans_reglement', 'envoyer_convocation', 1, NULL),
  ('attestation_sans_qcm_sortie', 'generer_attestation', 1, NULL),
  ('attestation_sans_suivi', 'generer_attestation', 1, NULL),
  ('attestation_sans_emargement', 'generer_attestation', 1, NULL),
  ('facture_acquittee_sans_facture', 'generer_facture_acquittee', 1, NULL),
  ('cloture_sans_exigences', 'clore_financeur', 1, NULL);

CREATE TABLE jetons_retour (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL,
  type TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  cree_le TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  actif INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0, 1)),
  revoque_le TEXT,
  CHECK (expires_at > cree_le),
  FOREIGN KEY (dossier_id) REFERENCES dossiers(id)
);

CREATE UNIQUE INDEX jetons_un_actif
ON jetons_retour (dossier_id, type)
WHERE actif = 1;

CREATE TABLE retours (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL,
  type TEXT NOT NULL,
  seance_id TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL CHECK (version >= 1),
  recu_le TEXT NOT NULL CHECK (recu_le GLOB '*Z'),
  ip TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  corps TEXT NOT NULL,
  mime TEXT,
  taille_octets INTEGER CHECK (taille_octets IS NULL OR taille_octets >= 0),
  sha256 TEXT,
  r2_cle TEXT,
  UNIQUE (dossier_id, type, seance_id, version),
  FOREIGN KEY (dossier_id) REFERENCES dossiers(id),
  CHECK (
    (sha256 IS NULL AND r2_cle IS NULL)
    OR (
      sha256 IS NOT NULL
      AND r2_cle IS NOT NULL
      AND length(sha256) = 64
      AND sha256 NOT GLOB '*[^0-9a-f]*'
      AND r2_cle = 'scans/' || sha256
    )
  )
);

CREATE TRIGGER retours_version_imposee
BEFORE INSERT ON retours
WHEN NEW.version IS NOT (
  SELECT COALESCE(MAX(version), 0) + 1
    FROM retours
   WHERE dossier_id = NEW.dossier_id
     AND type = NEW.type
     AND seance_id = NEW.seance_id
)
BEGIN
  SELECT RAISE(ABORT, 'version hors sequence');
END;

CREATE TRIGGER retours_no_update
BEFORE UPDATE ON retours
BEGIN
  SELECT RAISE(ABORT, 'retours append-only');
END;

CREATE TRIGGER retours_no_delete
BEFORE DELETE ON retours
BEGIN
  SELECT RAISE(ABORT, 'retours append-only');
END;

CREATE TABLE derogations (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL,
  verrou_code TEXT NOT NULL,
  effet TEXT NOT NULL CHECK (effet IN ('levee', 'retablie')),
  justification TEXT NOT NULL CHECK (length(trim(justification)) > 0),
  creee_le TEXT NOT NULL CHECK (creee_le GLOB '*Z'),
  acteur TEXT NOT NULL,
  ip TEXT NOT NULL,
  FOREIGN KEY (dossier_id) REFERENCES dossiers(id),
  FOREIGN KEY (verrou_code) REFERENCES verrous(code)
);

CREATE TRIGGER derogation_interdite
BEFORE INSERT ON derogations
WHEN (SELECT derogation_autorisee FROM reglages WHERE id = 1) IS NOT 1
BEGIN
  SELECT RAISE(ABORT, 'derogation desactivee');
END;

CREATE TRIGGER derogation_non_derogeable
BEFORE INSERT ON derogations
WHEN (SELECT derogable FROM verrous WHERE code = NEW.verrou_code) IS NOT 1
BEGIN
  SELECT RAISE(ABORT, 'verrou non derogable');
END;

CREATE TRIGGER derogation_no_update
BEFORE UPDATE ON derogations
BEGIN
  SELECT RAISE(ABORT, 'derogations append-only');
END;

CREATE TRIGGER derogation_no_delete
BEFORE DELETE ON derogations
BEGIN
  SELECT RAISE(ABORT, 'derogations append-only');
END;

CREATE TRIGGER audit_derogation
AFTER INSERT ON derogations
BEGIN
  INSERT INTO audit (at_utc, acteur, ip, action, cible_type, cible_id, detail)
  VALUES (
    NEW.creee_le,
    NEW.acteur,
    NEW.ip,
    'derogation',
    'dossier',
    NEW.dossier_id,
    json_object(
      'verrou', NEW.verrou_code,
      'effet', NEW.effet,
      'justification', NEW.justification
    )
  );
END;

CREATE TABLE normes_sources (
  id TEXT PRIMARY KEY,
  libelle TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  etat TEXT NOT NULL CHECK (etat IN ('inchange', 'change', 'echec')),
  hash TEXT,
  verifie_le TEXT,
  erreur TEXT NOT NULL DEFAULT '',
  hash_lu TEXT,
  lu_le TEXT,
  lu_note TEXT NOT NULL DEFAULT '',
  CHECK (etat != 'change' OR hash IS NOT NULL),
  CHECK (lu_le IS NULL OR length(trim(lu_note)) > 0)
);

CREATE TABLE mesures (
  id TEXT PRIMARY KEY,
  creee_le TEXT NOT NULL,
  origine TEXT NOT NULL CHECK (origine IN ('appreciation', 'reclamation', 'risque', 'autre')),
  dossier_id TEXT,
  retour_id TEXT,
  constat TEXT NOT NULL,
  mesure TEXT NOT NULL DEFAULT '',
  echeance TEXT,
  fait_le TEXT,
  effet TEXT NOT NULL DEFAULT '',
  effet_le TEXT,
  FOREIGN KEY (dossier_id) REFERENCES dossiers(id)
);

CREATE TABLE risques (
  id TEXT PRIMARY KEY,
  creee_le TEXT NOT NULL,
  risque TEXT NOT NULL CHECK (length(trim(risque)) > 0),
  parade TEXT NOT NULL DEFAULT '',
  revue_le TEXT
);

CREATE TABLE reclamations (
  id TEXT PRIMARY KEY,
  creee_le TEXT NOT NULL,
  dossier_id TEXT,
  auteur TEXT NOT NULL,
  objet TEXT NOT NULL,
  suite TEXT NOT NULL DEFAULT '',
  clos_le TEXT,
  FOREIGN KEY (dossier_id) REFERENCES dossiers(id)
);

CREATE TABLE traces (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  indicateur TEXT,
  creee_le TEXT NOT NULL,
  texte TEXT NOT NULL CHECK (length(trim(texte)) > 0)
);

CREATE TABLE obligations_organisme (
  code TEXT PRIMARY KEY,
  libelle TEXT NOT NULL,
  periode_jours INTEGER NOT NULL CHECK (periode_jours > 0),
  origine TEXT NOT NULL CHECK (origine = 'registre'),
  indicateur TEXT
);

INSERT INTO obligations_organisme (code, libelle, periode_jours, origine) VALUES
  ('veille_legale', 'Veille legale', 90, 'registre'),
  ('veille_metiers', 'Veille metiers', 90, 'registre'),
  ('veille_pedagogique', 'Veille pedagogique', 90, 'registre'),
  ('reclamations', 'Revue du registre des reclamations', 365, 'registre'),
  ('risques', 'Revue des risques', 365, 'registre');

CREATE TABLE sauvegardes (
  id TEXT PRIMARY KEY,
  cree_le TEXT NOT NULL,
  r2_cle TEXT NOT NULL UNIQUE,
  taille_octets INTEGER NOT NULL CHECK (taille_octets >= 0),
  sha256 TEXT NOT NULL
);

CREATE INDEX pieces_dossier ON pieces (dossier_id, code);
CREATE INDEX retours_lookup ON retours (dossier_id, type, seance_id, version);
CREATE INDEX audit_date ON audit (at_utc);
CREATE INDEX seances_dossier ON seances (dossier_id, jour);
