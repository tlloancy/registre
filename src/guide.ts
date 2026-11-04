import { textePremieresPages } from "./pdf.ts";

export const PAGE_GUIDE =
  "https://travail-emploi.gouv.fr/referentiel-national-qualite-guide-de-lecture-qualiopi";

const FICHIER_GUIDE =
  "https://travail-emploi.gouv.fr/sites/travail-emploi/files/2026-10/Guide%20lecture%20Qualiopi_novembre2026.pdf";

const HOTE = "travail-emploi.gouv.fr";
const PAGES_LUES = 10;
const TAILLE_MAX = 20_000_000;
const INDICATEURS_MIN = 22;

const ENTETES = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/pdf;q=0.9,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9",
};

export type IndicateurGuide = { numero: number; titre: string };

export type NoteOrganisme = {
  code: string;
  libelle: string;
  jours: number | null;
};

export const NOTES = [
  { code: "accessibilite", libelle: "Accessibilité annoncée au public", jours: null },
  { code: "resultats", libelle: "Indicateurs de résultats", jours: null },
  { code: "engagement", libelle: "Engagement et prévention des violences", jours: null },
  { code: "moyens", libelle: "Moyens et environnement", jours: null },
  { code: "intervenants", libelle: "Intervenants", jours: null },
  { code: "competences", libelle: "Compétences des intervenants", jours: null },
  { code: "maintien", libelle: "Maintien des compétences", jours: null },
  { code: "veille_legale", libelle: "Veille légale et réglementaire", jours: 90 },
  { code: "veille_metiers", libelle: "Veille métiers et emplois", jours: 90 },
  { code: "veille_pedagogique", libelle: "Veille pédagogique et technologique", jours: 90 },
  { code: "handicap", libelle: "Référent handicap et réseau", jours: null },
  { code: "appreciations", libelle: "Appréciations", jours: null },
  { code: "reclamations", libelle: "Traitement des réclamations", jours: 365 },
  { code: "risques", libelle: "Analyse des risques", jours: 365 },
  { code: "auto_evaluation", libelle: "Auto-évaluation", jours: null },
] as const satisfies readonly NoteOrganisme[];

export type CodeNote = (typeof NOTES)[number]["code"];

export function noteParCode(code: string): NoteOrganisme | null {
  return NOTES.find((note) => note.code === code) ?? null;
}

export type Preuves = {
  ouverts: number;
  sansProgramme: number;
  sansAnalyse: number;
  sansPositionnement: number;
  sansConvocation: number;
  sansMiseEnOeuvre: number;
  sansEvaluation: number;
  sansSuivi: number;
  traces: ReadonlyMap<string, string>;
};

export type LigneConformite = {
  numero: number;
  titre: string;
  statut: "tenu" | "pas_tenu" | "hors";
  detail: string;
};

export type ReleveGuide = {
  ok: true;
  url: string;
  hash: string;
  version: string;
  indicateurs: IndicateurGuide[];
};

export type EchecGuide = { ok: false; erreur: string };

export function guidePerime(verifieLe: string | null, maintenant: Date, etat: string | null): boolean {
  if (!verifieLe) return true;
  const instant = Date.parse(verifieLe);
  if (Number.isNaN(instant)) return true;
  if (jourParis(new Date(instant)) !== jourParis(maintenant)) return true;
  if (etat === "echec") return maintenant.getTime() - instant >= 15 * 60 * 1000;
  return false;
}

export function lienDepuisPage(html: string, page: string): string | null {
  if (/bobcmn|Request Rejected/i.test(html)) return null;
  const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((trouve) =>
    decode(trouve[1] ?? ""),
  );
  const candidats = hrefs
    .map((href) => urlPdf(href, page))
    .filter((href): href is string => href !== null && /guide|qualiopi|lecture/i.test(href));
  return candidats.at(-1) ?? null;
}

export function versionDuGuide(texte: string): string {
  const trouve = texte.match(/V\.\s*\d+(?:\.\d+)?\s*[–—-]\s*[A-Za-zÀ-ÿ]+\s+\d{4}/);
  return trouve?.[0]?.replace(/\s+/g, " ").trim() ?? "";
}

export function indicateursDuGuide(texte: string): IndicateurGuide[] {
  const plat = zoneSommaire(texte).replace(/\s+/g, " ");
  const vus = new Map<number, string>();
  const motif =
    /(\d{1,2})\.\s+((?:Le |Lorsque |Pour ).*?)(?=\s+\d{1,2}\.\s+(?:Le |Lorsque |Pour )|\s+Crit[eè]re\s+\d|\s*$)/gi;
  for (const trouve of plat.matchAll(motif)) {
    const numero = Number(trouve[1]);
    const titre = (trouve[2] ?? "").replace(/\s+/g, " ").trim();
    if (!Number.isInteger(numero) || numero < 1 || numero > 60 || titre.length < 12 || vus.has(numero)) continue;
    vus.set(numero, [...titre].slice(0, 500).join(""));
  }
  return [...vus.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([numero, titre]) => ({ numero, titre }));
}

export function juger(indicateur: IndicateurGuide, preuves: Preuves, maintenant: Date): LigneConformite {
  const titre = indicateur.titre.replace(/\s+/g, " ").trim();
  const plat = plier(titre);
  const ligne = (statut: LigneConformite["statut"], detail: string): LigneConformite => ({
    numero: indicateur.numero,
    titre: raccourcir(titre),
    statut,
    detail,
  });
  if (
    indicateur.numero === 33 ||
    /apprenti|apprentissage|alternance|socio-professionnel|citoyennete/.test(plat)
  ) {
    return ligne("hors", "Apprentissage, hors du certificat.");
  }
  if (plat.includes("certification professionnelle")) return ligne("hors", "Seulement si l'action est certifiante.");
  if (plat.includes("sous-traitance") || plat.includes("portage salarial")) {
    return ligne("hors", "Pas de sous-traitance dans le registre.");
  }
  if (plat.includes("situation de travail")) return ligne("hors", "Pas de période en entreprise dans le registre.");
  if (plat.includes("veille") && (plat.includes("legale") || plat.includes("reglementaire"))) {
    return note("veille_legale", "Aucune veille légale.", ligne);
  }
  if (plat.includes("metiers") || (plat.includes("emplois") && plat.includes("veille"))) {
    return note("veille_metiers", "Aucune veille métiers.", ligne);
  }
  if (plat.includes("innovations pedagogiques") || plat.includes("pedagogiques et technologiques")) {
    return note("veille_pedagogique", "Aucune veille pédagogique.", ligne);
  }
  if (plat.includes("information accessible")) return note("accessibilite", "L'accessibilité handicap n'est pas notée.", ligne);
  if (plat.includes("indicateurs de resultats")) return note("resultats", "Aucun indicateur de résultats.", ligne);
  if (plat.includes("situation de handicap")) return note("handicap", "Aucun référent ni réseau handicap.", ligne);
  if (plat.includes("analyse le besoin")) return dossiers(preuves, preuves.sansAnalyse, "L'analyse du besoin n'est pas revenue.", ligne);
  if (plat.includes("objectifs operationnels")) return dossiers(preuves, preuves.sansProgramme, "Le programme manque.", ligne);
  if (plat.includes("contenus et les modalites")) return dossiers(preuves, preuves.sansProgramme, "Le programme manque.", ligne);
  if (plat.includes("positionnement")) return dossiers(preuves, preuves.sansPositionnement, "Le positionnement n'est pas revenu.", ligne);
  if (plat.includes("deroulement")) return dossiers(preuves, preuves.sansConvocation, "La convocation n'est pas partie.", ligne);
  if (plat.includes("evalue l") && plat.includes("atteinte")) {
    return dossiers(preuves, preuves.sansEvaluation, "L'évaluation de sortie n'est pas revenue.", ligne);
  }
  if (plat.includes("met en oeuvre et adapte")) {
    return dossiers(preuves, preuves.sansMiseEnOeuvre, "La réalisation n'est pas revenue.", ligne);
  }
  if (plat.includes("engagement des")) return note("engagement", "Aucune mesure d'engagement ni de prévention.", ligne);
  if (plat.includes("moyens humains")) return note("moyens", "Les moyens ne sont pas notés.", ligne);
  if (plat.includes("coordonne les differents intervenants")) return note("intervenants", "Les intervenants ne sont pas notés.", ligne);
  if (plat.includes("ressources pedagogiques")) {
    const base = dossiers(preuves, preuves.sansProgramme, "Le programme manque.", ligne);
    if (base.statut !== "tenu") return base;
    if (preuves.sansSuivi > 0) return ligne("pas_tenu", "Le suivi e-learning n'est pas revenu.");
    return base;
  }
  if (plat.includes("competences des differents intervenants")) return note("competences", "Les compétences ne sont pas notées.", ligne);
  if (plat.includes("developpe les competences") || plat.includes("entretient et developpe")) {
    return note("maintien", "Le maintien des compétences n'est pas noté.", ligne);
  }
  if (plat.includes("amelioration continue") || plat.includes("analyse des risques")) {
    const manques = [
      noteManque(preuves, maintenant, "risques", "Aucune analyse des risques.", "La revue des risques a plus de 365 jours."),
      noteManque(preuves, maintenant, "auto_evaluation", "Aucune auto-évaluation.", ""),
    ].filter(Boolean);
    return manques.length > 0 ? ligne("pas_tenu", manques.join(" ")) : ligne("tenu", "Tenu");
  }
  if (plat.includes("appreciations")) return note("appreciations", "Aucune appréciation recueillie.", ligne);
  if (plat.includes("reclamations")) return note("reclamations", "Le traitement des réclamations n'est pas noté.", ligne);
  return ligne("pas_tenu", "Pas de contrôle pour cet indicateur.");

  function note(code: CodeNote, vide: string, fabriquer: typeof ligne): LigneConformite {
    const manque = noteManque(preuves, maintenant, code, vide, `La dernière note a plus de ${noteParCode(code)?.jours ?? 0} jours.`);
    return manque ? fabriquer("pas_tenu", manque) : fabriquer("tenu", "Tenu");
  }
}

export function conformite(indicateurs: readonly IndicateurGuide[], preuves: Preuves, maintenant: Date): LigneConformite[] {
  return indicateurs.map((indicateur) => juger(indicateur, preuves, maintenant));
}

export async function telechargerGuide(chercher: typeof fetch = fetch): Promise<ReleveGuide | EchecGuide> {
  let lien: string | null = null;
  try {
    const page = await lireTexte(chercher, PAGE_GUIDE, null);
    lien = page ? lienDepuisPage(page, PAGE_GUIDE) : null;
  } catch {
    lien = null;
  }
  try {
    const url = lien ?? urlPdf(FICHIER_GUIDE, PAGE_GUIDE);
    if (!url) return { ok: false, erreur: "Le guide n'a pas pu être pris." };
    const octets = await lireOctets(chercher, url);
    if (!octets || !estPdf(octets)) return { ok: false, erreur: "Le guide n'a pas pu être pris." };
    const texte = await textePremieresPages(octets, PAGES_LUES);
    const indicateurs = indicateursDuGuide(texte);
    if (indicateurs.length < INDICATEURS_MIN) return { ok: false, erreur: "Le guide n'a pas pu être lu." };
    return {
      ok: true,
      url,
      hash: await empreinte(octets),
      version: versionDuGuide(texte),
      indicateurs,
    };
  } catch {
    return { ok: false, erreur: "Le guide n'a pas pu être pris." };
  }
}

export function releveDepuis(json: string): { version: string; indicateurs: IndicateurGuide[] } {
  if (!json.trim()) return { version: "", indicateurs: [] };
  try {
    const valeur = JSON.parse(json) as { version?: unknown; indicateurs?: unknown };
    const indicateurs = Array.isArray(valeur.indicateurs)
      ? valeur.indicateurs.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const numero = Number((item as { numero?: unknown }).numero);
          const titre = (item as { titre?: unknown }).titre;
          if (!Number.isInteger(numero) || typeof titre !== "string" || !titre.trim()) return [];
          return [{ numero, titre: titre.slice(0, 500) }];
        })
      : [];
    return { version: typeof valeur.version === "string" ? valeur.version.slice(0, 80) : "", indicateurs };
  } catch {
    return { version: "", indicateurs: [] };
  }
}

export function serialiserReleve(version: string, indicateurs: readonly IndicateurGuide[]): string {
  return JSON.stringify({ version, indicateurs });
}

export type VueNote = {
  code: string;
  libelle: string;
  geste: string;
  creeeLe: string | null;
  fraiche: boolean;
  extrait: string;
};

export type VueGuide = {
  verdict: string;
  version: string;
  verifieLe: string | null;
  erreur: string;
  aLire: boolean;
  lignes: LigneConformite[];
  notes: VueNote[];
};

export function presenterGuide(
  norme: { hash: string | null; hashLu: string | null; verifieLe: string | null; erreur: string; releve: string } | null,
  preuves: Preuves,
  textes: ReadonlyMap<string, { creeeLe: string; texte: string }>,
  maintenant: Date,
): VueGuide {
  const releve = releveDepuis(norme?.releve ?? "");
  const lignes = conformite(releve.indicateurs, preuves, maintenant);
  const ecarts = lignes.filter((ligne) => ligne.statut === "pas_tenu").length;
  const verdict =
    lignes.length === 0
      ? norme?.erreur || "Le guide n'a pas pu être lu."
      : ecarts === 0
        ? "Conforme dans le registre."
        : `Pas conforme. ${ecarts} écart${ecarts > 1 ? "s" : ""}.`;
  return {
    verdict,
    version: releve.version,
    verifieLe: norme?.verifieLe ?? null,
    erreur: lignes.length === 0 ? "" : (norme?.erreur ?? ""),
    aLire: Boolean(norme?.hash && norme.hash !== norme.hashLu),
    lignes,
    notes: NOTES.map((note) => {
      const trace = textes.get(note.code);
      const instant = trace ? Date.parse(trace.creeeLe) : Number.NaN;
      const fraiche =
        trace !== undefined &&
        !Number.isNaN(instant) &&
        (note.jours === null || maintenant.getTime() - instant <= note.jours * 86_400_000);
      return {
        code: note.code,
        libelle: note.libelle,
        geste: note.jours === 90 ? "Sous 90 jours" : note.jours === 365 ? "Sous 365 jours" : "Note datée",
        creeeLe: trace?.creeeLe ?? null,
        fraiche,
        extrait: raccourcir(trace?.texte.replace(/\s+/g, " ").trim() ?? ""),
      };
    }),
  };
}

function zoneSommaire(texte: string): string {
  const debut = texte.search(/\bsommaire\b/i);
  const bloc = debut >= 0 ? texte.slice(debut) : texte;
  const fin = bloc.search(/\bglossaire\b/i);
  return fin > 0 ? bloc.slice(0, fin) : bloc;
}

function noteManque(preuves: Preuves, maintenant: Date, code: string, vide: string, ancien: string): string {
  const iso = preuves.traces.get(code);
  if (!iso) return vide;
  const jours = noteParCode(code)?.jours;
  if (jours === null || jours === undefined) return "";
  const instant = Date.parse(iso);
  if (Number.isNaN(instant) || maintenant.getTime() - instant > jours * 86_400_000) return ancien;
  return "";
}

function dossiers(
  preuves: Preuves,
  manque: number,
  message: string,
  ligne: (statut: LigneConformite["statut"], detail: string) => LigneConformite,
): LigneConformite {
  if (preuves.ouverts === 0) return ligne("pas_tenu", "Aucun dossier.");
  if (manque > 0) return ligne("pas_tenu", message);
  return ligne("tenu", "Tenu");
}

function raccourcir(titre: string): string {
  const points = [...titre];
  return points.length > 160 ? `${points.slice(0, 159).join("")}…` : titre;
}

function plier(valeur: string): string {
  return valeur
    .replace(/œ/gi, "oe")
    .replace(/æ/gi, "ae")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’ʼ]/g, "")
    .toLowerCase();
}

function jourParis(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function estPdf(octets: Uint8Array): boolean {
  return octets.byteLength > 5 && octets[0] === 0x25 && octets[1] === 0x50 && octets[2] === 0x44 && octets[3] === 0x46;
}

function urlPdf(href: string, page: string): string | null {
  try {
    const url = new URL(href, page);
    if (url.protocol !== "https:" || url.hostname !== HOTE || !url.pathname.toLowerCase().endsWith(".pdf")) return null;
    return url.href;
  } catch {
    return null;
  }
}

function decode(valeur: string): string {
  return valeur.replaceAll("&amp;", "&");
}

async function lireTexte(chercher: typeof fetch, url: string, referer: string | null): Promise<string | null> {
  const reponse = await chercher(url, { headers: entetes(referer), signal: AbortSignal.timeout(20000) });
  if (!reponse.ok) return null;
  return reponse.text();
}

async function lireOctets(chercher: typeof fetch, url: string): Promise<Uint8Array | null> {
  const reponse = await chercher(url, { headers: entetes(PAGE_GUIDE), signal: AbortSignal.timeout(20000) });
  if (!reponse.ok) return null;
  const octets = new Uint8Array(await reponse.arrayBuffer());
  if (octets.byteLength === 0 || octets.byteLength > TAILLE_MAX) return null;
  return octets;
}

function entetes(referer: string | null): HeadersInit {
  return referer ? { ...ENTETES, Referer: referer } : ENTETES;
}

async function empreinte(octets: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", octets.slice());
  return [...new Uint8Array(digest)].map((octet) => octet.toString(16).padStart(2, "0")).join("");
}
