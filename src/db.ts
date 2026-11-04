import type { DossierPret } from "./dossiers.ts";
import type { Preuves } from "./guide.ts";

export type RequeteLiee = {
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
};

export type Preparer = {
  prepare(requete: string): {
    bind(...valeurs: unknown[]): RequeteLiee;
  };
  batch(requetes: RequeteLiee[]): Promise<unknown>;
};

export type Secret = {
  mot_de_passe_sel: string;
  mot_de_passe_hash: string;
  session_ttl_secondes: number;
  connexion_seuil: number;
  connexion_blocage_secondes: number;
};

export type Organisme = {
  nom: string;
  siret: string;
  nda: string;
  adresse: string;
  code_postal: string;
  ville: string;
  telephone: string;
  email: string;
  numero_tva: string;
};

export type Compteur = {
  echecs: number;
  bloque_jusqu_au: string | null;
};

export type SessionLigne = {
  csrf_hash: string;
  expires_at: string;
};

export type DossierLigne = {
  id: string;
  stagiaire_nom: string;
  intitule: string;
  financeur: string;
  date_debut: string;
  date_fin: string | null;
  statut: string;
  prix_ht_centimes: number;
  tva_taux_bp: number;
};

export type DossierComplet = DossierLigne & {
  stagiaire_email: string;
  entreprise: string;
  entreprise_siret: string;
  entreprise_adresse: string;
  representant: string;
  heures_total: number;
  heures_coaching: number;
  heures_elearning: number;
  modalite: string;
};

export type EtatPieces = {
  convention: { r2_cle: string; corps: string } | null;
  programme: boolean;
  devis: { annee: number; numero: number; r2_cle: string } | null;
  modeles: string[];
};

export async function lireHashMotDePasse(db: Preparer): Promise<string | null> {
  const ligne = await une<{ mot_de_passe_hash: string | null }>(
    db,
    "SELECT mot_de_passe_hash FROM reglages WHERE id = ?",
    1,
  );
  if (!ligne) return null;
  if (ligne.mot_de_passe_hash === null || ligne.mot_de_passe_hash === "") return null;
  return ligne.mot_de_passe_hash;
}

export async function lireSecret(db: Preparer): Promise<Secret | null> {
  const ligne = await une<Secret & { mot_de_passe_sel: string | null; mot_de_passe_hash: string | null }>(
    db,
    `SELECT mot_de_passe_sel, mot_de_passe_hash, session_ttl_secondes,
            connexion_seuil, connexion_blocage_secondes
       FROM reglages WHERE id = ?`,
    1,
  );
  if (!ligne?.mot_de_passe_hash || !ligne.mot_de_passe_sel) return null;
  return {
    mot_de_passe_sel: ligne.mot_de_passe_sel,
    mot_de_passe_hash: ligne.mot_de_passe_hash,
    session_ttl_secondes: ligne.session_ttl_secondes,
    connexion_seuil: ligne.connexion_seuil,
    connexion_blocage_secondes: ligne.connexion_blocage_secondes,
  };
}

export async function lireOrganisme(db: Preparer): Promise<Organisme> {
  const ligne = await une<Organisme>(
    db,
    `SELECT nom, siret, nda, adresse, code_postal, ville, telephone, email, numero_tva
       FROM reglages WHERE id = ?`,
    1,
  );
  if (!ligne) throw new Error("reglages absents");
  return ligne;
}

export async function lireCompteurIp(db: Preparer, ip: string): Promise<Compteur | null> {
  return une<Compteur>(
    db,
    "SELECT echecs, bloque_jusqu_au FROM tentatives_connexion WHERE ip = ?",
    ip,
  );
}

export async function lireCompteurGlobal(db: Preparer): Promise<Compteur> {
  const ligne = await une<Compteur>(
    db,
    "SELECT echecs, bloque_jusqu_au FROM tentatives_globales WHERE id = ?",
    1,
  );
  if (!ligne) throw new Error("tentatives absentes");
  return ligne;
}

export async function ecrireEchec(
  db: Preparer,
  ip: string,
  echecsIp: number,
  bloqueIp: string | null,
  echecsGlobal: number,
  bloqueGlobal: string | null,
  maintenant: string,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO tentatives_connexion (ip, echecs, bloque_jusqu_au, modifie_le)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(ip) DO UPDATE SET
           echecs = excluded.echecs,
           bloque_jusqu_au = excluded.bloque_jusqu_au,
           modifie_le = excluded.modifie_le`,
      )
      .bind(ip, echecsIp, bloqueIp, maintenant),
    db
      .prepare(
        `UPDATE tentatives_globales
            SET echecs = ?, bloque_jusqu_au = ?, modifie_le = ?
          WHERE id = 1`,
      )
      .bind(echecsGlobal, bloqueGlobal, maintenant),
    db
      .prepare(
        `INSERT INTO audit (at_utc, acteur, ip, action, cible_type, cible_id, detail)
         VALUES (?, 'admin', ?, 'connexion_refus', 'reglages', '1', ?)`,
      )
      .bind(maintenant, ip, JSON.stringify({ echecs_ip: echecsIp, echecs_global: echecsGlobal })),
  ]);
}

export async function ouvrirSession(
  db: Preparer,
  session: {
    tokenHash: string;
    csrfHash: string;
    creeeLe: string;
    expiresAt: string;
    ip: string;
    userAgent: string;
  },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO sessions (token_hash, csrf_hash, creee_le, expires_at, ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        session.tokenHash,
        session.csrfHash,
        session.creeeLe,
        session.expiresAt,
        session.ip,
        session.userAgent,
      ),
    db
      .prepare(
        `INSERT INTO tentatives_connexion (ip, echecs, bloque_jusqu_au, modifie_le)
         VALUES (?, 0, NULL, ?)
         ON CONFLICT(ip) DO UPDATE SET
           echecs = 0,
           bloque_jusqu_au = NULL,
           modifie_le = excluded.modifie_le`,
      )
      .bind(session.ip, session.creeeLe),
    db
      .prepare(
        `UPDATE tentatives_globales
            SET echecs = 0, bloque_jusqu_au = NULL, modifie_le = ?
          WHERE id = 1`,
      )
      .bind(session.creeeLe),
    db
      .prepare(
        `INSERT INTO audit (at_utc, acteur, ip, action, cible_type, cible_id, detail)
         VALUES (?, 'admin', ?, 'connexion', 'sessions', ?, '{}')`,
      )
      .bind(session.creeeLe, session.ip, session.tokenHash),
  ]);
}

export async function lireSession(db: Preparer, tokenHash: string): Promise<SessionLigne | null> {
  return une<SessionLigne>(
    db,
    "SELECT csrf_hash, expires_at FROM sessions WHERE token_hash = ?",
    tokenHash,
  );
}

export async function supprimerSession(db: Preparer, tokenHash: string, ip: string, maintenant: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash),
    db
      .prepare(
        `INSERT INTO audit (at_utc, acteur, ip, action, cible_type, cible_id, detail)
         VALUES (?, 'admin', ?, 'deconnexion', 'sessions', ?, '{}')`,
      )
      .bind(maintenant, ip, tokenHash),
  ]);
}

export async function listerDossiers(db: Preparer): Promise<DossierLigne[]> {
  return plusieurs<DossierLigne>(
    db,
    `SELECT id, stagiaire_nom, intitule, financeur, date_debut, date_fin, statut,
            prix_ht_centimes, tva_taux_bp
       FROM dossiers
      ORDER BY cree_le DESC`,
  );
}

export type FichierConvention = {
  sha256: string;
  taille: number;
  numero: string;
  devis: string;
  recuLe: string;
  userAgent: string;
};

export async function lireTailleDepot(db: Preparer): Promise<number> {
  const ligne = await une<{ depot_taille_max_octets: number }>(
    db,
    "SELECT depot_taille_max_octets FROM reglages WHERE id = ?",
    1,
  );
  if (!ligne || ligne.depot_taille_max_octets <= 0) throw new Error("dépôt absent");
  return ligne.depot_taille_max_octets;
}

export async function insererDossier(
  db: Preparer,
  dossier: DossierPret,
  ip: string,
  fichier: FichierConvention,
): Promise<void> {
  const detail: Record<string, string> = {};
  if (fichier.numero) detail.numero = fichier.numero;
  if (fichier.devis) detail.devis = fichier.devis;
  await db.batch([
    db
      .prepare(
        `INSERT INTO dossiers (
           id, cree_le, stagiaire_nom, stagiaire_email, stagiaire_tel,
           entreprise, entreprise_siret, entreprise_adresse, representant,
           financeur, financeur_dossier, programme_id, intitule,
           date_debut, date_fin, heures_total, heures_coaching, heures_elearning,
           prix_ht_centimes, tva_taux_bp, modalite, handicap, handicap_precision, statut
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', 'ouvert')`,
      )
      .bind(
        dossier.id,
        dossier.cree_le,
        dossier.stagiaire_nom,
        dossier.stagiaire_email,
        dossier.stagiaire_tel,
        dossier.entreprise,
        dossier.entreprise_siret,
        dossier.entreprise_adresse,
        dossier.representant,
        dossier.financeur,
        dossier.financeur_dossier,
        dossier.intitule,
        dossier.date_debut,
        dossier.date_fin,
        dossier.heures_total,
        dossier.heures_coaching,
        dossier.heures_elearning,
        dossier.prix_ht_centimes,
        dossier.tva_taux_bp,
        dossier.modalite,
      ),
    db
      .prepare(
        `INSERT INTO pieces (
           id, dossier_id, code, seance_id, libelle, indicateur, echeance,
           echeance_verifiee_le, echeance_origine, statut, derniere_version
         ) VALUES (?, ?, 'convention', '', 'Convention', NULL, NULL, NULL, 'registre', 'prete', 1)`,
      )
      .bind(crypto.randomUUID(), dossier.id),
    db
      .prepare(
        `INSERT INTO retours (
           id, dossier_id, type, seance_id, version, recu_le, ip, user_agent,
           corps, mime, taille_octets, sha256, r2_cle
         ) VALUES (?, ?, 'convention', '', 1, ?, ?, ?, ?, 'application/pdf', ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        dossier.id,
        fichier.recuLe,
        ip,
        fichier.userAgent,
        JSON.stringify(detail),
        fichier.taille,
        fichier.sha256,
        `scans/${fichier.sha256}`,
      ),
    db
      .prepare(
        `INSERT INTO audit (at_utc, acteur, ip, action, cible_type, cible_id, detail)
         VALUES (?, 'admin', ?, 'dossier_ouvert', 'dossiers', ?, '{}')`,
      )
      .bind(dossier.cree_le, ip, dossier.id),
  ]);
}

export async function lireDocumentOrganisme(db: Preparer, code: string): Promise<string | null> {
  const ligne = await une<{ r2_cle: string }>(
    db,
    "SELECT r2_cle FROM documents_organisme WHERE code = ?",
    code,
  );
  return ligne?.r2_cle ?? null;
}

export async function enregistrerDocumentOrganisme(
  db: Preparer,
  entree: { code: string; libelle: string; sha256: string; taille: number; poseLe: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO documents_organisme (code, libelle, sha256, r2_cle, taille_octets, pose_le)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(entree.code, entree.libelle, entree.sha256, `organisme/${entree.sha256}`, entree.taille, entree.poseLe)
    .run();
}

export async function lireDossier(db: Preparer, id: string): Promise<DossierComplet | null> {
  return une<DossierComplet>(
    db,
    `SELECT id, stagiaire_nom, stagiaire_email, entreprise, entreprise_siret, entreprise_adresse,
            representant, financeur, intitule, date_debut, date_fin, statut,
            heures_total, heures_coaching, heures_elearning, prix_ht_centimes, tva_taux_bp, modalite
       FROM dossiers WHERE id = ?`,
    id,
  );
}

export async function lireEtatPieces(db: Preparer, dossierId: string): Promise<EtatPieces> {
  const convention = await une<{ r2_cle: string; corps: string }>(
    db,
    `SELECT r2_cle, corps FROM retours
      WHERE dossier_id = ? AND type = 'convention' AND r2_cle IS NOT NULL
      ORDER BY version DESC LIMIT 1`,
    dossierId,
  );
  const programme = await une<{ n: number }>(
    db,
    "SELECT count(*) AS n FROM pieces WHERE dossier_id = ? AND code = 'programme' AND seance_id = ''",
    dossierId,
  );
  const devis = await une<{ annee: number; numero: number; r2_cle: string }>(
    db,
    `SELECT annee, numero, r2_cle FROM devis
      WHERE dossier_id = ? AND statut != 'annule' AND r2_cle IS NOT NULL
      ORDER BY annee, numero LIMIT 1`,
    dossierId,
  );
  const modeles = await plusieurs<{ seance_id: string }>(
    db,
    "SELECT seance_id FROM retours WHERE dossier_id = ? AND type = 'modele' AND r2_cle IS NOT NULL",
    dossierId,
  );
  return { convention, programme: (programme?.n ?? 0) > 0, devis, modeles: modeles.map((ligne) => ligne.seance_id) };
}

export async function lireContenuProgramme(db: Preparer, dossierId: string): Promise<string> {
  const ligne = await une<{ contenu: string }>(
    db,
    `SELECT programmes.contenu AS contenu
       FROM dossiers
       JOIN programmes ON programmes.id = dossiers.programme_id
      WHERE dossiers.id = ?`,
    dossierId,
  );
  return ligne?.contenu ?? "";
}

export async function cleRetour(
  db: Preparer,
  dossierId: string,
  type: string,
  seanceId = "",
): Promise<string | null> {
  const ligne = await une<{ r2_cle: string }>(
    db,
    `SELECT r2_cle FROM retours
      WHERE dossier_id = ? AND type = ? AND seance_id = ? AND r2_cle IS NOT NULL
      ORDER BY version DESC LIMIT 1`,
    dossierId,
    type,
    seanceId,
  );
  return ligne?.r2_cle ?? null;
}

export async function enregistrerModele(
  db: Preparer,
  entree: {
    dossierId: string;
    code: string;
    recuLe: string;
    ip: string;
    userAgent: string;
    sha256: string;
    taille: number;
  },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO retours (
           id, dossier_id, type, seance_id, version, recu_le, ip, user_agent,
           corps, mime, taille_octets, sha256, r2_cle
         ) VALUES (?, ?, 'modele', ?, 1, ?, ?, ?, '{}', 'application/pdf', ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        entree.dossierId,
        entree.code,
        entree.recuLe,
        entree.ip,
        entree.userAgent,
        entree.taille,
        entree.sha256,
        `scans/${entree.sha256}`,
      ),
    db
      .prepare(
        `INSERT INTO audit (at_utc, acteur, ip, action, cible_type, cible_id, detail)
         VALUES (?, 'admin', ?, 'modele_produit', 'dossiers', ?, ?)`,
      )
      .bind(entree.recuLe, entree.ip, entree.dossierId, JSON.stringify({ code: entree.code })),
  ]);
}

export async function enregistrerProgramme(
  db: Preparer,
  entree: {
    dossierId: string;
    intitule: string;
    heuresTotal: number;
    heuresCoaching: number;
    heuresElearning: number;
    contenu: string;
    recuLe: string;
    ip: string;
    userAgent: string;
    sha256: string;
    taille: number;
  },
): Promise<void> {
  const programmeId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO programmes (id, intitule, heures_total, heures_coaching, heures_elearning, contenu)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        programmeId,
        entree.intitule,
        entree.heuresTotal,
        entree.heuresCoaching,
        entree.heuresElearning,
        entree.contenu,
      ),
    db.prepare("UPDATE dossiers SET programme_id = ? WHERE id = ? AND programme_id IS NULL").bind(programmeId, entree.dossierId),
    db
      .prepare(
        `INSERT INTO pieces (
           id, dossier_id, code, seance_id, libelle, indicateur, echeance,
           echeance_verifiee_le, echeance_origine, statut, derniere_version
         ) VALUES (?, ?, 'programme', '', 'Programme', NULL, NULL, NULL, 'registre', 'prete', 1)`,
      )
      .bind(crypto.randomUUID(), entree.dossierId),
    db
      .prepare(
        `INSERT INTO retours (
           id, dossier_id, type, seance_id, version, recu_le, ip, user_agent,
           corps, mime, taille_octets, sha256, r2_cle
         ) VALUES (?, ?, 'programme', '', 1, ?, ?, ?, '{}', 'application/pdf', ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        entree.dossierId,
        entree.recuLe,
        entree.ip,
        entree.userAgent,
        entree.taille,
        entree.sha256,
        `scans/${entree.sha256}`,
      ),
    db
      .prepare(
        `INSERT INTO audit (at_utc, acteur, ip, action, cible_type, cible_id, detail)
         VALUES (?, 'admin', ?, 'programme_extrait', 'dossiers', ?, '{}')`,
      )
      .bind(entree.recuLe, entree.ip, entree.dossierId),
  ]);
}

export async function enregistrerDevis(
  db: Preparer,
  entree: {
    dossierId: string;
    annee: number;
    numero: number;
    creeLe: string;
    ht: number;
    tauxBp: number;
    tva: number;
    ttc: number;
    adresse: string;
    sha256: string;
    ip: string;
    maintenant: string;
  },
): Promise<void> {
  const suivant = entree.numero + 1;
  await db.batch([
    db
      .prepare(
        `INSERT INTO sequences (cle, annee, prochain)
         SELECT 'devis', ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM sequences WHERE cle = 'devis' AND annee = ?)`,
      )
      .bind(entree.annee, suivant, entree.annee),
    db
      .prepare("UPDATE sequences SET prochain = ? WHERE cle = 'devis' AND annee = ? AND prochain < ?")
      .bind(suivant, entree.annee, suivant),
    db
      .prepare(
        `INSERT INTO devis (
           annee, numero, dossier_id, cree_le, statut,
           montant_ht_centimes, tva_taux_bp, montant_tva_centimes, montant_ttc_centimes,
           adresse_emise, sha256, r2_cle
         ) VALUES (?, ?, ?, ?, 'emis', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        entree.annee,
        entree.numero,
        entree.dossierId,
        entree.creeLe,
        entree.ht,
        entree.tauxBp,
        entree.tva,
        entree.ttc,
        entree.adresse,
        entree.sha256,
        `devis/${entree.sha256}`,
      ),
    db
      .prepare(
        `INSERT INTO audit (at_utc, acteur, ip, action, cible_type, cible_id, detail)
         VALUES (?, 'admin', ?, 'devis_emis', 'devis', ?, ?)`,
      )
      .bind(entree.maintenant, entree.ip, `${entree.annee}-${entree.numero}`, JSON.stringify({ annee: entree.annee, numero: entree.numero })),
  ]);
}

export type NormeLigne = {
  etat: "inchange" | "change" | "echec";
  hash: string | null;
  verifie_le: string | null;
  erreur: string;
  hash_lu: string | null;
  lu_le: string | null;
  releve: string;
  url: string;
};

export async function lireNorme(db: Preparer): Promise<NormeLigne | null> {
  return une<NormeLigne>(
    db,
    `SELECT etat, hash, verifie_le, erreur, hash_lu, lu_le, releve, url
       FROM normes_sources WHERE id = 'guide'`,
  );
}

export async function ecrireNorme(
  db: Preparer,
  entree: { url: string; etat: string; hash: string | null; verifieLe: string; erreur: string; releve: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO normes_sources (id, libelle, url, etat, hash, verifie_le, erreur, releve)
       VALUES ('guide', 'Guide de lecture Qualiopi', ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         url = excluded.url,
         etat = excluded.etat,
         hash = excluded.hash,
         verifie_le = excluded.verifie_le,
         erreur = excluded.erreur,
         releve = CASE WHEN excluded.releve = '' THEN normes_sources.releve ELSE excluded.releve END`,
    )
    .bind(entree.url, entree.etat, entree.hash, entree.verifieLe, entree.erreur, entree.releve)
    .run();
}

export async function marquerGuideLu(
  db: Preparer,
  entree: { note: string; quand: string; ip: string },
): Promise<boolean> {
  const norme = await lireNorme(db);
  if (!norme?.hash) return false;
  await db.batch([
    db
      .prepare(
        `UPDATE normes_sources
            SET lu_le = ?, lu_note = ?, hash_lu = hash, etat = 'inchange'
          WHERE id = 'guide' AND hash IS NOT NULL`,
      )
      .bind(entree.quand, entree.note),
    db
      .prepare(
        `INSERT INTO audit (at_utc, acteur, ip, action, cible_type, cible_id, detail)
         VALUES (?, 'admin', ?, 'guide_lu', 'normes_sources', 'guide', ?)`,
      )
      .bind(entree.quand, entree.ip, JSON.stringify({ hash: norme.hash })),
  ]);
  return true;
}

export type TraceLigne = { code: string; creee_le: string; texte: string };

export async function lireTraces(db: Preparer): Promise<TraceLigne[]> {
  return plusieurs<TraceLigne>(db, "SELECT code, creee_le, texte FROM traces ORDER BY creee_le");
}

export async function ajouterTrace(
  db: Preparer,
  entree: { id: string; code: string; texte: string; creeeLe: string; ip: string },
): Promise<void> {
  await db.batch([
    db
      .prepare("INSERT INTO traces (id, code, creee_le, texte) VALUES (?, ?, ?, ?)")
      .bind(entree.id, entree.code, entree.creeeLe, entree.texte),
    db
      .prepare(
        `INSERT INTO audit (at_utc, acteur, ip, action, cible_type, cible_id, detail)
         VALUES (?, 'admin', ?, 'note_organisme', 'traces', ?, ?)`,
      )
      .bind(entree.creeeLe, entree.ip, entree.id, JSON.stringify({ code: entree.code })),
  ]);
}

export async function lirePreuves(db: Preparer): Promise<Preuves> {
  const compte = await une<{
    ouverts: number;
    sans_programme: number;
    sans_analyse: number;
    sans_positionnement: number;
    sans_convocation: number;
    sans_mise_en_oeuvre: number;
    sans_evaluation: number;
    sans_suivi: number;
  }>(
    db,
    `SELECT
       COUNT(*) AS ouverts,
       COALESCE(SUM(CASE WHEN NOT EXISTS (
         SELECT 1 FROM pieces p
          WHERE p.dossier_id = d.id AND p.code = 'programme' AND p.statut != 'annulee'
       ) THEN 1 ELSE 0 END), 0) AS sans_programme,
       COALESCE(SUM(CASE WHEN NOT EXISTS (
         SELECT 1 FROM retours r WHERE r.dossier_id = d.id AND r.type = 'analyse'
       ) THEN 1 ELSE 0 END), 0) AS sans_analyse,
       COALESCE(SUM(CASE WHEN NOT EXISTS (
         SELECT 1 FROM retours r WHERE r.dossier_id = d.id AND r.type = 'positionnement'
       ) THEN 1 ELSE 0 END), 0) AS sans_positionnement,
       COALESCE(SUM(CASE WHEN NOT EXISTS (
         SELECT 1 FROM pieces p
          WHERE p.dossier_id = d.id AND p.code = 'convocation' AND p.statut IN ('envoyee', 'revenue')
       ) THEN 1 ELSE 0 END), 0) AS sans_convocation,
       COALESCE(SUM(CASE WHEN NOT EXISTS (
         SELECT 1 FROM pieces p
          WHERE p.dossier_id = d.id AND p.code = 'emargement' AND p.statut = 'revenue'
       ) AND NOT EXISTS (
         SELECT 1 FROM seances s WHERE s.dossier_id = d.id AND s.statut = 'tenue'
       ) THEN 1 ELSE 0 END), 0) AS sans_mise_en_oeuvre,
       COALESCE(SUM(CASE WHEN NOT EXISTS (
         SELECT 1 FROM retours r WHERE r.dossier_id = d.id AND r.type = 'qcm_sortie'
       ) THEN 1 ELSE 0 END), 0) AS sans_evaluation,
       COALESCE(SUM(CASE WHEN d.heures_elearning > 0 AND NOT EXISTS (
         SELECT 1 FROM retours r WHERE r.dossier_id = d.id AND r.type = 'suivi_elearning'
       ) THEN 1 ELSE 0 END), 0) AS sans_suivi
     FROM dossiers d
     WHERE d.statut != 'clos'`,
  );
  const dates = new Map<string, string>();
  for (const ligne of await plusieurs<{ code: string; pose_le: string }>(
    db,
    "SELECT code, MAX(pose_le) AS pose_le FROM versions_organisme GROUP BY code",
  )) {
    dates.set(ligne.code, ligne.pose_le);
  }
  return {
    ouverts: Number(compte?.ouverts ?? 0),
    sansProgramme: Number(compte?.sans_programme ?? 0),
    sansAnalyse: Number(compte?.sans_analyse ?? 0),
    sansPositionnement: Number(compte?.sans_positionnement ?? 0),
    sansConvocation: Number(compte?.sans_convocation ?? 0),
    sansMiseEnOeuvre: Number(compte?.sans_mise_en_oeuvre ?? 0),
    sansEvaluation: Number(compte?.sans_evaluation ?? 0),
    sansSuivi: Number(compte?.sans_suivi ?? 0),
    dates,
  };
}

export type VersionOrganisme = {
  code: string;
  version: number;
  pose_le: string;
  sha256: string;
  r2_cle: string;
};

export async function lireVersionsOrganisme(db: Preparer): Promise<VersionOrganisme[]> {
  return plusieurs<VersionOrganisme>(
    db,
    "SELECT code, version, pose_le, sha256, r2_cle FROM versions_organisme ORDER BY code, version",
  );
}

export async function ajouterVersionOrganisme(
  db: Preparer,
  entree: { id: string; code: string; poseLe: string; origine: "depot" | "produit"; sha256: string; taille: number; ip: string },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO versions_organisme (id, code, version, pose_le, origine, sha256, r2_cle, taille_octets)
         VALUES (
           ?, ?,
           (SELECT COALESCE(MAX(version), 0) + 1 FROM versions_organisme WHERE code = ?),
           ?, ?, ?, ?, ?
         )`,
      )
      .bind(entree.id, entree.code, entree.code, entree.poseLe, entree.origine, entree.sha256, `audit/${entree.sha256}`, entree.taille),
    db
      .prepare(
        `INSERT INTO audit (at_utc, acteur, ip, action, cible_type, cible_id, detail)
         VALUES (?, 'admin', ?, 'version_organisme', 'versions_organisme', ?, ?)`,
      )
      .bind(entree.poseLe, entree.ip, entree.id, JSON.stringify({ code: entree.code, origine: entree.origine })),
  ]);
}

async function une<T>(db: Preparer, requete: string, ...valeurs: unknown[]): Promise<T | null> {
  return db.prepare(requete).bind(...valeurs).first<T>();
}

async function plusieurs<T>(db: Preparer, requete: string, ...valeurs: unknown[]): Promise<T[]> {
  const recu = await db.prepare(requete).bind(...valeurs).all<T>();
  return recu.results ?? [];
}
