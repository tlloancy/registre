import type { DossierPret } from "./dossiers.ts";

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
  stagiaire_nom: string;
  intitule: string;
  financeur: string;
  date_debut: string;
  date_fin: string;
  statut: string;
  prix_ht_centimes: number;
  tva_taux_bp: number;
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
    `SELECT stagiaire_nom, intitule, financeur, date_debut, date_fin, statut,
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

async function une<T>(db: Preparer, requete: string, ...valeurs: unknown[]): Promise<T | null> {
  return db.prepare(requete).bind(...valeurs).first<T>();
}

async function plusieurs<T>(db: Preparer, requete: string, ...valeurs: unknown[]): Promise<T[]> {
  const recu = await db.prepare(requete).bind(...valeurs).all<T>();
  return recu.results ?? [];
}
