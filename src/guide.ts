import { documentHtml, paragraphes, sousTitre, tableauHtml, tableauLibre } from "./html-pdf.ts";
import { afficherJour } from "./montants.ts";
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
  vide: string;
};

export const NOTES = [
  { code: "accessibilite", libelle: "Accessibilité annoncée au public", jours: null, vide: "L'accessibilité handicap n'est pas notée." },
  { code: "resultats", libelle: "Indicateurs de résultats", jours: null, vide: "Aucun indicateur de résultats." },
  { code: "engagement", libelle: "Engagement et prévention des violences", jours: null, vide: "Aucune mesure d'engagement ni de prévention." },
  { code: "moyens", libelle: "Moyens et environnement", jours: null, vide: "Les moyens ne sont pas notés." },
  { code: "intervenants", libelle: "Intervenants", jours: null, vide: "Les intervenants ne sont pas notés." },
  { code: "competences", libelle: "Compétences des intervenants", jours: null, vide: "Les compétences ne sont pas notées." },
  { code: "maintien", libelle: "Maintien des compétences", jours: null, vide: "Le maintien des compétences n'est pas noté." },
  { code: "veille_legale", libelle: "Veille légale et réglementaire", jours: 90, vide: "Aucune veille légale." },
  { code: "veille_metiers", libelle: "Veille métiers et emplois", jours: 90, vide: "Aucune veille métiers." },
  { code: "veille_pedagogique", libelle: "Veille pédagogique et technologique", jours: 90, vide: "Aucune veille pédagogique." },
  { code: "handicap", libelle: "Référent handicap et réseau", jours: null, vide: "Aucun référent ni réseau handicap." },
  { code: "appreciations", libelle: "Appréciations", jours: null, vide: "Aucune appréciation recueillie." },
  { code: "reclamations", libelle: "Traitement des réclamations", jours: 365, vide: "Le traitement des réclamations n'est pas noté." },
  { code: "risques", libelle: "Analyse des risques", jours: 365, vide: "Aucune analyse des risques." },
  { code: "auto_evaluation", libelle: "Auto-évaluation", jours: null, vide: "Aucune auto-évaluation." },
] as const satisfies readonly NoteOrganisme[];

export const CODES_PRODUITS = NOTES.map((note) => note.code);

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
  sansConnexion: number;
  dates: ReadonlyMap<string, string>;
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
  if (plat.includes("information accessible")) return note("accessibilite", "L'accessibilité handicap n'est pas publiée.", ligne);
  if (plat.includes("indicateurs de resultats")) return note("resultats", "Aucun taux d'atteinte, d'abandon ou de satisfaction.", ligne);
  if (plat.includes("situation de handicap")) return note("handicap", "Aucun réseau handicap n'est inscrit.", ligne);
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
  if (plat.includes("engagement des")) return note("engagement", "Les mesures d'engagement ne sont pas mises en œuvre.", ligne);
  if (plat.includes("moyens humains")) return note("moyens", "Les moyens ne sont pas notés.", ligne);
  if (plat.includes("coordonne les differents intervenants")) return note("intervenants", "Les intervenants ne sont pas notés.", ligne);
  if (plat.includes("ressources pedagogiques")) {
    const base = dossiers(preuves, preuves.sansProgramme, "Le programme manque.", ligne);
    if (base.statut !== "tenu") return base;
    const manques = [
      preuves.sansSuivi > 0 ? "Le suivi e-learning n'est pas revenu." : "",
      preuves.sansConnexion > 0 ? "Le relevé de connexion n'est pas déposé." : "",
    ].filter(Boolean);
    if (manques.length > 0) return ligne("pas_tenu", manques.join(" "));
    return base;
  }
  if (plat.includes("competences des differents intervenants")) return note("competences", "Les compétences des intervenants ne sont pas évaluées.", ligne);
  if (plat.includes("developpe les competences") || plat.includes("entretient et developpe")) {
    return note("maintien", "Le maintien des compétences n'est pas noté.", ligne);
  }
  if (plat.includes("amelioration continue") || plat.includes("analyse des risques")) {
    const manques = [
      noteManque(preuves, maintenant, "risques", "Aucune analyse des risques.", "La dernière version a plus de 365 jours."),
      noteManque(preuves, maintenant, "auto_evaluation", "Aucune auto-évaluation.", ""),
    ].filter(Boolean);
    return manques.length > 0 ? ligne("pas_tenu", manques.join(" ")) : ligne("tenu", "Tenu");
  }
  if (plat.includes("appreciations")) return note("appreciations", "Aucune appréciation recueillie.", ligne);
  if (plat.includes("reclamations")) return note("reclamations", "Le traitement des réclamations n'est pas noté.", ligne);
  return ligne("pas_tenu", "Pas de contrôle pour cet indicateur.");

  function note(code: CodeNote, vide: string, fabriquer: typeof ligne): LigneConformite {
    const manque = noteManque(preuves, maintenant, code, vide, `La dernière version a plus de ${noteParCode(code)?.jours ?? 0} jours.`);
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

export type VersionVue = { version: number; poseLe: string };

export type VuePiece = {
  code: string;
  libelle: string;
  periode: string;
  courante: VersionVue | null;
  fraiche: boolean;
  anterieures: VersionVue[];
  produit: boolean;
  vide: string;
};

export type VueGuide = {
  verdict: string;
  version: string;
  verifieLe: string | null;
  erreur: string;
  aLire: boolean;
  lignes: LigneConformite[];
  pieces: VuePiece[];
};

export function presenterGuide(
  norme: { hash: string | null; hashLu: string | null; verifieLe: string | null; erreur: string; releve: string } | null,
  preuves: Preuves,
  versions: readonly { code: string; version: number; poseLe: string }[],
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
    erreur: "",
    aLire: Boolean(norme?.hash && norme.hash !== norme.hashLu),
    lignes,
    pieces: NOTES.map((note) => {
      const suite = versions
        .filter((version) => version.code === note.code)
        .sort((a, b) => a.version - b.version);
      const courante = suite.at(-1) ?? null;
      const instant = courante ? Date.parse(courante.poseLe) : Number.NaN;
      const fraiche =
        courante !== null &&
        !Number.isNaN(instant) &&
        (note.jours === null || maintenant.getTime() - instant <= note.jours * 86_400_000);
      return {
        code: note.code,
        libelle: note.libelle,
        periode: note.jours === 90 ? "Sous 90 jours" : note.jours === 365 ? "Sous 365 jours" : "À tenir à jour",
        courante,
        fraiche,
        anterieures: suite.slice(0, -1),
        produit: true,
        vide: note.vide,
      };
    }),
  };
}

export function texteAutoEvaluation(nom: string, versionGuide: string, lignes: readonly LigneConformite[], jour: string): string | null {
  if (lignes.length === 0) return null;
  const tableau = tableauLibre(
    ["N°", "Indicateur", "État", "Constat"],
    lignes.map((ligne) => [
      String(ligne.numero),
      ligne.titre,
      ligne.statut === "tenu" ? "Tenu" : ligne.statut === "hors" ? "Hors champ" : "Pas tenu",
      ligne.detail,
    ]),
  );
  return documentHtml("Auto-évaluation", [nom, jour, versionGuide].filter(Boolean).join(" · "), tableau);
}

export type LigneResultat = {
  nom: string;
  intitule: string;
  debut: string;
  fin: string | null;
  statut: string;
  heures: number;
};

export function texteResultats(nom: string, jour: string, lignes: readonly LigneResultat[]): string {
  const clos = lignes.filter((ligne) => ligne.statut === "clos").length;
  const tableau =
    lignes.length === 0
      ? ""
      : tableauLibre(
          ["Bénéficiaire", "Prestation", "Début", "Fin", "Statut", "Heures"],
          lignes.map((ligne) => [
            ligne.nom,
            ligne.intitule,
            afficherJour(ligne.debut),
            ligne.fin ? afficherJour(ligne.fin) : "",
            ligne.statut === "clos" ? "Clos" : ligne.statut === "en_cours" ? "En cours" : "Ouvert",
            String(ligne.heures),
          ]),
        );
  return documentHtml(
    "Indicateurs de résultats",
    `${nom} · ${jour}`,
    paragraphes([
      `Dossiers au registre : ${lignes.length}. Ouverts : ${lignes.length - clos}. Clos : ${clos}.`,
      "Aucun taux d'atteinte, d'abandon ou de satisfaction : le registre ne porte pas l'atteinte des objectifs.",
    ]) + tableau,
  );
}

export function texteIntervenants(
  organisme: { nom: string; siret: string; nda: string; adresse: string; code_postal: string; ville: string; telephone: string; email: string },
  jour: string,
): string {
  return documentHtml(
    "Intervenants",
    `${organisme.nom} · ${jour}`,
    paragraphes([
      "L'intervenant inscrit au registre est le titulaire.",
      organisme.nom,
      organisme.siret ? `SIRET ${organisme.siret}` : "",
      organisme.nda ? `NDA ${organisme.nda}` : "",
      [organisme.adresse, organisme.code_postal, organisme.ville].filter(Boolean).join(" "),
      organisme.telephone,
      organisme.email,
      "Aucun autre intervenant n'est inscrit.",
    ]),
  );
}

export type ContexteExigence = {
  nom: string;
  siret: string;
  nda: string;
  adresse: string;
  codePostal: string;
  ville: string;
  telephone: string;
  email: string;
  dossiers: readonly {
    nom: string;
    intitule: string;
    debut: string;
    fin: string | null;
    statut: string;
    heures: number;
    modalite: string;
    handicap: number;
  }[];
  lignes: readonly LigneConformite[];
  versionGuide: string;
  risques: readonly { risque: string; parade: string }[];
  reclamations: readonly { auteur: string; objet: string; suite: string }[];
  mesures: readonly { constat: string; mesure: string }[];
  jour: string;
};

export function texteExigence(code: string, ctx: ContexteExigence): { texte: string; tient: boolean } | null {
  const titre = noteParCode(code)?.libelle;
  if (!titre) return null;
  const tete = [titre, ctx.nom, ctx.jour, ""];
  if (code === "auto_evaluation") {
    const texte = texteAutoEvaluation(ctx.nom, ctx.versionGuide, ctx.lignes, ctx.jour);
    return texte ? { texte, tient: true } : null;
  }
  if (code === "resultats") {
    return {
      texte: texteResultats(
        ctx.nom,
        ctx.jour,
        ctx.dossiers.map((dossier) => ({
          nom: dossier.nom,
          intitule: dossier.intitule,
          debut: dossier.debut,
          fin: dossier.fin,
          statut: dossier.statut,
          heures: dossier.heures,
        })),
      ),
      tient: false,
    };
  }
  if (code === "intervenants") {
    return {
      texte: texteIntervenants(
        {
          nom: ctx.nom,
          siret: ctx.siret,
          nda: ctx.nda,
          adresse: ctx.adresse,
          code_postal: ctx.codePostal,
          ville: ctx.ville,
          telephone: ctx.telephone,
          email: ctx.email,
        },
        ctx.jour,
      ),
      tient: true,
    };
  }
  if (code === "veille_legale") return { texte: veilleLegale(ctx), tient: ctx.versionGuide.trim().length > 0 };
  if (code === "veille_metiers") return { texte: veilleMetiers(ctx), tient: true };
  if (code === "veille_pedagogique") return { texte: veillePedagogique(ctx), tient: true };
  if (code === "accessibilite") return { texte: accessibilite(ctx), tient: false };
  if (code === "engagement") return { texte: engagement(ctx), tient: false };
  if (code === "moyens") return { texte: moyens(ctx), tient: ctx.nom.trim().length > 0 && ctx.adresse.trim().length > 0 };
  if (code === "competences") return { texte: competences(ctx), tient: false };
  if (code === "maintien") return { texte: maintien(ctx), tient: true };
  if (code === "handicap") return { texte: handicap(ctx), tient: false };
  if (code === "appreciations") return { texte: appreciations(ctx), tient: false };
  if (code === "reclamations") return { texte: reclamations(ctx), tient: true };
  if (code === "risques") return { texte: risques(ctx), tient: true };
  return { texte: [...tete, noteParCode(code)?.vide ?? ""].join("\n"), tient: false };
}

function veilleLegale(ctx: ContexteExigence): string {
  const version = ctx.versionGuide.trim();
  const lignes = [
    {
      date: "4 août 2026",
      source: "Décret n° 2026-728 du 1er août 2026, Journal officiel du 4 août 2026",
      info: "Le référentiel national qualité est actualisé. Il entre en vigueur le 1er novembre 2026 et compte 33 indicateurs. L'indicateur 33 ne vise que l'apprentissage.",
      impact: "Les actions de formation sont jugées sur ce référentiel. L'apprentissage reste hors du certificat.",
      action: "Juger les indicateurs avec le guide de lecture en vigueur. L'indicateur 33 reste hors champ.",
      statut: "Noté",
    },
  ];
  if (version) {
    lignes.push({
      date: ctx.jour,
      source: `Guide de lecture ${version}`,
      info: "Le guide de lecture en vigueur a été lu. Les écarts sont ceux de l'auto-évaluation.",
      impact: "Le registre suit cette lecture.",
      action: "Conserver cette revue datée.",
      statut: "Noté",
    });
  }
  return pageVeille(ctx, "Veille légale et réglementaire", ["Sources suivies : Journal officiel, Légifrance, guide de lecture du référentiel national qualité."], lignes);
}

function veilleMetiers(ctx: ContexteExigence): string {
  return pageVeille(
    ctx,
    "Veille métiers et emplois",
    [
      "Secteur : vente en ligne, vente directe des producteurs, artisans et entrepreneurs.",
      "Sources suivies : L'Opcommerce, Fevad, France Travail.",
    ],
    [
      {
        date: "15 janvier 2026",
        source: "L'Opcommerce, enquête de branche e-commerce, mise à jour du 15 janvier 2026",
        info: "45 % des entreprises de la branche voient émerger des besoins en marketing et webmarketing. Un tiers cite la technologie, l'IA et la data. 13 % citent le contenu, les réseaux sociaux et la relation client.",
        impact: "Ces besoins décrivent des métiers salariés de la branche. Ils ne décrivent pas le public formé ici.",
        action: "Les objectifs restent la vente directe : visibilité des produits, commande, relation client.",
        statut: "Noté",
      },
      {
        date: "27 novembre 2025",
        source: "Fevad, les chiffres sur les nouveaux métiers du e-commerce",
        info: "En 2024, 153 000 sites marchands et 212 000 emplois. La Fevad cite l'APEC 2025 : jusqu'à 72 % des employeurs peinent à recruter sur l'e-merchandising, l'UX, le CRM et la data.",
        impact: "La tension porte sur des postes salariés. Le public formé vend en direct.",
        action: "Ne pas dériver les objectifs vers un poste de salarié de plateforme.",
        statut: "Noté",
      },
      {
        date: ctx.jour,
        source: "France Travail, fiche métier E1113, responsable e-commerce",
        info: "Missions citées : visibilité des produits, analyse des comportements d'achat, suivi des commandes, réclamations et retours.",
        impact: "Ces gestes font partie de la vente en ligne accompagnée.",
        action: "Les maintenir dans les contenus des prestations de vente en ligne.",
        statut: "Noté",
      },
    ],
  );
}

function veillePedagogique(ctx: ContexteExigence): string {
  return pageVeille(ctx, "Veille pédagogique et technologique", ["Sources suivies : Centre Inffo."], [
    {
      date: "5 février 2026",
      source: "Centre Inffo, compte rendu de la table ronde ANRT du 3 février 2026",
      info: "Nicolas Mascret retient trois leviers : la différenciation, l'autonomie et l'esprit critique. Les projets qui tiennent sont co-construits avec les acteurs.",
      impact: "Un outil ne tient pas lieu d'accompagnement.",
      action: "L'accompagnement reste assuré par le titulaire, en visio ou en présentiel. L'IA peut servir à préparer. Elle n'anime pas la séance.",
      statut: "Noté",
    },
    {
      date: "29 mai 2026",
      source: "Centre Inffo, compte rendu du baromètre Edflex 2026, publié en avril 2026",
      info: "94 % des responsables de formation voient dans les formats intégrant l'IA une réponse à leurs enjeux. 14 % les utilisent au quotidien. La classe virtuelle est jugée trop lourde à organiser par 44 %, et de qualité inégale par 37 %.",
      impact: "Un module ou une classe virtuelle seule ne constitue pas l'action.",
      action: "La prestation ne bascule pas vers un module automatique. L'évaluation de sortie porte sur les objectifs, pas sur un taux de complétion.",
      statut: "Noté",
    },
    {
      date: "20 avril 2026",
      source: "Centre Inffo, Sarah Nafti, L'intelligence artificielle, un levier d'engagement dans la formation",
      info: "Laurence Bonzi (France Travail) rappelle qu'on peut finir un module sans avoir appris. Thomas Chassat (Colas) dit que l'IA peut aider à retrouver une ressource, et qu'elle ne remplace pas l'échange avec d'autres personnes.",
      impact: "Le suivi d'un parcours en ligne ne se résume pas à une case cochée.",
      action: "L'évaluation de sortie interroge l'atteinte des objectifs. Elle ne produit pas un score.",
      statut: "Noté",
    },
  ]);
}

function accessibilite(ctx: ContexteExigence): string {
  return documentHtml(
    "Information accessible au public",
    `deter-mi.net · ${ctx.jour}`,
    sousTitre("1. Organisme") +
      paragraphes(contact(ctx).split("\n")) +
      sousTitre("2. Prestations") +
      paragraphes(prestations(ctx).split("\n")) +
      sousTitre("3. Accessibilité") +
      paragraphes([
        `Le référent handicap est ${ctx.nom}. La demande se fait avant l'entrée, par téléphone ou par courriel.`,
        "Le face-à-face se tient en visioconférence ou en présentiel. Le rythme du travail en autonomie s'ajuste au besoin signalé.",
        "Si la situation dépasse ce que la prestation peut aménager, le référent oriente vers le réseau : Agefiph, Cap Emploi, FIPHFP, APF France handicap, associations locales.",
      ]),
  );
}

function engagement(ctx: ContexteExigence): string {
  const deja = ctx.mesures.map((mesure) => [mesure.constat, mesure.mesure].filter(Boolean).join(" — ")).filter(Boolean);
  return documentHtml(
    "Engagement et prévention des ruptures",
    `${ctx.nom} · ${ctx.jour}`,
    sousTitre("Processus de chaque action") +
      paragraphes([
        "1. Analyse du besoin avant la convention.",
        "2. Positionnement avant la convocation.",
        "3. Convocation qui fixe le déroulement.",
        "4. Suivi du travail en autonomie lorsque l'action en comporte.",
        "5. Émargement de chaque séance accompagnée.",
        `6. Contact direct de ${ctx.nom} pendant l'action.`,
      ]) +
      sousTitre("Prévention des violences, du harcèlement et des discriminations") +
      paragraphes([
        "Tout signalement est reçu par le titulaire, consigné, et traité.",
        ...(deja.length > 0 ? deja : ["Aucun signalement n'est inscrit à cette date."]),
      ]),
  );
}

function moyens(ctx: ContexteExigence): string {
  return documentHtml(
    "Moyens et environnement",
    `${ctx.nom} · ${ctx.jour}`,
    paragraphes([
      `Humain : ${ctx.nom}, seul intervenant.`,
      `Lieu : ${[ctx.adresse, ctx.codePostal, ctx.ville].filter(Boolean).join(" ")}`,
      "Technique : visioconférence ou présentiel pour l'accompagnement assuré par le titulaire.",
      "Environnement : entretien individuel, ou le poste du bénéficiaire lorsqu'il travaille en autonomie.",
    ]),
  );
}

function competences(ctx: ContexteExigence): string {
  return documentHtml(
    "Compétences des intervenants",
    `${ctx.nom} · ${ctx.jour}`,
    paragraphes([`Intervenant : ${ctx.nom}, titulaire.`, ctx.nda ? `NDA ${ctx.nda}` : "", ctx.siret ? `SIRET ${ctx.siret}` : ""]) +
      sousTitre("Compétences requises par les prestations de vente en ligne") +
      paragraphes([
        "Concevoir et animer une action de vente directe en ligne.",
        "Accompagner un bénéficiaire en face-à-face.",
        "Faire utiliser un parcours en ligne sans confondre complétion et atteinte des objectifs.",
      ]) +
      sousTitre("Justificatifs au registre") +
      paragraphes(["Certificat Qualiopi des actions de formation, catalogue, programme de chaque prestation."]),
  );
}

function maintien(ctx: ContexteExigence): string {
  const version = ctx.versionGuide.trim();
  return documentHtml(
    "Maintien et développement des compétences",
    `${ctx.nom} · ${ctx.jour}`,
    paragraphes([
      `${ctx.nom} est indépendant, sans salarié. La formation continue est la sienne.`,
      "Leviers : lecture des textes, veille métiers, veille pédagogique.",
    ]) +
      sousTitre("Journal") +
      tableauHtml([
        {
          date: ctx.jour,
          source: version ? `Décret n° 2026-728 et guide de lecture ${version}` : "Décret n° 2026-728 du 1er août 2026",
          info: "Lecture du décret et du guide en vigueur.",
          impact: "Le cadre lu est celui du 1er novembre 2026 : 33 indicateurs, l'indicateur 33 ne vise que l'apprentissage.",
          action: "Lecture notée. Les écarts restent ceux de l'auto-évaluation.",
          statut: "Lu",
        },
        {
          date: ctx.jour,
          source: "L'Opcommerce, Fevad, France Travail fiche E1113, Centre Inffo",
          info: "Lecture des évolutions du e-commerce et des usages de l'IA en formation.",
          impact: "Les prestations restent sur la vente directe accompagnée. L'outil ne remplace pas le face-à-face.",
          action: "Décisions notées dans les veilles métiers et pédagogique.",
          statut: "Lu",
        },
      ]),
  );
}

function handicap(ctx: ContexteExigence): string {
  const signales = ctx.dossiers.filter((dossier) => dossier.handicap === 1).length;
  return documentHtml(
    "Réseau d'acteurs pour l'accessibilité à la formation",
    `deter-mi.net · Référent : ${ctx.nom}`,
    sousTitre("1. Introduction") +
      paragraphes([
        "deter-mi.net garantit l'accessibilité de la formation, y compris pour les personnes en situation de handicap. Le référent s'appuie sur un réseau d'acteurs pour l'orientation et l'aménagement.",
      ]) +
      sousTitre("2. Objectif") +
      paragraphes([
        "Permettre l'accès à la formation, avec des partenaires qui apportent une expertise lorsque la prestation seule ne couvre pas la situation.",
      ]) +
      sousTitre("3. Acteurs du réseau") +
      paragraphes([`Référent : ${ctx.nom}. La demande lui est adressée avant l'entrée.`]) +
      tableauLibre(
        ["Organisme", "Rôle"],
        [
          ["Agefiph", "Accompagnement et financement d'actions de formation pour les personnes en situation de handicap."],
          ["Cap Emploi", "Insertion professionnelle des personnes handicapées."],
          ["FIPHFP", "Accessibilité et adaptation des conditions de travail dans la fonction publique."],
          ["APF France handicap", "Sensibilisation et accompagnement vers la formation et l'emploi."],
          ["Associations locales", "Adaptation des formations aux besoins signalés par le stagiaire."],
        ],
      ) +
      sousTitre("4. Actions") +
      paragraphes([
        "Adaptation des contenus : le programme est ajusté au besoin signalé.",
        "Lieu : visioconférence, ou présentiel après vérification de l'accès.",
        "Soutien : rythme et face-à-face aménagés. Orientation vers le réseau si la prestation ne suffit pas.",
        signales > 0 ? `Dossiers signalant un handicap : ${signales}.` : "",
      ]) +
      sousTitre("5. Contact") +
      paragraphes(contact(ctx).split("\n")),
  );
}

function appreciations(ctx: ContexteExigence): string {
  return documentHtml(
    "Appréciations des parties prenantes",
    `${ctx.nom} · ${ctx.jour}`,
    sousTitre("Recueil, en fin d'action") +
      paragraphes([
        "Le bénéficiaire dit ce qui a été atteint et ce qui a manqué.",
        "Le financeur est interrogé lorsqu'il y en a un.",
        "Le formateur consigne son propre constat.",
        "Le recueil est un texte. Aucune note chiffrée n'est posée.",
        "Fiches reçues à cette date : aucune.",
      ]),
  );
}

function reclamations(ctx: ContexteExigence): string {
  const lignes = ctx.reclamations.map((ligne) => [ligne.auteur, ligne.objet, ligne.suite].filter(Boolean).join(" — ")).filter(Boolean);
  return documentHtml(
    "Procédure interne : traitement des réclamations et aléas",
    `deter-mi.net · ${ctx.jour}`,
    sousTitre("1. Objet") +
      paragraphes([
        "Cette procédure fixe la réception, l'analyse et le traitement des réclamations des stagiaires, des clients et des financeurs.",
      ]) +
      sousTitre("2. Circuit") +
      paragraphes([
        "Étape 1. Réception par courriel ou par le questionnaire de satisfaction.",
        "Étape 2. Enregistrement dans le registre des réclamations.",
        `Étape 3. Analyse par ${ctx.nom} sous 48 heures ouvrées.`,
        "Étape 4. Réponse écrite au réclamant, avec une solution.",
        "Étape 5. Si le problème est structurel, modification du support ou du processus.",
        "Un signalement de violence, de harcèlement ou de discrimination suit le même circuit.",
      ]) +
      sousTitre("3. Archivage") +
      paragraphes(["Les échanges sont conservés trois ans."]) +
      sousTitre("4. Registre") +
      paragraphes(lignes.length > 0 ? lignes : ["Aucune réclamation reçue à cette date."]),
  );
}

function risques(ctx: ContexteExigence): string {
  const deja = ctx.risques.map((ligne) => [ligne.risque, ligne.parade]);
  const lignes = [
    ["Abandon en cours d'action.", "Analyse du besoin, positionnement, contact du titulaire, suivi du travail en autonomie."],
    ["Le titulaire est seul et indisponible.", "Les séances accompagnées sont datées. Une séance manquée est reportée, pas déclarée tenue."],
    ["Confondre un module terminé et un objectif atteint.", "L'évaluation de sortie porte sur les objectifs. Elle ne produit pas un score."],
    ["Données du bénéficiaire.", "Les pièces restent dans le registre, sans diffusion publique."],
    ...deja,
  ];
  return documentHtml(
    "Analyse des risques",
    `${ctx.nom} · Revue du ${ctx.jour}`,
    tableauLibre(["Risque", "Parade"], lignes),
  );
}

function pageVeille(
  ctx: ContexteExigence,
  titre: string,
  intro: string[],
  lignes: Array<{ date: string; source: string; info: string; impact: string; action: string; statut: string }>,
): string {
  return documentHtml(
    titre,
    `${ctx.nom} · Responsable : ${ctx.nom} · Revue du ${ctx.jour} · Trimestrielle`,
    paragraphes(intro) + tableauHtml(lignes),
  );
}

function contact(ctx: ContexteExigence): string {
  return [ctx.nom, [ctx.adresse, ctx.codePostal, ctx.ville].filter(Boolean).join(" "), ctx.telephone, ctx.email, ctx.nda ? `NDA ${ctx.nda}` : ""]
    .filter(Boolean)
    .join("\n");
}

function prestations(ctx: ContexteExigence): string {
  if (ctx.dossiers.length === 0) return "Aucune prestation inscrite.";
  return ctx.dossiers.map((dossier) => `${dossier.intitule} — ${dossier.heures} h — ${afficherJour(dossier.debut)}`).join("\n");
}

function zoneSommaire(texte: string): string {
  const debut = texte.search(/\bsommaire\b/i);
  const bloc = debut >= 0 ? texte.slice(debut) : texte;
  const fin = bloc.search(/\bglossaire\b/i);
  return fin > 0 ? bloc.slice(0, fin) : bloc;
}

function noteManque(preuves: Preuves, maintenant: Date, code: string, vide: string, ancien: string): string {
  const iso = preuves.dates.get(code);
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
