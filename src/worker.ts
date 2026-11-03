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
  lireHashMotDePasse,
  lireOrganisme,
  lireSecret,
  lireSession,
  listerDossiers,
  ouvrirSession,
  supprimerSession,
  type Compteur,
  type Preparer,
  type Secret,
} from "./db.ts";
import { analyserDossier, saisieVide } from "./dossiers.ts";
import { entetes, reponse, reponseHtml, redirection } from "./entetes.ts";
import { phraseCorrespond, validerPhrase } from "./mot-de-passe.ts";
import { FEUILLE, pageAccueil, pageConnexion } from "./pages.ts";
import { prouverPbkdf2 } from "./preuve.ts";

export type Env = {
  DB: Preparer;
  FICHIERS?: unknown;
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
  return reponse(404, "Cette page n'existe pas.\n");
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
  const formulaire = await lireFormulaire(requete);
  const fiche = await lireOrganisme(env.DB);
  const dossiers = await listerDossiers(env.DB);
  if (!formulaire) return reponse(400, "Le formulaire est illisible.\n");
  if (!memesJetons(session.csrf, brut(formulaire.get("csrf")))) {
    return reponseHtml(403, pageAccueil(fiche, dossiers, session.csrf, "La page a expiré. Recharge-la.", saisieVide()));
  }
  const analyse = analyserDossier(formulaire, crypto.randomUUID(), iso(heure(env)));
  if (!analyse.ok) {
    return reponseHtml(400, pageAccueil(fiche, dossiers, session.csrf, analyse.raison, analyse.saisie));
  }
  try {
    await insererDossier(env.DB, analyse.dossier, adresseIp(requete));
  } catch {
    return reponseHtml(400, pageAccueil(fiche, dossiers, session.csrf, "Le dossier n'a pas été enregistré.", analyse.saisie));
  }
  return redirection("/");
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

async function lireFormulaire(requete: Request): Promise<FormData | null> {
  const longueur = Number(requete.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(longueur) && longueur > 100_000) return null;
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
