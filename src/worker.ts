import {
  adresseIp,
  agent,
  cookieHote,
  effacerCookie,
  empreinteJeton,
  lireCookie,
  memesJetons,
  NOM_CSRF,
  NOM_SESSION,
  nouveauJeton,
} from "./cookies.ts";
import {
  ecrireEchec,
  insererDossier,
  lireCompteurGlobal,
  lireCompteurIp,
  clePiece,
  lireDossier,
  lireEtatPieces,
  lireHashMotDePasse,
  lireOrganisme,
  lireSecret,
  lireSession,
  lireTailleDepot,
  listerDossiers,
  ouvrirSession,
  supprimerSession,
  type Compteur,
  type FichierConvention,
  type Preparer,
  type Secret,
} from "./db.ts";
import { lireConvention, pdfReconnu } from "./convention.ts";
import { analyserDossier, saisieVide, type SaisieDossier } from "./dossiers.ts";
import { textePdf } from "./pdf.ts";
import type { Reprise } from "./pages.ts";
import { entetes, reponse, reponseHtml, reponseOctets, redirection } from "./entetes.ts";
import { phraseCorrespond, validerPhrase } from "./mot-de-passe.ts";
import { numeroDevis } from "./montants.ts";
import { FEUILLE, pageAccueil, pageConnexion, pageDossier } from "./pages.ts";
import { numeroConvention, produirePieces, type Stockage } from "./produire.ts";
import { prouverPbkdf2 } from "./preuve.ts";

export type Fichiers = Stockage;

export type Env = {
  DB: Preparer;
  FICHIERS?: Fichiers;
  PREUVE?: string;
  maintenant?: () => Date;
};

const PHRASE_MAX = 4096;

export async function repondre(requete: Request, env: Env): Promise<Response> {
  const url = new URL(requete.url);
  if (requete.method === "GET" && url.pathname === "/preuve-pbkdf2" && env.PREUVE === "1") {
    try {
      await prouverPbkdf2();
      return reponse(200, "pbkdf2 ok\n");
    } catch (erreur) {
      return reponse(500, `${messageDe(erreur)}\n`);
    }
  }
  if (requete.method === "GET" && url.pathname === "/registre.css") {
    return new Response(FEUILLE, { status: 200, headers: entetes("text/css; charset=utf-8") });
  }

  let hash: string | null;
  try {
    hash = await lireHashMotDePasse(env.DB);
  } catch {
    return reponse(503, "La base ne répond pas.\n");
  }
  if (hash === null) return reponse(503, "Le mot de passe n'est pas posé.\n");

  try {
    return await aiguiller(requete, url, env);
  } catch {
    return reponse(503, "La base ne répond pas.\n");
  }
}

async function aiguiller(requete: Request, url: URL, env: Env): Promise<Response> {
  if (requete.method === "GET" && url.pathname === "/") return accueilOuConnexion(requete, env);
  if (requete.method === "POST" && url.pathname === "/connexion") return connecter(requete, env);
  if (requete.method === "POST" && url.pathname === "/sortie") return sortir(requete, env);
  if (requete.method === "POST" && url.pathname === "/dossiers") return creerDossier(requete, env);
  if (requete.method === "GET") {
    const chemin = cheminDossier(url.pathname);
    if (chemin) return chemin.piece ? telecharger(requete, env, chemin.id, chemin.piece) : voirDossier(requete, env, chemin.id);
  }
  return reponse(404, "Cette page n'existe pas.\n");
}

function cheminDossier(pathname: string): { id: string; piece: "convention" | "programme" | "devis" | null } | null {
  const trouve = /^\/dossiers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(convention|programme|devis))?$/.exec(
    pathname,
  );
  if (!trouve?.[1]) return null;
  const piece = trouve[2];
  if (piece === "convention" || piece === "programme" || piece === "devis") return { id: trouve[1], piece };
  return { id: trouve[1], piece: null };
}

async function voirDossier(requete: Request, env: Env, id: string): Promise<Response> {
  const secret = await exigerSecret(env);
  const session = await sessionOuverte(requete, env);
  if (!session) return formulaireConnexion(secret, null, session === undefined ? 401 : 200, session === undefined);
  const organisme = await lireOrganisme(env.DB);
  await produirePieces(env.DB, env.FICHIERS, id, organisme, adresseIp(requete), agent(requete), iso(heure(env)));
  const dossier = await lireDossier(env.DB, id);
  if (!dossier) return reponse(404, "Ce dossier n'existe pas.\n");
  const etat = await lireEtatPieces(env.DB, id);
  return reponseHtml(
    200,
    pageDossier(dossier, {
      convention: etat.convention !== null,
      programme: etat.programme,
      devis: etat.devis,
      numeroConvention: etat.convention ? numeroConvention(etat.convention.corps) : "",
    }, session.csrf),
  );
}

async function telecharger(
  requete: Request,
  env: Env,
  id: string,
  piece: "convention" | "programme" | "devis",
): Promise<Response> {
  const secret = await exigerSecret(env);
  const session = await sessionOuverte(requete, env);
  if (!session) return formulaireConnexion(secret, null, session === undefined ? 401 : 200, session === undefined);
  if (!env.FICHIERS) return reponse(503, "Le stockage ne répond pas.\n");
  const cible = await cleTelechargement(env, id, piece);
  if (!cible) return reponse(404, "Cette pièce n'est pas là.\n");
  try {
    const objet = await env.FICHIERS.get(cible.cle);
    if (!objet) return reponse(404, "Cette pièce n'est pas là.\n");
    return reponseOctets(new Uint8Array(await objet.arrayBuffer()), "application/pdf", cible.nom);
  } catch {
    return reponse(503, "Le stockage ne répond pas.\n");
  }
}

async function cleTelechargement(
  env: Env,
  id: string,
  piece: "convention" | "programme" | "devis",
): Promise<{ cle: string; nom: string } | null> {
  if (piece === "devis") {
    const etat = await lireEtatPieces(env.DB, id);
    if (!etat.devis?.r2_cle) return null;
    return { cle: etat.devis.r2_cle, nom: `devis-${numeroDevis(etat.devis.annee, etat.devis.numero)}.pdf` };
  }
  const cle = await clePiece(env.DB, id, piece);
  if (!cle) return null;
  return { cle, nom: piece === "programme" ? "programme.pdf" : "convention.pdf" };
}

async function accueilOuConnexion(requete: Request, env: Env): Promise<Response> {
  const secret = await exigerSecret(env);
  const session = await sessionOuverte(requete, env);
  if (!session) return formulaireConnexion(secret, null, 200, session === undefined);
  const fiche = await lireOrganisme(env.DB);
  const dossiers = await listerDossiers(env.DB);
  return reponseHtml(200, pageAccueil(fiche, dossiers, session.csrf, null, saisieVide()));
}

async function connecter(requete: Request, env: Env): Promise<Response> {
  const secret = await exigerSecret(env);
  const formulaire = await lireFormulaire(requete);
  if (!formulaire) return reponse(400, "Le formulaire est illisible.\n");
  if (!csrfAnonyme(requete, formulaire)) {
    return formulaireConnexion(secret, "La page a expiré. Recharge-la.", 403, false);
  }

  const phrase = brut(formulaire.get("phrase"));
  const validation = validerPhrase(phrase);
  if (!validation.ok || [...phrase].length > PHRASE_MAX) {
    const raison = validation.ok ? "La phrase est trop longue." : validation.raison;
    return formulaireConnexion(secret, raison, 401, false);
  }

  const ip = adresseIp(requete);
  const maintenant = iso(heure(env));
  const bloque = await instantBlocage(env.DB, ip, maintenant);
  if (bloque) return formulaireConnexion(secret, messageBlocage(bloque), 429, false);

  const correspond = await phraseCorrespond(phrase, secret.mot_de_passe_sel, secret.mot_de_passe_hash);
  if (!correspond) {
    const jusqua = await noterEchec(env, ip, maintenant, secret);
    return formulaireConnexion(
      secret,
      jusqua ? messageBlocage(jusqua) : "La phrase ne correspond pas.",
      jusqua ? 429 : 401,
      false,
    );
  }

  const jeton = nouveauJeton();
  const csrf = nouveauJeton();
  const expire = new Date(Date.parse(maintenant) + secret.session_ttl_secondes * 1000).toISOString();
  await ouvrirSession(env.DB, {
    tokenHash: await empreinteJeton(jeton),
    csrfHash: await empreinteJeton(csrf),
    creeeLe: maintenant,
    expiresAt: expire,
    ip,
    userAgent: agent(requete),
  });
  return redirection("/", [
    cookieHote(NOM_SESSION, jeton, secret.session_ttl_secondes),
    cookieHote(NOM_CSRF, csrf, secret.session_ttl_secondes),
  ]);
}

async function sortir(requete: Request, env: Env): Promise<Response> {
  const secret = await exigerSecret(env);
  const session = await sessionOuverte(requete, env);
  if (!session) return formulaireConnexion(secret, null, 200, true);
  const formulaire = await lireFormulaire(requete);
  if (!formulaire || !memesJetons(session.csrf, brut(formulaire.get("csrf")))) {
    const fiche = await lireOrganisme(env.DB);
    const dossiers = await listerDossiers(env.DB);
    return reponseHtml(403, pageAccueil(fiche, dossiers, session.csrf, "La page a expiré. Recharge-la.", saisieVide()));
  }
  await supprimerSession(env.DB, session.hash, adresseIp(requete), iso(heure(env)));
  return redirection("/", [effacerCookie(NOM_SESSION), effacerCookie(NOM_CSRF)]);
}

async function creerDossier(requete: Request, env: Env): Promise<Response> {
  const secret = await exigerSecret(env);
  const session = await sessionOuverte(requete, env);
  if (!session) return formulaireConnexion(secret, null, 401, true);
  const tailleMax = await lireTailleDepot(env.DB);
  const longueur = Number(requete.headers.get("Content-Length") ?? "0");
  const fiche = await lireOrganisme(env.DB);
  const dossiers = await listerDossiers(env.DB);
  if (Number.isFinite(longueur) && longueur > tailleMax + 65_536) {
    return reponseHtml(413, pageAccueil(fiche, dossiers, session.csrf, "La convention dépasse la taille admise.", saisieVide()));
  }
  const formulaire = await lireFormulaire(requete, tailleMax + 65_536);
  if (!formulaire) return reponse(400, "Le formulaire est illisible.\n");
  if (!memesJetons(session.csrf, brut(formulaire.get("csrf")))) {
    return reponseHtml(403, pageAccueil(fiche, dossiers, session.csrf, "La page a expiré. Recharge-la.", saisieVide()));
  }

  const fichier = formulaire.get("convention");
  if (fichier instanceof File && fichier.size > 0) {
    return ouvrirDepuisFichier(fichier, fiche, dossiers, session.csrf, env, requete, tailleMax);
  }

  const sha256 = brut(formulaire.get("sha256"));
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    return reponseHtml(400, pageAccueil(fiche, dossiers, session.csrf, "La convention manque.", saisieVide()));
  }
  const analyse = analyserDossier(formulaire, crypto.randomUUID(), iso(heure(env)));
  if (!analyse.ok) {
    return reponseHtml(
      400,
      pageAccueil(fiche, dossiers, session.csrf, analyse.raison, analyse.saisie, {
        sha256,
        numero: brut(formulaire.get("numero")).slice(0, 80),
        devis: brut(formulaire.get("devis")).slice(0, 80),
      }),
    );
  }
  const pose = await deposer(env.FICHIERS, sha256, null);
  if (pose === "erreur" || pose === "absent" && !env.FICHIERS) {
    return reponseHtml(503, pageAccueil(fiche, dossiers, session.csrf, "Le stockage ne répond pas.", saisieVide()));
  }
  if (pose !== "present") {
    return reponseHtml(
      400,
      pageAccueil(fiche, dossiers, session.csrf, "La convention n'est plus là. Dépose-la à nouveau.", saisieVide()),
    );
  }
  return enregistrer(env, requete, analyse.dossier, analyse.saisie, session.csrf, fiche, dossiers, {
    sha256,
    taille: 0,
    numero: brut(formulaire.get("numero")).slice(0, 80),
    devis: brut(formulaire.get("devis")).slice(0, 80),
    recuLe: iso(heure(env)),
    userAgent: agent(requete),
  });
}

async function ouvrirDepuisFichier(
  fichier: File,
  fiche: Awaited<ReturnType<typeof lireOrganisme>>,
  dossiers: Awaited<ReturnType<typeof listerDossiers>>,
  csrf: string,
  env: Env,
  requete: Request,
  tailleMax: number,
): Promise<Response> {
  if (fichier.size > tailleMax) {
    return reponseHtml(413, pageAccueil(fiche, dossiers, csrf, "La convention dépasse la taille admise.", saisieVide()));
  }
  const octets = new Uint8Array(await fichier.arrayBuffer());
  if (!pdfReconnu(octets)) {
    return reponseHtml(400, pageAccueil(fiche, dossiers, csrf, "Le fichier n'est pas un PDF.", saisieVide()));
  }
  const sha256 = await empreinteFichier(octets.slice());
  let lecture: ReturnType<typeof lireConvention>;
  try {
    lecture = lireConvention(await textePdf(octets.slice()), fiche.email);
  } catch {
    return reponseHtml(400, pageAccueil(fiche, dossiers, csrf, "Cette convention n'a pas pu être lue.", saisieVide()));
  }
  if (!lecture.saisie.stagiaire_nom && !lecture.saisie.intitule && !lecture.saisie.entreprise) {
    return reponseHtml(400, pageAccueil(fiche, dossiers, csrf, "Cette convention n'a pas pu être lue.", saisieVide()));
  }
  const pose = await deposer(env.FICHIERS, sha256, octets.slice());
  if (pose === "absent" || pose === "erreur") {
    return reponseHtml(503, pageAccueil(fiche, dossiers, csrf, "Le stockage ne répond pas.", saisieVide()));
  }
  const reprise: Reprise = { sha256, numero: lecture.numero, devis: lecture.devis };
  if (lecture.raisons.length > 0) {
    return reponseHtml(400, pageAccueil(fiche, dossiers, csrf, lecture.raisons.join(" "), lecture.saisie, reprise));
  }
  const analyse = analyserDossier(formulaireSaisie(lecture.saisie), crypto.randomUUID(), iso(heure(env)));
  if (!analyse.ok) {
    return reponseHtml(400, pageAccueil(fiche, dossiers, csrf, analyse.raison, lecture.saisie, reprise));
  }
  return enregistrer(env, requete, analyse.dossier, analyse.saisie, csrf, fiche, dossiers, {
    sha256,
    taille: octets.byteLength,
    numero: lecture.numero,
    devis: lecture.devis,
    recuLe: iso(heure(env)),
    userAgent: agent(requete),
  });
}

async function enregistrer(
  env: Env,
  requete: Request,
  dossier: Parameters<typeof insererDossier>[1],
  saisie: SaisieDossier,
  csrf: string,
  fiche: Awaited<ReturnType<typeof lireOrganisme>>,
  dossiers: Awaited<ReturnType<typeof listerDossiers>>,
  fichier: FichierConvention,
): Promise<Response> {
  if (fichier.taille === 0) {
    const tete = env.FICHIERS ? await env.FICHIERS.head(`scans/${fichier.sha256}`) : null;
    fichier = { ...fichier, taille: tailleObjet(tete) };
  }
  try {
    await insererDossier(env.DB, dossier, adresseIp(requete), fichier);
  } catch {
    return reponseHtml(
      400,
      pageAccueil(fiche, dossiers, csrf, "Le dossier n'a pas été enregistré.", saisie, {
        sha256: fichier.sha256,
        numero: fichier.numero,
        devis: fichier.devis,
      }),
    );
  }
  return redirection("/");
}

async function deposer(
  fichiers: Fichiers | undefined,
  sha256: string,
  octets: Uint8Array | null,
): Promise<"present" | "absent" | "pose" | "erreur"> {
  if (!fichiers) return "absent";
  try {
    const cle = `scans/${sha256}`;
    const deja = await fichiers.head(cle);
    if (deja) return "present";
    if (!octets) return "absent";
    await fichiers.put(cle, octets, { httpMetadata: { contentType: "application/pdf" } });
    return "pose";
  } catch {
    return "erreur";
  }
}

function tailleObjet(tete: unknown): number {
  if (!tete || typeof tete !== "object" || !("size" in tete)) return 0;
  const taille = tete.size;
  return typeof taille === "number" && taille > 0 ? taille : 0;
}

function formulaireSaisie(saisie: SaisieDossier): FormData {
  const formulaire = new FormData();
  for (const [nom, valeur] of Object.entries(saisie)) formulaire.set(nom, valeur);
  return formulaire;
}

async function empreinteFichier(octets: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", octets);
  return [...new Uint8Array(digest)].map((octet) => octet.toString(16).padStart(2, "0")).join("");
}

async function sessionOuverte(
  requete: Request,
  env: Env,
): Promise<{ csrf: string; hash: string } | null | undefined> {
  const jeton = lireCookie(requete.headers.get("Cookie"), NOM_SESSION);
  const csrf = lireCookie(requete.headers.get("Cookie"), NOM_CSRF);
  if (!jeton || !csrf) return jeton ? undefined : null;
  const hash = await empreinteJeton(jeton);
  const ligne = await lireSession(env.DB, hash);
  if (!ligne || ligne.expires_at <= iso(heure(env))) {
    if (ligne) await supprimerSession(env.DB, hash, adresseIp(requete), iso(heure(env)));
    return undefined;
  }
  const csrfHash = await empreinteJeton(csrf);
  if (!memesJetons(csrfHash, ligne.csrf_hash)) return undefined;
  return { csrf, hash };
}

async function exigerSecret(env: Env): Promise<Secret> {
  const secret = await lireSecret(env.DB);
  if (!secret) throw new Error("mot de passe absent");
  return secret;
}

function formulaireConnexion(secret: Secret, erreur: string | null, statut: number, effacerSession: boolean): Response {
  const csrf = nouveauJeton();
  const cookies = [cookieHote(NOM_CSRF, csrf, secret.session_ttl_secondes)];
  if (effacerSession) cookies.push(effacerCookie(NOM_SESSION));
  return reponseHtml(statut, pageConnexion(csrf, erreur), cookies);
}

function csrfAnonyme(requete: Request, formulaire: FormData): boolean {
  const cookie = lireCookie(requete.headers.get("Cookie"), NOM_CSRF);
  const champ = brut(formulaire.get("csrf"));
  return cookie !== null && champ !== "" && memesJetons(cookie, champ);
}

async function instantBlocage(db: Preparer, ip: string, maintenant: string): Promise<string | null> {
  const [ligneIp, ligneGlobale] = await Promise.all([lireCompteurIp(db, ip), lireCompteurGlobal(db)]);
  return plusTard(echeance(ligneIp, maintenant), echeance(ligneGlobale, maintenant));
}

async function noterEchec(env: Env, ip: string, maintenant: string, secret: Secret): Promise<string | null> {
  const [ligneIp, ligneGlobale] = await Promise.all([lireCompteurIp(env.DB, ip), lireCompteurGlobal(env.DB)]);
  const echecsIp = (echecsOuverts(ligneIp, maintenant) ?? 0) + 1;
  const echecsGlobal = (echecsOuverts(ligneGlobale, maintenant) ?? 0) + 1;
  const jusqua = new Date(Date.parse(maintenant) + secret.connexion_blocage_secondes * 1000).toISOString();
  const bloqueIp = echecsIp >= secret.connexion_seuil ? jusqua : null;
  const bloqueGlobal = echecsGlobal >= secret.connexion_seuil ? jusqua : null;
  await ecrireEchec(env.DB, ip, echecsIp, bloqueIp, echecsGlobal, bloqueGlobal, maintenant);
  return bloqueIp ?? bloqueGlobal;
}

function echecsOuverts(compteur: Compteur | null, maintenant: string): number | null {
  if (!compteur) return 0;
  if (compteur.bloque_jusqu_au && compteur.bloque_jusqu_au > maintenant) return null;
  if (compteur.bloque_jusqu_au && compteur.bloque_jusqu_au <= maintenant) return 0;
  return compteur.echecs;
}

function echeance(compteur: Compteur | null, maintenant: string): string | null {
  if (!compteur?.bloque_jusqu_au || compteur.bloque_jusqu_au <= maintenant) return null;
  return compteur.bloque_jusqu_au;
}

function plusTard(a: string | null, b: string | null): string | null {
  if (a && b) return a > b ? a : b;
  return a ?? b;
}

function messageBlocage(instant: string): string {
  const heureLocale = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(instant));
  return `Trop d'échecs. Réessaie à partir de ${heureLocale}.`;
}

async function lireFormulaire(requete: Request, max = 100_000): Promise<FormData | null> {
  const longueur = Number(requete.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(longueur) && longueur > max) return null;
  try {
    return await requete.formData();
  } catch {
    return null;
  }
}

function brut(valeur: FormDataEntryValue | null): string {
  return typeof valeur === "string" ? valeur : "";
}

function heure(env: Env): Date {
  return env.maintenant ? env.maintenant() : new Date();
}

function iso(date: Date): string {
  return date.toISOString();
}

function messageDe(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur);
}
