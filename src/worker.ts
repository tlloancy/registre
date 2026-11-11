import {
  adresseIp,
  agent,
  cookieHote,
  effacerCookie,
  empreinteJeton,
  lireCookie,
  memesJetons,
  NOM_CSRF,
  NOM_INFO,
  NOM_SESSION,
  nouveauJeton,
} from "./cookies.ts";
import {
  ajouterVersionOrganisme,
  ecrireEchec,
  ecrireNorme,
  ajouterVersionPubliee,
  deposerPieceDossier,
  depotConnu,
  lireSignesPieces,
  lireVersionsPieces,
  lireVersionsPubliees,
  insererDossier,
  lireCompteurGlobal,
  lireCompteurIp,
  lireDossier,
  lireEtatPieces,
  lireEtatVerrous,
  lireHashMotDePasse,
  lireMatiere,
  lireNorme,
  lireOrganisme,
  lirePreuves,
  lireSecret,
  lireSession,
  lireTailleDepot,
  lireVersionsOrganisme,
  listerDossiers,
  marquerGuideLu,
  noterEnvoi,
  poserEmailStagiaire,
  ouvrirSession,
  supprimerSession,
  type Compteur,
  type DossierLigne,
  type FichierConvention,
  type Preparer,
  type Secret,
} from "./db.ts";
import { lireConvention, pdfReconnu } from "./convention.ts";
import { analyserDossier, saisieVide, type SaisieDossier } from "./dossiers.ts";
import { glyphesPdf, textePdf } from "./pdf.ts";
import { couvreDocument, estSignature } from "./signature.ts";
import type { Fiche, Reprise } from "./pages.ts";
import { entetes, reponse, reponseHtml, reponseOctets, redirection } from "./entetes.ts";
import { phraseCorrespond, validerPhrase } from "./mot-de-passe.ts";
import { numeroDevis } from "./montants.ts";
import {
  guidePerime,
  NOTES,
  noteParCode,
  PAGE_GUIDE,
  conformite,
  presenterGuide,
  serialiserReleve,
  telechargerGuide,
  texteExigence,
} from "./guide.ts";
import { htmlVersPdf, normaliserHtml } from "./html-pdf.ts";
import { FEUILLE, lierDossier, lignesBilan, pageAccueil, pageConnexion, pageDossier, SCRIPT } from "./pages.ts";
import { archiveZip } from "./zip.ts";
import { MODELES, pieceProduite } from "./modeles.ts";
import { chargerDocumentOrganisme, documentOrganisme } from "./organisme.ts";
import { numeroConvention, produireModele, produirePieces, type Stockage } from "./produire.ts";
import { prouverPbkdf2 } from "./preuve.ts";
import { envoyerBrevo, type CourrierSortant } from "./brevo.ts";
import { emailAdmissible, attenteCochee, catalogueCourrier, etiquetteEnvoi, inclureSiCochee, lettreCourrier, messagePage, momentConnu, retenirCible, selectionCourrier, titreMoment, type Moment } from "./courrier.ts";
import { juger, type Etat } from "./verrous.ts";

export type Fichiers = Stockage;

export type Env = {
  DB: Preparer;
  FICHIERS?: Fichiers;
  PREUVE?: string;
  BREVO_API_KEY?: string;
  envoyerCourrier?: (courrier: CourrierSortant) => Promise<boolean>;
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
  if (requete.method === "GET" && url.pathname === "/registre.js") {
    return new Response(SCRIPT, { status: 200, headers: entetes("text/javascript; charset=utf-8") });
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
  if (requete.method === "POST" && url.pathname === "/guide/lu") return noterGuide(requete, env);
  if (requete.method === "POST" && url.pathname === "/audit/paquet") return paquetAudit(requete, env);
  if (requete.method === "POST" && url.pathname === "/audit/produire") return produireAudit(requete, env, null);
  if (requete.method === "POST") {
    const produit = /^\/audit\/([a-z_]+)\/produire$/.exec(url.pathname);
    if (produit?.[1]) return produireAudit(requete, env, produit[1]);
    const depot = /^\/audit\/([a-z_]+)$/.exec(url.pathname);
    if (depot?.[1]) return deposerAudit(requete, env, depot[1]);
  }
  if (requete.method === "GET") {
    const audit = /^\/audit\/([a-z_]+)(?:\/(\d+))?(?:\/(apercu))?$/.exec(url.pathname);
    if (audit?.[1]) return servirAudit(requete, env, audit[1], audit[2] ? Number(audit[2]) : null, audit[3] === "apercu");
  }
  if (requete.method === "GET" && url.pathname === "/") return accueilOuConnexion(requete, env);
  if (requete.method === "POST" && url.pathname === "/connexion") return connecter(requete, env);
  if (requete.method === "POST" && url.pathname === "/sortie") return sortir(requete, env);
  if (requete.method === "POST" && url.pathname === "/dossiers") return creerDossier(requete, env);
  if (requete.method === "POST") {
    const courrier = /^\/dossiers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/courrier$/.exec(url.pathname);
    if (courrier?.[1]) return envoyerCourrierDossier(requete, env, courrier[1]);
  }
  if (requete.method === "POST") {
    const courriel = /^\/dossiers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/email$/.exec(url.pathname);
    if (courriel?.[1]) return poserEmail(requete, env, courriel[1]);
  }
  if (requete.method === "POST") {
    const produit = /^\/dossiers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([a-z]+)\/produire$/.exec(url.pathname);
    if (produit?.[1] && produit[2]) return produirePiece(requete, env, produit[1], produit[2]);
  }
  if (requete.method === "POST") {
    const piece = /^\/dossiers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([a-z]+)$/.exec(url.pathname);
    if (piece?.[1] && piece[2]) return deposerPiece(requete, env, piece[1], piece[2]);
  }
  if (requete.method === "POST") {
    const reprendre = /^\/organisme\/([a-z]+)\/reprendre$/.exec(url.pathname);
    if (reprendre?.[1]) return reprendreOrganisme(requete, env, reprendre[1]);
  }
  if (requete.method === "GET") {
    const organisme = cheminOrganisme(url.pathname);
    if (organisme) return servirOrganisme(requete, env, organisme.code, organisme.version, organisme.apercu);
  }
  if (requete.method === "GET") {
    const chemin = cheminDossier(url.pathname);
    if (chemin) {
      return chemin.piece
        ? telecharger(requete, env, chemin.id, chemin.piece, chemin.version, chemin.apercu, chemin.signe)
        : voirDossier(requete, env, chemin.id);
    }
  }
  return reponse(404, "Cette page n'existe pas.\n");
}

function cheminOrganisme(pathname: string): { code: string; version: number | null; apercu: boolean } | null {
  const trouve = /^\/organisme\/([a-z]+)(?:\/(\d+))?(?:\/(apercu))?$/.exec(pathname);
  if (!trouve?.[1] || !documentOrganisme(trouve[1])) return null;
  return { code: trouve[1], version: trouve[2] ? Number(trouve[2]) : null, apercu: trouve[3] === "apercu" };
}

async function servirOrganisme(
  requete: Request,
  env: Env,
  code: string,
  version: number | null,
  apercu: boolean,
): Promise<Response> {
  const secret = await exigerSecret(env);
  const session = await sessionOuverte(requete, env);
  if (!session) return formulaireConnexion(secret, null, session === undefined ? 401 : 200, session === undefined);
  if (!documentOrganisme(code) || !env.FICHIERS) return reponse(503, "Le stockage ne répond pas.\n");
  let versions = (await lireVersionsPubliees(env.DB)).filter((ligne) => ligne.code === code);
  if (versions.length === 0 && version === null) {
    const posee = await poserPublie(env, requete, code);
    if (posee) versions = (await lireVersionsPubliees(env.DB)).filter((ligne) => ligne.code === code);
  }
  const cible = version === null ? versions.at(-1) : versions.find((ligne) => ligne.version === version);
  if (!cible) return reponse(versions.length === 0 ? 503 : 404, versions.length === 0 ? "Ce document n'a pas pu être pris.\n" : "Ce document n'est pas là.\n");
  try {
    const objet = await env.FICHIERS.get(cible.r2_cle);
    if (!objet) return reponse(404, "Ce document n'est pas là.\n");
    return reponseOctets(
      new Uint8Array(await objet.arrayBuffer()),
      "application/pdf",
      `${code}-v${cible.version}.pdf`,
      apercu ? "inline" : "attachment",
    );
  } catch {
    return reponse(503, "Le stockage ne répond pas.\n");
  }
}

async function reprendreOrganisme(requete: Request, env: Env, code: string): Promise<Response> {
  const secret = await exigerSecret(env);
  const session = await sessionOuverte(requete, env);
  if (!session) return formulaireConnexion(secret, null, 401, true);
  if (!documentOrganisme(code)) return reponse(404, "Cette page n'existe pas.\n");
  const formulaire = await lireFormulaire(requete);
  const fiche = await lireOrganisme(env.DB);
  const dossiers = await listerDossiers(env.DB);
  if (!formulaire || !memesJetons(session.csrf, brut(formulaire.get("csrf")))) {
    return reponseHtml(403, await pageAvecGuide(env, fiche, dossiers, session.csrf, "La page a expiré. Recharge-la.", saisieVide()));
  }
  const posee = await poserPublie(env, requete, code);
  if (!posee) {
    return reponseHtml(503, await pageAvecGuide(env, fiche, dossiers, session.csrf, "Ce document n'a pas pu être pris.", saisieVide()));
  }
  return redirection("/");
}

async function poserPublie(env: Env, requete: Request, code: string): Promise<boolean> {
  if (!env.FICHIERS || !documentOrganisme(code)) return false;
  const octets = await chargerDocumentOrganisme(code);
  if (!octets) return false;
  const sha256 = await empreinteOctets(octets);
  const versions = (await lireVersionsPubliees(env.DB)).filter((ligne) => ligne.code === code);
  if (versions.at(-1)?.sha256 === sha256) return true;
  const cle = `organisme/${sha256}`;
  try {
    if (!(await env.FICHIERS.head(cle))) {
      await env.FICHIERS.put(cle, octets, { httpMetadata: { contentType: "application/pdf" } });
    }
    await ajouterVersionPubliee(env.DB, {
      id: crypto.randomUUID(),
      code,
      poseLe: iso(heure(env)),
      sha256,
      taille: octets.byteLength,
      ip: adresseIp(requete),
    });
    return true;
  } catch {
    const encore = (await lireVersionsPubliees(env.DB)).some((ligne) => ligne.code === code && ligne.sha256 === sha256);
    return encore;
  }
}

async function empreinteOctets(octets: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", octets.slice());
  return [...new Uint8Array(digest)].map((octet) => octet.toString(16).padStart(2, "0")).join("");
}

const CODES_FICHIER = new Set<string>(["convention", "programme", "devis", "attestation", "facture", ...MODELES.map(([code]) => code)]);

function cheminDossier(pathname: string): { id: string; piece: string | null; version: number | null; apercu: boolean; signe: boolean } | null {
  const trouve = /^\/dossiers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/([a-z]+)(?:\/(signe|\d+))?(?:\/(apercu))?)?$/.exec(
    pathname,
  );
  if (!trouve?.[1]) return null;
  if (trouve[2] && !CODES_FICHIER.has(trouve[2])) return null;
  return {
    id: trouve[1],
    piece: trouve[2] ?? null,
    version: trouve[3] && trouve[3] !== "signe" ? Number(trouve[3]) : null,
    apercu: trouve[4] === "apercu",
    signe: trouve[3] === "signe",
  };
}

async function voirDossier(requete: Request, env: Env, id: string): Promise<Response> {
  const secret = await exigerSecret(env);
  const session = await sessionOuverte(requete, env);
  if (!session) return formulaireConnexion(secret, null, session === undefined ? 401 : 200, session === undefined);
  const note = lireNote(requete);
  const html = await htmlDossier(env, requete, id, session.csrf, note.erreur, note.info);
  if (!html) return reponse(404, "Ce dossier n'existe pas.\n");
  return reponseHtml(200, html, note.cookie ? [note.cookie] : []);
}

async function produirePiece(requete: Request, env: Env, id: string, code: string): Promise<Response> {
  const secret = await exigerSecret(env);
  const session = await sessionOuverte(requete, env);
  if (!session) return formulaireConnexion(secret, null, 401, true);
  if (!pieceProduite(code) || !(await lireDossier(env.DB, id))) return reponse(404, "Cette page n'existe pas.\n");
  const formulaire = await lireFormulaire(requete);
  if (!formulaire || !memesJetons(session.csrf, brut(formulaire.get("csrf")))) {
    const html = await htmlDossier(env, requete, id, session.csrf, "La page a expiré. Recharge-la.");
    return reponseHtml(403, html ?? "Ce dossier n'existe pas.\n");
  }
  await produireModele(env.DB, env.FICHIERS, id, code, await lireOrganisme(env.DB), adresseIp(requete), agent(requete), iso(heure(env)));
  return redirection(`/dossiers/${id}`);
}

async function deposerPiece(requete: Request, env: Env, id: string, code: string): Promise<Response> {
  const secret = await exigerSecret(env);
  const session = await sessionOuverte(requete, env);
  if (!session) return formulaireConnexion(secret, null, 401, true);
  if (!depotConnu(code) || !(await lireDossier(env.DB, id))) return reponse(404, "Cette page n'existe pas.\n");
  const tailleMax = await lireTailleDepot(env.DB);
  const formulaire = await lireFormulaire(requete, tailleMax + 65_536);
  const refuser = async (statut: number, message: string) => {
    const html = await htmlDossier(env, requete, id, session.csrf, message);
    return reponseHtml(statut, html ?? "Ce dossier n'existe pas.\n");
  };
  if (!formulaire || !memesJetons(session.csrf, brut(formulaire.get("csrf")))) return refuser(403, "La page a expiré. Recharge-la.");
  const fichier = formulaire.get("fichier");
  if (!(fichier instanceof File) || fichier.size === 0) return refuser(400, "Le fichier manque.");
  if (fichier.size > tailleMax) return refuser(413, "Le fichier dépasse la taille admise.");
  const octets = new Uint8Array(await fichier.arrayBuffer());
  if (!pdfReconnu(octets)) return refuser(400, "Le fichier n'est pas un PDF.");
  if (!env.FICHIERS) return refuser(503, "Le stockage ne répond pas.");
  const sha256 = await empreinteOctets(octets);
  const deja = await fichierDejaLa(env, id, code, sha256);
  if (deja) return redirection(`/dossiers/${id}`);
  const cle = `scans/${sha256}`;
  try {
    if (!(await env.FICHIERS.head(cle))) {
      await env.FICHIERS.put(cle, octets, { httpMetadata: { contentType: "application/pdf" } });
    }
    const relu = code === "convention" ? await relireConvention(octets.slice(), (await lireOrganisme(env.DB)).email, id, iso(heure(env))) : null;
    const conserve = code === "convention" ? (await lireEtatPieces(env.DB, id)).convention?.corps : undefined;
    const texte = await texteLu(octets.slice());
    const signature =
      estSignature(texte, sha256, await textesVersions(env, id, code)) ||
      (await signatureEnPlace(env, id, code, sha256, octets.slice()));
    await deposerPieceDossier(env.DB, {
      dossierId: id,
      code,
      recuLe: iso(heure(env)),
      ip: adresseIp(requete),
      userAgent: agent(requete),
      sha256,
      taille: octets.byteLength,
      corps: corpsDepot(relu?.corps, conserve, signature),
      dossier: relu?.dossier,
    });
    if (code === "convention" && !relu) {
      const html = await htmlDossier(env, requete, id, session.csrf, "Ce PDF n'a pas de texte. La fiche n'a pas été relue.");
      return reponseHtml(200, html ?? "Ce dossier n'existe pas.\n");
    }
  } catch {
    const posee = await fichierDejaLa(env, id, code, sha256);
    if (!posee) return refuser(503, "Le fichier n'a pas pu être pris.");
  }
  return redirection(`/dossiers/${id}`);
}

async function relireConvention(
  octets: Uint8Array,
  email: string,
  id: string,
  creeLe: string,
): Promise<{ dossier: Parameters<typeof deposerPieceDossier>[1]["dossier"]; corps: string } | null> {
  try {
    const texte = await textePdf(octets);
    if (texte.trim().length < 40) return null;
    const lecture = lireConvention(texte, email);
    if (lecture.raisons.length > 0) return null;
    const analyse = analyserDossier(formulaireSaisie(lecture.saisie), id, creeLe);
    if (!analyse.ok) return null;
    const detail: Record<string, string> = {};
    if (lecture.numero) detail.numero = lecture.numero;
    if (lecture.devis) detail.devis = lecture.devis;
    return { dossier: analyse.dossier, corps: JSON.stringify(detail) };
  } catch {
    return null;
  }
}

async function htmlDossier(
  env: Env,
  requete: Request,
  id: string,
  csrf: string,
  erreur: string | null,
  info: string | null = null,
): Promise<string | null> {
  const organisme = await lireOrganisme(env.DB);
  await produirePieces(env.DB, env.FICHIERS, id, organisme, adresseIp(requete), agent(requete), iso(heure(env)));
  await promouvoirSignatures(env, id, adresseIp(requete), agent(requete), iso(heure(env)));
  const dossier = await lireDossier(env.DB, id);
  if (!dossier) return null;
  const etat = await lireEtatPieces(env.DB, id);
  const versions = await lireVersionsPieces(env.DB, id);
  const signes = (await lireSignesPieces(env.DB, id)).map((ligne) => ligne.code);
  const etatVerrous = await lireEtatVerrous(env.DB, id, jourParis(heure(env)));
  const presents = new Set<string>([...versions.map((ligne) => ligne.code), ...signes]);
  const base = {
    heuresElearning: dossier.heures_elearning,
    convocationAutorisee: etatVerrous ? envoiAutorise(etatVerrous, "envoyer_convocation") : false,
    attestationAutorisee: etatVerrous ? envoiAutorise(etatVerrous, "generer_attestation") : false,
    attestationTenue: etat.tenus.includes("attestation"),
    presents,
  };
  const moments = (["avant", "pendant", "apres"] as const).map((moment) => ({
    moment,
    titre: titreMoment(moment),
    lignes: catalogueCourrier({ moment, ...base }).map((ligne) => ({
      code: ligne.code,
      libelle: ligne.libelle,
      motif: ligne.motif || (ligne.presente ? "" : "Pas de fichier."),
      coche: ligne.presente && ligne.motif === "",
      versions: versions.filter((fichier) => fichier.code === ligne.code).map((fichier) => fichier.version),
      signe: signes.includes(ligne.code),
    })),
  }));
  return pageDossier(
    dossier,
    {
      convention: etat.convention !== null,
      programme: etat.programme,
      devis: etat.devis,
      numeroConvention: etat.convention ? numeroConvention(etat.convention.corps) : "",
      modeles: etat.modeles,
      tenus: etat.tenus,
      versions,
      signes,
      moments,
    },
    csrf,
    heure(env),
    erreur,
    info,
  );
}

async function telecharger(
  requete: Request,
  env: Env,
  id: string,
  piece: string,
  version: number | null,
  apercu: boolean,
  signe: boolean,
): Promise<Response> {
  const secret = await exigerSecret(env);
  const session = await sessionOuverte(requete, env);
  if (!session) return formulaireConnexion(secret, null, session === undefined ? 401 : 200, session === undefined);
  if (!env.FICHIERS) return reponse(503, "Le stockage ne répond pas.\n");
  const cible = signe ? await cleSigne(env, id, piece) : await cleTelechargement(env, id, piece, version);
  if (!cible) return reponse(404, "Cette pièce n'est pas là.\n");
  try {
    const objet = await env.FICHIERS.get(cible.cle);
    if (!objet) return reponse(404, "Cette pièce n'est pas là.\n");
    return reponseOctets(
      new Uint8Array(await objet.arrayBuffer()),
      "application/pdf",
      cible.nom,
      apercu ? "inline" : "attachment",
    );
  } catch {
    return reponse(503, "Le stockage ne répond pas.\n");
  }
}

async function fichierDejaLa(env: Env, id: string, code: string, sha256: string): Promise<boolean> {
  const versions = await lireVersionsPieces(env.DB, id);
  const signes = await lireSignesPieces(env.DB, id);
  return [...versions, ...signes].some((ligne) => ligne.code === code && ligne.sha256 === sha256);
}

function corpsDepot(corps: string | undefined, conserve: string | undefined, signature: boolean): string {
  const detail = { ...objetCorps(conserve), ...objetCorps(corps) };
  detail.role = signature ? "signe" : "version";
  return JSON.stringify(detail);
}

async function texteLu(octets: Uint8Array): Promise<string> {
  try {
    return await textePdf(octets);
  } catch {
    return "";
  }
}

async function signatureEnPlace(env: Env, id: string, code: string, empreinte: string, octets: Uint8Array): Promise<boolean> {
  if (!env.FICHIERS) return false;
  let depot;
  try {
    depot = await glyphesPdf(octets);
  } catch {
    return false;
  }
  const versions = (await lireVersionsPieces(env.DB, id)).filter((ligne) => ligne.code === code && ligne.sha256 !== empreinte);
  for (const version of versions) {
    try {
      const objet = await env.FICHIERS.get(version.r2_cle);
      if (!objet) continue;
      const origine = await glyphesPdf(new Uint8Array(await objet.arrayBuffer()));
      if (couvreDocument(origine, depot) && !couvreDocument(depot, origine)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function promouvoirSignatures(env: Env, id: string, ip: string, userAgent: string, recuLe: string): Promise<void> {
  if (!env.FICHIERS) return;
  const versions = await lireVersionsPieces(env.DB, id);
  const signes = await lireSignesPieces(env.DB, id);
  const codes = [...new Set(versions.map((ligne) => ligne.code))];
  for (const code of codes) {
    if (signes.some((ligne) => ligne.code === code)) continue;
    const fichiers = versions.filter((ligne) => ligne.code === code);
    if (fichiers.length < 2) continue;
    const deja = new Set(signes.filter((ligne) => ligne.code === code).map((ligne) => ligne.sha256));
    const glyphes = new Map<string, { pages: Awaited<ReturnType<typeof glyphesPdf>>; taille: number }>();
    for (const fichier of fichiers) {
      if (glyphes.has(fichier.sha256)) continue;
      try {
        const objet = await env.FICHIERS.get(fichier.r2_cle);
        if (!objet) continue;
        const octets = new Uint8Array(await objet.arrayBuffer());
        glyphes.set(fichier.sha256, { pages: await glyphesPdf(octets), taille: octets.byteLength });
      } catch {
        continue;
      }
    }
    for (const fichier of fichiers) {
      if (deja.has(fichier.sha256) || fichier.r2_cle !== `scans/${fichier.sha256}`) continue;
      const depot = glyphes.get(fichier.sha256);
      if (!depot) continue;
      const reconnu = fichiers.some((origine) => {
        if (origine.sha256 === fichier.sha256 || origine.version >= fichier.version) return false;
        const source = glyphes.get(origine.sha256);
        if (!source) return false;
        return couvreDocument(source.pages, depot.pages) && !couvreDocument(depot.pages, source.pages);
      });
      if (!reconnu) continue;
      await deposerPieceDossier(env.DB, {
        dossierId: id,
        code,
        recuLe,
        ip,
        userAgent,
        sha256: fichier.sha256,
        taille: depot.taille,
        corps: corpsDepot(undefined, undefined, true),
      });
      deja.add(fichier.sha256);
    }
  }
}

async function textesVersions(env: Env, id: string, code: string): Promise<{ texte: string; empreinte: string }[]> {
  if (!env.FICHIERS) return [];
  const lignes = (await lireVersionsPieces(env.DB, id)).filter((ligne) => ligne.code === code);
  const textes: { texte: string; empreinte: string }[] = [];
  for (const ligne of lignes) {
    try {
      const objet = await env.FICHIERS.get(ligne.r2_cle);
      if (!objet) continue;
      textes.push({ texte: await textePdf(new Uint8Array(await objet.arrayBuffer())), empreinte: ligne.sha256 });
    } catch {
      textes.push({ texte: "", empreinte: ligne.sha256 });
    }
  }
  return textes;
}

function objetCorps(corps?: string): Record<string, unknown> {
  if (!corps) return {};
  try {
    const lu = JSON.parse(corps) as Record<string, unknown>;
    if (lu && typeof lu === "object" && !Array.isArray(lu)) return lu;
  } catch {
    return {};
  }
  return {};
}

const TAILLE_COURRIER = 15_000_000;

async function poserEmail(requete: Request, env: Env, id: string): Promise<Response> {
  const secret = await exigerSecret(env);
  const session = await sessionOuverte(requete, env);
  if (!session) return formulaireConnexion(secret, null, 401, true);
  if (!(await lireDossier(env.DB, id))) return reponse(404, "Ce dossier n'existe pas.\n");
  const formulaire = await lireFormulaire(requete);
  if (!formulaire || !memesJetons(session.csrf, brut(formulaire.get("csrf")))) {
    const html = await htmlDossier(env, requete, id, session.csrf, "La page a expiré. Recharge-la.");
    return reponseHtml(403, html ?? "Ce dossier n'existe pas.\n");
  }
  const email = brut(formulaire.get("email")).trim();
  if (!emailAdmissible(email)) {
    const html = await htmlDossier(env, requete, id, session.csrf, "L'e-mail n'est pas valide.");
    return reponseHtml(400, html ?? "Ce dossier n'existe pas.\n");
  }
  await poserEmailStagiaire(env.DB, id, email, iso(heure(env)), adresseIp(requete));
  return redirection(`/dossiers/${id}`);
}

async function envoyerCourrierDossier(requete: Request, env: Env, id: string): Promise<Response> {
  const secret = await exigerSecret(env);
  const session = await sessionOuverte(requete, env);
  if (!session) return formulaireConnexion(secret, null, 401, true);
  const dossier = await lireDossier(env.DB, id);
  if (!dossier) return reponse(404, "Ce dossier n'existe pas.\n");
  const formulaire = await lireFormulaire(requete);
  const page = (erreur: string | null, info: string | null = null) => {
    const message = erreur ?? info ?? "";
    return redirection(`/dossiers/${id}`, [cookieHote(NOM_INFO, encodeURIComponent(`${erreur ? "e" : "i"}:${message}`), 120)]);
  };
  if (!formulaire || !memesJetons(session.csrf, brut(formulaire.get("csrf")))) {
    const html = await htmlDossier(env, requete, id, session.csrf, "La page a expiré. Recharge-la.");
    return reponseHtml(403, html ?? "Ce dossier n'existe pas.\n");
  }
  const momentDemande = brut(formulaire.get("moment"));
  if (!momentConnu(momentDemande)) return reponse(404, "Cette page n'existe pas.\n");
  const moment: Moment = momentDemande;
  const destinataire = dossier.stagiaire_email.trim();
  if (!emailAdmissible(destinataire)) return page("Ce dossier n'a pas d'e-mail.");
  if (!env.FICHIERS) return page("Le stockage ne répond pas.");
  const organisme = await lireOrganisme(env.DB);
  const etatVerrous = await lireEtatVerrous(env.DB, id, jourParis(heure(env)));
  if (!etatVerrous) return page("Le dossier n'a pas pu être lu.");
  const versions = await lireVersionsPieces(env.DB, id);
  const signes = await lireSignesPieces(env.DB, id);
  const presents = new Set<string>([...versions, ...signes].map((ligne) => ligne.code));
  const choixActif = brut(formulaire.get("choix")) === "1";
  const coches = new Set(formulaire.getAll("inclure").flatMap((valeur) => (typeof valeur === "string" ? [valeur] : [])));
  const selection = inclureSiCochee(
    selectionCourrier({
      moment,
      heuresElearning: dossier.heures_elearning,
      convocationAutorisee: envoiAutorise(etatVerrous, "envoyer_convocation"),
      attestationAutorisee: envoiAutorise(etatVerrous, "generer_attestation"),
      attestationTenue: (await lireEtatPieces(env.DB, id)).tenus.includes("attestation"),
      presents,
    }),
    "convocation",
    choixActif && coches.has("convocation"),
    presents.has("convocation"),
  );
  const attente = choixActif ? attenteCochee(selection.attente, coches) : [...selection.attente];
  const joints: { code: string; libelle: string; nom: string; octets: Uint8Array }[] = [];
  const laissees: string[] = [];
  let total = 0;
  for (const piece of selection.joints) {
    if (choixActif && !coches.has(piece.code)) {
      laissees.push(piece.libelle);
      continue;
    }
    const cle = cleDe(piece.code, brut(formulaire.get(piece.code)), signes, versions);
    const objet = cle ? await env.FICHIERS.get(cle) : null;
    if (!objet) {
      attente.push(piece.libelle);
      continue;
    }
    const octets = new Uint8Array(await objet.arrayBuffer());
    if (octets.byteLength === 0 || total + octets.byteLength > TAILLE_COURRIER) {
      attente.push(`${piece.libelle}, trop volumineux`);
      continue;
    }
    total += octets.byteLength;
    const cible = retenirCible(
      brut(formulaire.get(piece.code)),
      versions.filter((ligne) => ligne.code === piece.code).map((ligne) => ligne.version),
      signes.some((ligne) => ligne.code === piece.code),
    );
    joints.push({ code: piece.code, libelle: etiquetteEnvoi(piece.libelle, cible), nom: piece.fichier, octets });
  }
  const libelles = joints.map((piece) => piece.libelle);
  if (joints.length === 0) return page(null, messagePage(destinataire, libelles, attente, laissees));
  const expediteur = organisme.email.trim();
  if (!emailAdmissible(expediteur)) return page("L'adresse d'envoi manque.");
  const lettre = lettreCourrier({
    nom: dossier.stagiaire_nom,
    intitule: dossier.intitule,
    moment,
    joints: libelles,
    attente,
  });
  const copieDemandee = brut(formulaire.get("copie")) === "1";
  const copie =
    copieDemandee && emailAdmissible(expediteur) && expediteur.toLowerCase() !== destinataire.toLowerCase()
      ? { nom: organisme.nom, email: expediteur }
      : null;
  const courrier: CourrierSortant = {
    expediteur: { nom: organisme.nom.trim() || "deter-mi.net", email: expediteur },
    destinataire: { nom: dossier.stagiaire_nom, email: destinataire },
    copie,
    sujet: lettre.sujet,
    texte: lettre.texte,
    pieces: joints.map((piece) => ({ nom: piece.nom, octets: piece.octets })),
  };
  const transport = env.envoyerCourrier ?? (env.BREVO_API_KEY ? (message: CourrierSortant) => envoyerBrevo(env.BREVO_API_KEY ?? "", message) : null);
  if (!transport) return page("La clé d'envoi n'est pas posée.");
  const parti = await transport(courrier);
  if (!parti) return page("L'envoi n'est pas parti.");
  await noterEnvoi(env.DB, {
    dossierId: id,
    moment,
    codes: joints.map((piece) => piece.code),
    recuLe: iso(heure(env)),
    ip: adresseIp(requete),
  });
  return page(null, messagePage(destinataire, libelles, attente, laissees));
}

function envoiAutorise(etat: Etat, action: "envoyer_convocation" | "generer_attestation"): boolean {
  return juger(etat, action).verrous.every((verrou) => verrou.code === "organisme_incomplet" || !verrou.effectif);
}

function cleDe(
  code: string,
  choix: string,
  signes: readonly { code: string; r2_cle: string }[],
  versions: readonly { code: string; version: number; r2_cle: string }[],
): string | null {
  const liste = versions.filter((ligne) => ligne.code === code);
  const cible = retenirCible(
    choix,
    liste.map((ligne) => ligne.version),
    signes.some((ligne) => ligne.code === code),
  );
  if (cible === "signe") return signes.find((ligne) => ligne.code === code)?.r2_cle ?? null;
  if (typeof cible === "number") return liste.find((ligne) => ligne.version === cible)?.r2_cle ?? null;
  return null;
}

function lireNote(requete: Request): { erreur: string | null; info: string | null; cookie: string | null } {
  const valeur = lireCookie(requete.headers.get("Cookie"), NOM_INFO);
  if (!valeur) return { erreur: null, info: null, cookie: null };
  let texte = "";
  try {
    texte = decodeURIComponent(valeur);
  } catch {
    texte = "";
  }
  const erreur = texte.startsWith("e:") ? texte.slice(2) : null;
  const info = texte.startsWith("i:") ? texte.slice(2) : null;
  return { erreur, info, cookie: effacerCookie(NOM_INFO) };
}

function jourParis(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

async function cleSigne(env: Env, id: string, piece: string): Promise<{ cle: string; nom: string } | null> {
  const ligne = (await lireSignesPieces(env.DB, id)).find((candidat) => candidat.code === piece);
  if (!ligne) return null;
  return { cle: ligne.r2_cle, nom: `${piece}-signe.pdf` };
}

async function cleTelechargement(
  env: Env,
  id: string,
  piece: string,
  version: number | null,
): Promise<{ cle: string; nom: string } | null> {
  const versions = (await lireVersionsPieces(env.DB, id)).filter((ligne) => ligne.code === piece);
  const cible = version === null ? versions.at(-1) : versions.find((ligne) => ligne.version === version);
  if (!cible) return null;
  if (piece === "devis") {
    const etat = await lireEtatPieces(env.DB, id);
    const numero = etat.devis ? numeroDevis(etat.devis.annee, etat.devis.numero) : "devis";
    return { cle: cible.r2_cle, nom: `devis-${numero}-v${cible.version}.pdf` };
  }
  return { cle: cible.r2_cle, nom: `${piece}-v${cible.version}.pdf` };
}

async function accueilOuConnexion(requete: Request, env: Env): Promise<Response> {
  const secret = await exigerSecret(env);
  const session = await sessionOuverte(requete, env);
  if (!session) return formulaireConnexion(secret, null, 200, session === undefined);
  const fiche = await lireOrganisme(env.DB);
  const dossiers = await listerDossiers(env.DB);
  return reponseHtml(200, await pageAvecGuide(env, fiche, dossiers, session.csrf, null, saisieVide()));
}

async function pageAvecGuide(
  env: Env,
  fiche: Fiche,
  dossiers: readonly DossierLigne[],
  csrf: string,
  erreur: string | null,
  saisie: SaisieDossier,
  reprise: Reprise | null = null,
): Promise<string> {
  const recaps = [];
  for (const dossier of dossiers) {
    if (dossier.statut === "clos") continue;
    const complet = await lireDossier(env.DB, dossier.id);
    const etat = await lireEtatPieces(env.DB, dossier.id);
    const signes = (await lireSignesPieces(env.DB, dossier.id)).map((ligne) => ligne.code);
    const versions = await lireVersionsPieces(env.DB, dossier.id);
    recaps.push({
      nom: dossier.stagiaire_nom,
      lignes: lierDossier(
        dossier.id,
        lignesBilan({ tenus: etat.tenus, signes, programme: etat.programme }, complet?.heures_elearning ?? 0),
        signes,
        versions,
      ),
    });
  }
  return pageAccueil(fiche, dossiers, csrf, erreur, saisie, reprise, await assurerGuide(env), await lireVersionsPubliees(env.DB), recaps);
}

async function assurerGuide(env: Env) {
  const maintenant = heure(env);
  const quand = iso(maintenant);
  let norme = await lireNorme(env.DB);
  if (guidePerime(norme?.verifie_le ?? null, maintenant, norme?.etat ?? null)) {
    const releve = await telechargerGuide();
    const hash = releve.ok ? releve.hash : (norme?.hash ?? null);
    await ecrireNorme(env.DB, {
      url: releve.ok ? releve.url : norme?.url || PAGE_GUIDE,
      etat: releve.ok ? (hash === (norme?.hash_lu ?? null) ? "inchange" : "change") : "echec",
      hash,
      verifieLe: quand,
      erreur: releve.ok ? "" : releve.erreur,
      releve: releve.ok ? serialiserReleve(releve.version, releve.indicateurs) : "",
    });
    norme = await lireNorme(env.DB);
  }
  const versions = await lireVersionsOrganisme(env.DB);
  return presenterGuide(
    norme
      ? {
          hash: norme.hash,
          hashLu: norme.hash_lu,
          verifieLe: norme.verifie_le,
          erreur: norme.erreur,
          releve: norme.releve,
        }
      : null,
    await lirePreuves(env.DB),
    versions.map((version) => ({ code: version.code, version: version.version, poseLe: version.pose_le })),
    maintenant,
  );
}

async function deposerAudit(requete: Request, env: Env, code: string): Promise<Response> {
  const secret = await exigerSecret(env);
  const session = await sessionOuverte(requete, env);
  if (!session) return formulaireConnexion(secret, null, 401, true);
  if (!noteParCode(code)) return reponse(404, "Cette page n'existe pas.\n");
  const tailleMax = await lireTailleDepot(env.DB);
  const formulaire = await lireFormulaire(requete, tailleMax + 65_536);
  const fiche = await lireOrganisme(env.DB);
  const dossiers = await listerDossiers(env.DB);
  if (!formulaire || !memesJetons(session.csrf, brut(formulaire.get("csrf")))) {
    return reponseHtml(403, await pageAvecGuide(env, fiche, dossiers, session.csrf, "La page a expiré. Recharge-la.", saisieVide()));
  }
  const fichier = formulaire.get("fichier");
  if (!(fichier instanceof File) || fichier.size === 0) {
    return reponseHtml(400, await pageAvecGuide(env, fiche, dossiers, session.csrf, "Le fichier manque.", saisieVide()));
  }
  if (fichier.size > tailleMax) {
    return reponseHtml(413, await pageAvecGuide(env, fiche, dossiers, session.csrf, "Le fichier dépasse la taille admise.", saisieVide()));
  }
  const octets = new Uint8Array(await fichier.arrayBuffer());
  if (!pdfReconnu(octets)) {
    return reponseHtml(400, await pageAvecGuide(env, fiche, dossiers, session.csrf, "Le fichier n'est pas un PDF.", saisieVide()));
  }
  return rangerAudit(env, requete, session.csrf, fiche, dossiers, code, octets, "depot", true);
}

async function produireAudit(requete: Request, env: Env, code: string | null): Promise<Response> {
  const secret = await exigerSecret(env);
  const session = await sessionOuverte(requete, env);
  if (!session) return formulaireConnexion(secret, null, 401, true);
  if (code !== null && !noteParCode(code)) return reponse(404, "Cette page n'existe pas.\n");
  const formulaire = await lireFormulaire(requete);
  const fiche = await lireOrganisme(env.DB);
  const dossiers = await listerDossiers(env.DB);
  if (!formulaire || !memesJetons(session.csrf, brut(formulaire.get("csrf")))) {
    return reponseHtml(403, await pageAvecGuide(env, fiche, dossiers, session.csrf, "La page a expiré. Recharge-la.", saisieVide()));
  }
  const vue = await assurerGuide(env);
  const jour = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "long" }).format(heure(env));
  const matiere = await lireMatiere(env.DB);
  const codes = code === null ? NOTES.map((note) => note.code) : [code];
  const ordre = [...codes.filter((un) => un !== "auto_evaluation"), ...codes.filter((un) => un === "auto_evaluation")];
  let lignes = vue.lignes;
  for (const un of ordre) {
    if (un === "auto_evaluation") {
      const preuves = await lirePreuves(env.DB);
      const dates = new Map(preuves.dates);
      dates.set("auto_evaluation", heure(env).toISOString());
      lignes = conformite(
        vue.lignes.map((ligne) => ({ numero: ligne.numero, titre: ligne.titre })),
        { ...preuves, dates },
        heure(env),
      );
    }
    const produit = texteExigence(un, {
      nom: fiche.nom,
      siret: fiche.siret,
      nda: fiche.nda,
      adresse: fiche.adresse,
      codePostal: fiche.code_postal,
      ville: fiche.ville,
      telephone: fiche.telephone,
      email: fiche.email,
      dossiers: dossiers.map((dossier) => ({
        nom: dossier.stagiaire_nom,
        intitule: dossier.intitule,
        debut: dossier.date_debut,
        fin: dossier.date_fin,
        statut: dossier.statut,
        heures: dossier.heures_total,
        modalite: dossier.modalite,
        handicap: dossier.handicap,
      })),
      lignes,
      versionGuide: vue.version,
      risques: matiere.risques,
      reclamations: matiere.reclamations,
      mesures: matiere.mesures,
      jour,
    });
    if (!produit) {
      if (code !== null) {
        return reponseHtml(400, await pageAvecGuide(env, fiche, dossiers, session.csrf, "Le guide n'est pas là.", saisieVide()));
      }
      continue;
    }
    const erreur = await poserVersion(env, requete, session.csrf, fiche, dossiers, un, htmlVersPdf(normaliserHtml(produit.texte)), "produit", produit.tient);
    if (erreur) return erreur;
  }
  return redirection("/#audit");
}

async function rangerAudit(
  env: Env,
  requete: Request,
  csrf: string,
  fiche: Fiche,
  dossiers: readonly DossierLigne[],
  code: string,
  octets: Uint8Array,
  origine: "depot" | "produit",
  tient: boolean,
): Promise<Response> {
  const erreur = await poserVersion(env, requete, csrf, fiche, dossiers, code, octets, origine, tient);
  if (erreur) return erreur;
  return redirection("/#audit");
}

async function poserVersion(
  env: Env,
  requete: Request,
  csrf: string,
  fiche: Fiche,
  dossiers: readonly DossierLigne[],
  code: string,
  octets: Uint8Array,
  origine: "depot" | "produit",
  tient: boolean,
): Promise<Response | null> {
  if (!env.FICHIERS) return reponse(503, "Le stockage ne répond pas.\n");
  const sha256 = await empreinteFichier(octets.slice());
  const versions = await lireVersionsOrganisme(env.DB);
  const courante = versions.filter((version) => version.code === code).at(-1);
  if (courante?.sha256 === sha256) return null;
  const pose = await poserFichier(env.FICHIERS, `audit/${sha256}`, octets);
  if (pose === "erreur") {
    return reponseHtml(503, await pageAvecGuide(env, fiche, dossiers, csrf, "Le stockage ne répond pas.", saisieVide()));
  }
  try {
    await ajouterVersionOrganisme(env.DB, {
      id: crypto.randomUUID(),
      code,
      poseLe: iso(heure(env)),
      origine,
      sha256,
      taille: octets.byteLength,
      ip: adresseIp(requete),
      tient,
    });
  } catch {
    return reponseHtml(400, await pageAvecGuide(env, fiche, dossiers, csrf, "La version n'a pas été enregistrée.", saisieVide()));
  }
  return null;
}

async function paquetAudit(requete: Request, env: Env): Promise<Response> {
  const secret = await exigerSecret(env);
  const session = await sessionOuverte(requete, env);
  if (!session) return formulaireConnexion(secret, null, 401, true);
  const formulaire = await lireFormulaire(requete);
  if (!formulaire || !memesJetons(session.csrf, brut(formulaire.get("csrf")))) return reponse(403, "La page a expiré. Recharge-la.\n");
  const choix = formulaire.getAll("choix").map((valeur) => brut(valeur)).filter(Boolean).slice(0, 40);
  const fichiers: { nom: string; octets: Uint8Array }[] = [];
  let total = 0;
  const noms = new Set<string>();
  for (const valeur of choix) {
    const fichier = await fichierPaquet(env, valeur);
    if (!fichier) continue;
    if (total + fichier.octets.byteLength > 40_000_000) return reponse(413, "Le paquet est trop lourd.\n");
    total += fichier.octets.byteLength;
    let nom = fichier.nom;
    let rang = 2;
    while (noms.has(nom)) {
      nom = fichier.nom.replace(/(\.[^.]+)?$/, `-${rang}$1`);
      rang += 1;
    }
    noms.add(nom);
    fichiers.push({ nom, octets: fichier.octets });
  }
  if (fichiers.length === 0) return reponse(400, "Rien à télécharger.\n");
  return reponseOctets(archiveZip(fichiers), "application/zip", "audit.zip");
}

async function fichierPaquet(env: Env, choix: string): Promise<{ nom: string; octets: Uint8Array } | null> {
  if (!env.FICHIERS) return null;
  const organisme = /^org:([a-z]+)$/.exec(choix);
  if (organisme?.[1] && documentOrganisme(organisme[1])) {
    const versions = (await lireVersionsPubliees(env.DB)).filter((ligne) => ligne.code === organisme[1]);
    const cible = versions.at(-1);
    if (!cible) return null;
    return lirePaquet(env, cible.r2_cle, `${documentOrganisme(organisme[1])?.libelle ?? organisme[1]}.pdf`);
  }
  const note = /^note:([a-z_]+)$/.exec(choix);
  if (note?.[1] && noteParCode(note[1])) {
    const versions = (await lireVersionsOrganisme(env.DB)).filter((ligne) => ligne.code === note[1]);
    const cible = versions.at(-1);
    if (!cible) return null;
    return lirePaquet(env, cible.r2_cle, `${noteParCode(note[1])?.libelle ?? note[1]}.pdf`);
  }
  const dossier = /^dos:([0-9a-f-]{36}):([a-z]+)(?::(signe))?$/.exec(choix);
  if (!dossier?.[1] || !dossier[2]) return null;
  const cible = dossier[3] ? await cleSigne(env, dossier[1], dossier[2]) : await cleTelechargement(env, dossier[1], dossier[2], null);
  if (!cible) return null;
  const fiche = await lireDossier(env.DB, dossier[1]);
  const prefixe = fiche?.stagiaire_nom ? `${fiche.stagiaire_nom} - ` : "";
  return lirePaquet(env, cible.cle, `${prefixe}${cible.nom}`);
}

async function lirePaquet(env: Env, cle: string, nom: string): Promise<{ nom: string; octets: Uint8Array } | null> {
  if (!env.FICHIERS) return null;
  try {
    const objet = await env.FICHIERS.get(cle);
    if (!objet) return null;
    return { nom: nom.replace(/[\\/:*?"<>|]/g, "-").slice(0, 140), octets: new Uint8Array(await objet.arrayBuffer()) };
  } catch {
    return null;
  }
}

async function servirAudit(
  requete: Request,
  env: Env,
  code: string,
  version: number | null,
  apercu: boolean,
): Promise<Response> {
  const secret = await exigerSecret(env);
  const session = await sessionOuverte(requete, env);
  if (!session) return formulaireConnexion(secret, null, session === undefined ? 401 : 200, session === undefined);
  if (!noteParCode(code) || !env.FICHIERS) return reponse(noteParCode(code) ? 503 : 404, noteParCode(code) ? "Le stockage ne répond pas.\n" : "Cette page n'existe pas.\n");
  const versions = (await lireVersionsOrganisme(env.DB)).filter((ligne) => ligne.code === code);
  const cible = version === null ? versions.at(-1) : versions.find((ligne) => ligne.version === version);
  if (!cible) return reponse(404, "Ce document n'est pas là.\n");
  try {
    const objet = await env.FICHIERS.get(cible.r2_cle);
    if (!objet) return reponse(404, "Ce document n'est pas là.\n");
    return reponseOctets(
      new Uint8Array(await objet.arrayBuffer()),
      "application/pdf",
      `${code}-v${cible.version}.pdf`,
      apercu ? "inline" : "attachment",
    );
  } catch {
    return reponse(503, "Le stockage ne répond pas.\n");
  }
}

async function poserFichier(
  fichiers: Fichiers,
  cle: string,
  octets: Uint8Array,
): Promise<"pose" | "present" | "erreur"> {
  try {
    if (await fichiers.head(cle)) return "present";
    await fichiers.put(cle, octets, { httpMetadata: { contentType: "application/pdf" } });
    return "pose";
  } catch {
    return "erreur";
  }
}

async function noterGuide(requete: Request, env: Env): Promise<Response> {
  const secret = await exigerSecret(env);
  const session = await sessionOuverte(requete, env);
  if (!session) return formulaireConnexion(secret, null, 401, true);
  return enregistrerTexte(requete, env, session.csrf, "note", async (texte) => {
    const ok = await marquerGuideLu(env.DB, { note: texte, quand: iso(heure(env)), ip: adresseIp(requete) });
    return ok;
  });
}

async function enregistrerTexte(
  requete: Request,
  env: Env,
  csrf: string,
  champ: string,
  ecrire: (texte: string) => Promise<boolean>,
): Promise<Response> {
  const formulaire = await lireFormulaire(requete);
  const fiche = await lireOrganisme(env.DB);
  const dossiers = await listerDossiers(env.DB);
  if (!formulaire || !memesJetons(csrf, brut(formulaire.get("csrf")))) {
    return reponseHtml(403, await pageAvecGuide(env, fiche, dossiers, csrf, "La page a expiré. Recharge-la.", saisieVide()));
  }
  const texte = brut(formulaire.get(champ)).trim();
  const longueur = [...texte].length;
  if (longueur === 0) {
    return reponseHtml(400, await pageAvecGuide(env, fiche, dossiers, csrf, "La note est vide.", saisieVide()));
  }
  if (longueur > 2000) {
    return reponseHtml(400, await pageAvecGuide(env, fiche, dossiers, csrf, "La note est trop longue.", saisieVide()));
  }
  if (!(await ecrire(texte))) {
    return reponseHtml(400, await pageAvecGuide(env, fiche, dossiers, csrf, "Le guide n'est pas là.", saisieVide()));
  }
  return redirection("/#audit");
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
    return reponseHtml(403, await pageAvecGuide(env, fiche, dossiers, session.csrf, "La page a expiré. Recharge-la.", saisieVide()));
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
    return reponseHtml(413, await pageAvecGuide(env, fiche, dossiers, session.csrf, "La convention dépasse la taille admise.", saisieVide()));
  }
  const formulaire = await lireFormulaire(requete, tailleMax + 65_536);
  if (!formulaire) return reponse(400, "Le formulaire est illisible.\n");
  if (!memesJetons(session.csrf, brut(formulaire.get("csrf")))) {
    return reponseHtml(403, await pageAvecGuide(env, fiche, dossiers, session.csrf, "La page a expiré. Recharge-la.", saisieVide()));
  }

  const fichier = formulaire.get("convention");
  if (fichier instanceof File && fichier.size > 0) {
    return ouvrirDepuisFichier(fichier, fiche, dossiers, session.csrf, env, requete, tailleMax);
  }

  const sha256 = brut(formulaire.get("sha256"));
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    return reponseHtml(400, await pageAvecGuide(env, fiche, dossiers, session.csrf, "La convention manque.", saisieVide()));
  }
  const analyse = analyserDossier(formulaire, crypto.randomUUID(), iso(heure(env)));
  if (!analyse.ok) {
    return reponseHtml(
      400,
      await pageAvecGuide(env, fiche, dossiers, session.csrf, analyse.raison, analyse.saisie, {
        sha256,
        numero: brut(formulaire.get("numero")).slice(0, 80),
        devis: brut(formulaire.get("devis")).slice(0, 80),
      }),
    );
  }
  const pose = await deposer(env.FICHIERS, sha256, null);
  if (pose === "erreur" || pose === "absent" && !env.FICHIERS) {
    return reponseHtml(503, await pageAvecGuide(env, fiche, dossiers, session.csrf, "Le stockage ne répond pas.", saisieVide()));
  }
  if (pose !== "present") {
    return reponseHtml(
      400,
      await pageAvecGuide(env, fiche, dossiers, session.csrf, "La convention n'est plus là. Dépose-la à nouveau.", saisieVide()),
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
    return reponseHtml(413, await pageAvecGuide(env, fiche, dossiers, csrf, "La convention dépasse la taille admise.", saisieVide()));
  }
  const octets = new Uint8Array(await fichier.arrayBuffer());
  if (!pdfReconnu(octets)) {
    return reponseHtml(400, await pageAvecGuide(env, fiche, dossiers, csrf, "Le fichier n'est pas un PDF.", saisieVide()));
  }
  const sha256 = await empreinteFichier(octets.slice());
  let lecture: ReturnType<typeof lireConvention>;
  try {
    lecture = lireConvention(await textePdf(octets.slice()), fiche.email);
  } catch {
    return reponseHtml(400, await pageAvecGuide(env, fiche, dossiers, csrf, "Cette convention n'a pas pu être lue.", saisieVide()));
  }
  if (!lecture.saisie.stagiaire_nom && !lecture.saisie.intitule && !lecture.saisie.entreprise) {
    return reponseHtml(400, await pageAvecGuide(env, fiche, dossiers, csrf, "Cette convention n'a pas pu être lue.", saisieVide()));
  }
  const pose = await deposer(env.FICHIERS, sha256, octets.slice());
  if (pose === "absent" || pose === "erreur") {
    return reponseHtml(503, await pageAvecGuide(env, fiche, dossiers, csrf, "Le stockage ne répond pas.", saisieVide()));
  }
  const reprise: Reprise = { sha256, numero: lecture.numero, devis: lecture.devis };
  if (lecture.raisons.length > 0) {
    return reponseHtml(400, await pageAvecGuide(env, fiche, dossiers, csrf, lecture.raisons.join(" "), lecture.saisie, reprise));
  }
  const analyse = analyserDossier(formulaireSaisie(lecture.saisie), crypto.randomUUID(), iso(heure(env)));
  if (!analyse.ok) {
    return reponseHtml(400, await pageAvecGuide(env, fiche, dossiers, csrf, analyse.raison, lecture.saisie, reprise));
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
      await pageAvecGuide(env, fiche, dossiers, csrf, "Le dossier n'a pas été enregistré.", saisie, {
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
