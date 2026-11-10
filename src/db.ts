import type { DossierPret } from "./dossiers.ts";
import type { Preuves } from "./guide.ts";
import type { Derogation, Etat, Exigence, Piece, Seance, StatutPiece } from "./verrous.ts";

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
  heures_total: number;
  modalite: string;
  handicap: number;
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
  tenus: string[];
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
            prix_ht_centimes, tva_taux_bp, heures_total, modalite, handicap
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

export type VersionPubliee = {
  code: string;
  version: number;
  pose_le: string;
  sha256: string;
  r2_cle: string;
};

export async function lireVersionsPubliees(db: Preparer): Promise<VersionPubliee[]> {
  return plusieurs<VersionPubliee>(
    db,
    "SELECT code, version, pose_le, sha256, r2_cle FROM versions_publiees ORDER BY code, version",
  );
}

export async function ajouterVersionPubliee(
  db: Preparer,
  entree: { id: string; code: string; poseLe: string; sha256: string; taille: number; ip: string },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO versions_publiees (id, code, version, pose_le, sha256, r2_cle, taille_octets)
         VALUES (
           ?, ?,
           (SELECT COALESCE(MAX(version), 0) + 1 FROM versions_publiees WHERE code = ?),
           ?, ?, ?, ?
         )`,
      )
      .bind(entree.id, entree.code, entree.code, entree.poseLe, entree.sha256, `organisme/${entree.sha256}`, entree.taille),
    db
      .prepare(
        `INSERT INTO audit (at_utc, acteur, ip, action, cible_type, cible_id, detail)
         VALUES (?, 'admin', ?, 'version_publiee', 'versions_publiees', ?, ?)`,
      )
      .bind(entree.poseLe, entree.ip, entree.id, JSON.stringify({ code: entree.code })),
  ]);
}

export type VersionPiece = {
  code: string;
  version: number;
  sha256: string;
  r2_cle: string;
};

const ALIAS_RETOUR: Record<string, string> = {
  suivi_elearning: "suivi",
  releve_connexion: "connexion",
  qcm_sortie: "qcm",
};

const DEPOTS: Record<string, { type: string; piece: { statut: string; libelle: string } | null }> = {
  analyse: { type: "analyse", piece: null },
  positionnement: { type: "positionnement", piece: null },
  reglement: { type: "reglement", piece: null },
  convention: { type: "convention", piece: null },
  programme: { type: "programme", piece: null },
  devis: { type: "devis", piece: null },
  convocation: { type: "convocation", piece: { statut: "envoyee", libelle: "Convocation" } },
  emargement: { type: "emargement", piece: { statut: "revenue", libelle: "Émargement" } },
  suivi: { type: "suivi_elearning", piece: null },
  connexion: { type: "releve_connexion", piece: null },
  qcm: { type: "qcm_sortie", piece: null },
  attestation: { type: "attestation", piece: null },
  facture: { type: "facture", piece: null },
};

export function depotConnu(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEPOTS, code);
}

function codeDepuisRetour(type: string, seanceId: string): string | null {
  if (type === "modele") return seanceId || null;
  return ALIAS_RETOUR[type] ?? type;
}

const TYPES_SIGNES = new Set([
  "analyse",
  "positionnement",
  "reglement",
  "devis",
  "convocation",
  "emargement",
  "suivi_elearning",
  "qcm_sortie",
  "attestation",
  "facture",
]);

function roleDepot(corps: string): "signe" | "version" | "" {
  try {
    const role = (JSON.parse(corps) as { role?: unknown }).role;
    if (role === "signe" || role === "version") return role;
  } catch {
    return "";
  }
  return "";
}

function conventionsRepetees(lignes: readonly { type: string; sha256: string }[]): Set<string> {
  const comptes = new Map<string, number>();
  for (const ligne of lignes) {
    if (ligne.type !== "convention") continue;
    comptes.set(ligne.sha256, (comptes.get(ligne.sha256) ?? 0) + 1);
  }
  return new Set([...comptes].filter(([, nombre]) => nombre > 1).map(([sha]) => sha));
}

function estSigne(type: string, corps: string, sha256: string, repetees: Set<string>): boolean {
  const role = roleDepot(corps);
  if (role === "version") return false;
  if (role === "signe") return true;
  if (type === "convention" && repetees.has(sha256)) return true;
  return TYPES_SIGNES.has(type);
}

async function lireRetoursFichiers(db: Preparer, dossierId: string) {
  return plusieurs<{ type: string; seance_id: string; corps: string; sha256: string; r2_cle: string; recu_le: string }>(
    db,
    `SELECT type, seance_id, corps, sha256, r2_cle, recu_le
       FROM retours
      WHERE dossier_id = ? AND r2_cle IS NOT NULL AND sha256 IS NOT NULL
      ORDER BY recu_le, version`,
    dossierId,
  );
}

export async function lireSignesPieces(db: Preparer, dossierId: string): Promise<VersionPiece[]> {
  const lignes = await lireRetoursFichiers(db, dossierId);
  const repetees = conventionsRepetees(lignes);
  const derniers = new Map<string, { sha256: string; r2_cle: string; recu_le: string }>();
  for (const ligne of lignes) {
    if (!estSigne(ligne.type, ligne.corps, ligne.sha256, repetees)) continue;
    const code = codeDepuisRetour(ligne.type, ligne.seance_id);
    if (!code) continue;
    const connu = derniers.get(code);
    if (!connu || ligne.recu_le >= connu.recu_le) derniers.set(code, ligne);
  }
  return [...derniers].map(([code, ligne]) => ({ code, version: 0, sha256: ligne.sha256, r2_cle: ligne.r2_cle }));
}

export async function lireVersionsPieces(db: Preparer, dossierId: string): Promise<VersionPiece[]> {
  const retours = await lireRetoursFichiers(db, dossierId);
  const repetees = conventionsRepetees(retours);
  const groupes = new Map<string, { sha256: string; r2_cle: string; recu_le: string }[]>();
  for (const ligne of retours) {
    if (estSigne(ligne.type, ligne.corps, ligne.sha256, repetees)) continue;
    const code = codeDepuisRetour(ligne.type, ligne.seance_id);
    if (!code) continue;
    const liste = groupes.get(code) ?? [];
    liste.push({ sha256: ligne.sha256, r2_cle: ligne.r2_cle, recu_le: ligne.recu_le });
    groupes.set(code, liste);
  }
  const devis = await une<{ sha256: string; r2_cle: string; cree_le: string }>(
    db,
    `SELECT sha256, r2_cle, cree_le FROM devis
      WHERE dossier_id = ? AND statut != 'annule' AND r2_cle IS NOT NULL AND sha256 IS NOT NULL
      ORDER BY annee, numero LIMIT 1`,
    dossierId,
  );
  if (devis?.sha256 && devis.r2_cle) {
    const liste = groupes.get("devis") ?? [];
    if (!liste.some((ligne) => ligne.sha256 === devis.sha256)) {
      liste.push({ sha256: devis.sha256, r2_cle: devis.r2_cle, recu_le: devis.cree_le });
    }
    groupes.set("devis", liste);
  }
  const sortie: VersionPiece[] = [];
  for (const [code, liste] of groupes) {
    liste.sort((a, b) => a.recu_le.localeCompare(b.recu_le));
    liste.forEach((ligne, index) => {
      sortie.push({ code, version: index + 1, sha256: ligne.sha256, r2_cle: ligne.r2_cle });
    });
  }
  return sortie;
}

export async function lireShaModeles(db: Preparer, dossierId: string): Promise<Map<string, string>> {
  const lignes = await plusieurs<{ seance_id: string; version: number; sha256: string }>(
    db,
    `SELECT seance_id, version, sha256 FROM retours
      WHERE dossier_id = ? AND type = 'modele' AND sha256 IS NOT NULL
      ORDER BY version`,
    dossierId,
  );
  const rang = new Map<string, { version: number; sha256: string }>();
  for (const ligne of lignes) {
    const connu = rang.get(ligne.seance_id);
    if (!connu || Number(ligne.version) > connu.version) {
      rang.set(ligne.seance_id, { version: Number(ligne.version), sha256: ligne.sha256 });
    }
  }
  return new Map([...rang].map(([code, ligne]) => [code, ligne.sha256]));
}

export async function lireShaRetour(db: Preparer, dossierId: string, type: string): Promise<string | null> {
  const ligne = await une<{ sha256: string }>(
    db,
    `SELECT sha256 FROM retours
      WHERE dossier_id = ? AND type = ? AND seance_id = '' AND sha256 IS NOT NULL
      ORDER BY version DESC LIMIT 1`,
    dossierId,
    type,
  );
  return ligne?.sha256 ?? null;
}

export async function ajouterVersionProgramme(
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
      .bind(programmeId, entree.intitule, entree.heuresTotal, entree.heuresCoaching, entree.heuresElearning, entree.contenu),
    db.prepare("UPDATE dossiers SET programme_id = ? WHERE id = ?").bind(programmeId, entree.dossierId),
    db
      .prepare(
        `INSERT INTO pieces (
           id, dossier_id, code, seance_id, libelle, indicateur, echeance,
           echeance_verifiee_le, echeance_origine, statut, derniere_version
         )
         SELECT ?, ?, 'programme', '', 'Programme', NULL, NULL, NULL, 'registre', 'prete', 1
          WHERE NOT EXISTS (
            SELECT 1 FROM pieces WHERE dossier_id = ? AND code = 'programme' AND seance_id = ''
          )`,
      )
      .bind(crypto.randomUUID(), entree.dossierId, entree.dossierId),
    db
      .prepare(
        `INSERT INTO retours (
           id, dossier_id, type, seance_id, version, recu_le, ip, user_agent,
           corps, mime, taille_octets, sha256, r2_cle
         ) VALUES (
           ?, ?, 'programme', '',
           (SELECT COALESCE(MAX(version), 0) + 1 FROM retours WHERE dossier_id = ? AND type = 'programme' AND seance_id = ''),
           ?, ?, ?, '{}', 'application/pdf', ?, ?, ?
         )`,
      )
      .bind(
        crypto.randomUUID(),
        entree.dossierId,
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

export async function deposerPieceDossier(
  db: Preparer,
  entree: {
    dossierId: string;
    code: string;
    recuLe: string;
    ip: string;
    userAgent: string;
    sha256: string;
    taille: number;
    corps?: string;
    dossier?: DossierPret;
  },
): Promise<boolean> {
  const depot = DEPOTS[entree.code];
  if (!depot) return false;
  const requetes: RequeteLiee[] = [];
  if (entree.dossier && entree.dossier.id === entree.dossierId) {
    const fiche = entree.dossier;
    requetes.push(
      db
        .prepare(
          `UPDATE dossiers SET
             stagiaire_nom = ?,
             stagiaire_email = CASE WHEN ? = '' THEN stagiaire_email ELSE ? END,
             stagiaire_tel = CASE WHEN ? = '' THEN stagiaire_tel ELSE ? END,
             entreprise = ?,
             entreprise_siret = ?,
             entreprise_adresse = ?,
             representant = ?,
             financeur = CASE WHEN ? = '' THEN financeur ELSE ? END,
             financeur_dossier = CASE WHEN ? = '' THEN financeur_dossier ELSE ? END,
             intitule = ?,
             date_debut = ?,
             date_fin = COALESCE(?, date_fin),
             heures_total = ?,
             heures_coaching = ?,
             heures_elearning = ?,
             prix_ht_centimes = ?,
             tva_taux_bp = ?,
             modalite = ?
           WHERE id = ?`,
        )
        .bind(
          fiche.stagiaire_nom,
          fiche.stagiaire_email,
          fiche.stagiaire_email,
          fiche.stagiaire_tel,
          fiche.stagiaire_tel,
          fiche.entreprise,
          fiche.entreprise_siret,
          fiche.entreprise_adresse,
          fiche.representant,
          fiche.financeur,
          fiche.financeur,
          fiche.financeur_dossier,
          fiche.financeur_dossier,
          fiche.intitule,
          fiche.date_debut,
          fiche.date_fin,
          fiche.heures_total,
          fiche.heures_coaching,
          fiche.heures_elearning,
          fiche.prix_ht_centimes,
          fiche.tva_taux_bp,
          fiche.modalite,
          fiche.id,
        ),
    );
  }
  requetes.push(
    db
      .prepare(
        `INSERT INTO retours (
           id, dossier_id, type, seance_id, version, recu_le, ip, user_agent,
           corps, mime, taille_octets, sha256, r2_cle
         ) VALUES (
           ?, ?, ?, '',
           (SELECT COALESCE(MAX(version), 0) + 1 FROM retours WHERE dossier_id = ? AND type = ? AND seance_id = ''),
           ?, ?, ?, ?, 'application/pdf', ?, ?, ?
         )`,
      )
      .bind(
        crypto.randomUUID(),
        entree.dossierId,
        depot.type,
        entree.dossierId,
        depot.type,
        entree.recuLe,
        entree.ip,
        entree.userAgent,
        entree.corps && entree.corps.trim() !== "" ? entree.corps : "{}",
        entree.taille,
        entree.sha256,
        `scans/${entree.sha256}`,
      ),
  );
  if (depot.piece) {
    requetes.push(
      db
        .prepare(
          `INSERT INTO pieces (
             id, dossier_id, code, seance_id, libelle, indicateur, echeance,
             echeance_verifiee_le, echeance_origine, statut, derniere_version
           )
           SELECT ?, ?, ?, '', ?, NULL, NULL, NULL, 'registre', ?, 1
            WHERE NOT EXISTS (
              SELECT 1 FROM pieces WHERE dossier_id = ? AND code = ? AND seance_id = ''
            )`,
        )
        .bind(
          crypto.randomUUID(),
          entree.dossierId,
          entree.code,
          depot.piece.libelle,
          depot.piece.statut,
          entree.dossierId,
          entree.code,
        ),
      db
        .prepare(
          `UPDATE pieces
              SET statut = ?
            WHERE dossier_id = ? AND code = ? AND seance_id = ''
              AND statut IN ('attente', 'prete')`,
        )
        .bind(depot.piece.statut, entree.dossierId, entree.code),
    );
  }
  requetes.push(
    db
      .prepare(
        `INSERT INTO audit (at_utc, acteur, ip, action, cible_type, cible_id, detail)
         VALUES (?, 'admin', ?, 'piece_deposee', 'dossiers', ?, ?)`,
      )
      .bind(entree.recuLe, entree.ip, entree.dossierId, JSON.stringify({ code: entree.code })),
  );
  await db.batch(requetes);
  return true;
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
  const retours = await plusieurs<{ type: string }>(
    db,
    `SELECT type FROM retours
      WHERE dossier_id = ? AND seance_id = '' AND r2_cle IS NOT NULL
        AND type IN (
          'analyse', 'positionnement', 'reglement', 'devis', 'convocation',
          'emargement', 'suivi_elearning', 'releve_connexion', 'qcm_sortie', 'attestation', 'facture'
        )`,
    dossierId,
  );
  const convocation = await une<{ n: number }>(
    db,
    `SELECT count(*) AS n FROM pieces
      WHERE dossier_id = ? AND code = 'convocation' AND seance_id = ''
        AND statut IN ('envoyee', 'revenue')`,
    dossierId,
  );
  const tenus = retours.map((ligne) => ALIAS_RETOUR[ligne.type] ?? ligne.type);
  if ((convocation?.n ?? 0) > 0 && !tenus.includes("convocation")) tenus.push("convocation");
  return { convention, programme: (programme?.n ?? 0) > 0, devis, modeles: modeles.map((ligne) => ligne.seance_id), tenus };
}

export async function poserEmailStagiaire(
  db: Preparer,
  dossierId: string,
  email: string,
  recuLe: string,
  ip: string,
): Promise<void> {
  await db.batch([
    db.prepare("UPDATE dossiers SET stagiaire_email = ? WHERE id = ?").bind(email, dossierId),
    db
      .prepare(
        `INSERT INTO audit (at_utc, acteur, ip, action, cible_type, cible_id, detail)
         VALUES (?, 'admin', ?, 'email_stagiaire', 'dossiers', ?, '{}')`,
      )
      .bind(recuLe, ip, dossierId),
  ]);
}

const STATUTS_PIECE = new Set<StatutPiece>(["attente", "prete", "envoyee", "revenue", "annulee"]);
const STATUTS_SEANCE = new Set<Seance["statut"]>(["prevue", "tenue", "reportee"]);

export async function lireEtatVerrous(db: Preparer, dossierId: string, aujourdhui: string): Promise<Etat | null> {
  const dossier = await une<{ id: string; financeur: string; heures_elearning: number }>(
    db,
    "SELECT id, financeur, heures_elearning FROM dossiers WHERE id = ?",
    dossierId,
  );
  if (!dossier) return null;
  const reglages = await une<{
    nom: string;
    siret: string;
    nda: string;
    adresse: string;
    code_postal: string;
    ville: string;
    email: string;
    derogation_autorisee: number;
  }>(
    db,
    `SELECT nom, siret, nda, adresse, code_postal, ville, email, derogation_autorisee
       FROM reglages WHERE id = ?`,
    1,
  );
  if (!reglages) return null;
  const seances = await plusieurs<{ id: string; dossier_id: string; jour: string; statut: string; remplacee_par: string | null }>(
    db,
    "SELECT id, dossier_id, jour, statut, remplacee_par FROM seances WHERE dossier_id = ?",
    dossierId,
  );
  const retours = await plusieurs<{ type: string; seance_id: string }>(
    db,
    "SELECT type, seance_id FROM retours WHERE dossier_id = ? AND r2_cle IS NOT NULL",
    dossierId,
  );
  const pieces = await plusieurs<{ code: string; statut: string }>(
    db,
    "SELECT code, statut FROM pieces WHERE dossier_id = ? AND seance_id = ''",
    dossierId,
  );
  const exigences = await plusieurs<Exigence>(
    db,
    "SELECT financeur, code_piece, statut_requis FROM exigences_financeur",
  );
  const derogations = await plusieurs<Derogation>(
    db,
    "SELECT verrou_code, effet, creee_le FROM derogations WHERE dossier_id = ? ORDER BY creee_le",
    dossierId,
  );
  const piecesTenues: Piece[] = [];
  for (const ligne of pieces) {
    if (!STATUTS_PIECE.has(ligne.statut as StatutPiece)) continue;
    piecesTenues.push({ code: ligne.code, statut: ligne.statut as StatutPiece });
  }
  const seancesTenues: Seance[] = [];
  for (const ligne of seances) {
    if (!STATUTS_SEANCE.has(ligne.statut as Seance["statut"])) continue;
    seancesTenues.push({
      id: ligne.id,
      dossier_id: ligne.dossier_id,
      jour: ligne.jour,
      statut: ligne.statut as Seance["statut"],
      remplacee_par: ligne.remplacee_par,
    });
  }
  return {
    aujourdhui,
    reglages: {
      nom: reglages.nom,
      siret: reglages.siret,
      nda: reglages.nda,
      adresse: reglages.adresse,
      code_postal: reglages.code_postal,
      ville: reglages.ville,
      email: reglages.email,
      derogation_autorisee: reglages.derogation_autorisee === 1 ? 1 : 0,
    },
    dossier,
    seances: seancesTenues,
    retours,
    pieces: piecesTenues,
    exigences: exigences.filter((ligne) => ligne.statut_requis === "prete" || ligne.statut_requis === "revenue"),
    derogations: derogations.filter((ligne) => ligne.effet === "levee" || ligne.effet === "retablie"),
  };
}

export async function noterEnvoi(
  db: Preparer,
  entree: { dossierId: string; moment: string; codes: readonly string[]; recuLe: string; ip: string },
): Promise<void> {
  const requetes: RequeteLiee[] = [];
  if (entree.codes.includes("convocation")) {
    requetes.push(
      db
        .prepare(
          `INSERT INTO pieces (
             id, dossier_id, code, seance_id, libelle, indicateur, echeance,
             echeance_verifiee_le, echeance_origine, statut, derniere_version
           )
           SELECT ?, ?, 'convocation', '', 'Convocation', NULL, NULL, NULL, 'registre', 'envoyee', 1
            WHERE NOT EXISTS (
              SELECT 1 FROM pieces WHERE dossier_id = ? AND code = 'convocation' AND seance_id = ''
            )`,
        )
        .bind(crypto.randomUUID(), entree.dossierId, entree.dossierId),
      db
        .prepare(
          `UPDATE pieces
              SET statut = 'envoyee'
            WHERE dossier_id = ? AND code = 'convocation' AND seance_id = ''
              AND statut IN ('attente', 'prete')`,
        )
        .bind(entree.dossierId),
    );
  }
  requetes.push(
    db
      .prepare(
        `INSERT INTO audit (at_utc, acteur, ip, action, cible_type, cible_id, detail)
         VALUES (?, 'admin', ?, 'courrier_envoye', 'dossiers', ?, ?)`,
      )
      .bind(entree.recuLe, entree.ip, entree.dossierId, JSON.stringify({ moment: entree.moment, pieces: entree.codes })),
  );
  await db.batch(requetes);
}

export async function lireDevisEmis(
  db: Preparer,
  dossierId: string,
): Promise<{ annee: number; numero: number; cree_le: string; sha256: string } | null> {
  return une(
    db,
    `SELECT annee, numero, cree_le, sha256 FROM devis
      WHERE dossier_id = ? AND statut != 'annule' AND r2_cle IS NOT NULL
      ORDER BY annee, numero LIMIT 1`,
    dossierId,
  );
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
         ) VALUES (
           ?, ?, 'modele', ?,
           (SELECT COALESCE(MAX(version), 0) + 1 FROM retours WHERE dossier_id = ? AND type = 'modele' AND seance_id = ?),
           ?, ?, ?, '{}', 'application/pdf', ?, ?, ?
         )`,
      )
      .bind(
        crypto.randomUUID(),
        entree.dossierId,
        entree.code,
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
    sans_connexion: number;
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
       ) THEN 1 ELSE 0 END), 0) AS sans_suivi,
       COALESCE(SUM(CASE WHEN d.heures_elearning > 0 AND NOT EXISTS (
         SELECT 1 FROM retours r WHERE r.dossier_id = d.id AND r.type = 'releve_connexion'
       ) THEN 1 ELSE 0 END), 0) AS sans_connexion
     FROM dossiers d
     WHERE d.statut != 'clos'`,
  );
  const dates = new Map<string, string>();
  for (const ligne of await plusieurs<{ code: string; pose_le: string }>(
    db,
    "SELECT code, MAX(pose_le) AS pose_le FROM versions_organisme WHERE tient = 1 GROUP BY code",
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
    sansConnexion: Number(compte?.sans_connexion ?? 0),
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

export async function lireMatiere(db: Preparer): Promise<{
  risques: { risque: string; parade: string }[];
  reclamations: { auteur: string; objet: string; suite: string }[];
  mesures: { constat: string; mesure: string }[];
}> {
  return {
    risques: await plusieurs<{ risque: string; parade: string }>(db, "SELECT risque, parade FROM risques ORDER BY creee_le"),
    reclamations: await plusieurs<{ auteur: string; objet: string; suite: string }>(db, "SELECT auteur, objet, suite FROM reclamations ORDER BY creee_le"),
    mesures: await plusieurs<{ constat: string; mesure: string }>(db, "SELECT constat, mesure FROM mesures ORDER BY creee_le"),
  };
}

export async function lireVersionsOrganisme(db: Preparer): Promise<VersionOrganisme[]> {
  return plusieurs<VersionOrganisme>(
    db,
    "SELECT code, version, pose_le, sha256, r2_cle FROM versions_organisme ORDER BY code, version",
  );
}

export async function ajouterVersionOrganisme(
  db: Preparer,
  entree: { id: string; code: string; poseLe: string; origine: "depot" | "produit"; sha256: string; taille: number; ip: string; tient: boolean },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO versions_organisme (id, code, version, pose_le, origine, sha256, r2_cle, taille_octets, tient)
         VALUES (
           ?, ?,
           (SELECT COALESCE(MAX(version), 0) + 1 FROM versions_organisme WHERE code = ?),
           ?, ?, ?, ?, ?, ?
         )`,
      )
      .bind(
        entree.id,
        entree.code,
        entree.code,
        entree.poseLe,
        entree.origine,
        entree.sha256,
        `audit/${entree.sha256}`,
        entree.taille,
        entree.tient ? 1 : 0,
      ),
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
