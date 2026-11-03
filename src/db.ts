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
  return { convention, programme: (programme?.n ?? 0) > 0, devis };
}

export async function clePiece(
  db: Preparer,
  dossierId: string,
  code: "convention" | "programme",
): Promise<string | null> {
  const ligne = await une<{ r2_cle: string }>(
    db,
    `SELECT r2_cle FROM retours
      WHERE dossier_id = ? AND type = ? AND r2_cle IS NOT NULL
      ORDER BY version DESC LIMIT 1`,
    dossierId,
    code,
  );
  return ligne?.r2_cle ?? null;
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

async function une<T>(db: Preparer, requete: string, ...valeurs: unknown[]): Promise<T | null> {
  return db.prepare(requete).bind(...valeurs).first<T>();
}

async function plusieurs<T>(db: Preparer, requete: string, ...valeurs: unknown[]): Promise<T[]> {
  const recu = await db.prepare(requete).bind(...valeurs).all<T>();
  return recu.results ?? [];
}
