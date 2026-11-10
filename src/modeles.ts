import type { DossierComplet, Organisme } from "./db.ts";
import { documentHtml, paragraphes, sousTitre, tableauLibre } from "./html-pdf.ts";
import { afficherJour } from "./montants.ts";

export const MODELES = [
  ["analyse", "Analyse du besoin"],
  ["positionnement", "Positionnement"],
  ["reglement", "Règlement intérieur"],
  ["convocation", "Convocation"],
  ["emargement", "Émargement"],
  ["suivi", "Suivi du e-learning"],
  ["qcm", "Évaluation de sortie"],
] as const;

export type CodeModele = (typeof MODELES)[number][0];

export const CODES_PRODUITS = ["devis", "analyse", "positionnement", "convention", "programme", "reglement", "convocation", "emargement", "suivi", "qcm", "attestation", "facture"] as const;

export function pieceProduite(code: string): boolean {
  return (CODES_PRODUITS as readonly string[]).includes(code);
}

export const REGLEMENT_URL = "https://deter-mi.net/wp-content/uploads/2026/04/reglementinterieur.pdf";

export type SeanceProgramme = { titre: string; duree: string; sujet: string };
export type ModuleProgramme = { titre: string; heures: string; objectifs: string[] };

export function seancesDuProgramme(texte: string): SeanceProgramme[] {
  const vues = new Set<string>();
  const seances: SeanceProgramme[] = [];
  for (const match of texte.matchAll(/s[ée]ance\s+(\d+)\s*\(\s*([^)\n]+?)\s*\)\s*:?\s*([^\n]*)/gi)) {
    const numero = match[1] ?? "";
    if (!numero || vues.has(numero)) continue;
    vues.add(numero);
    seances.push({
      titre: `Séance ${numero}`,
      duree: (match[2] ?? "").replace(/\s+/g, " ").trim(),
      sujet: (match[3] ?? "").replace(/\s+/g, " ").trim(),
    });
  }
  return seances;
}

export function modulesDuProgramme(texte: string): ModuleProgramme[] {
  const parNumero = new Map<string, ModuleProgramme>();
  for (const bloc of texte.split(/\n(?=Module\s+\d+)/i)) {
    const titreBrut = bloc.match(/^Module\s+\d+[^\n]*/i)?.[0]?.replace(/\s+/g, " ").trim() ?? "";
    const numero = titreBrut.match(/\d+/)?.[0];
    if (!numero || !titreBrut) continue;
    const heures = bloc.match(/(\d+\s*h(?:eures?)?(?:\s+e-learning)?)/i)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
    const objectifs = objectifsDe(bloc);
    const deja = parNumero.get(numero);
    if (!deja) {
      parNumero.set(numero, { titre: titreBrut, heures, objectifs });
      continue;
    }
    if (titreBrut.length > deja.titre.length) deja.titre = titreBrut;
    if (!deja.heures && heures) deja.heures = heures;
    if (objectifs.length > deja.objectifs.length) deja.objectifs = objectifs;
  }
  return [...parNumero.values()];
}

export function textesModeles(
  dossier: DossierComplet,
  organisme: Organisme,
  programme: string,
  convention: string,
): { code: Exclude<CodeModele, "reglement">; texte: string }[] {
  const seances = seancesDuProgramme(programme);
  const modules = modulesDuProgramme(programme);
  const textes: { code: Exclude<CodeModele, "reglement">; texte: string }[] = [
    { code: "analyse", texte: texteAnalyse(dossier, programme) },
    { code: "positionnement", texte: texteQuestions("Positionnement d'entrée", "Ce que le stagiaire sait déjà faire.", dossier, modules) },
    { code: "convocation", texte: texteConvocation(dossier, organisme, convention) },
    { code: "qcm", texte: texteQuestions("Évaluation de sortie", "Ce que le stagiaire sait faire à l'issue.", dossier, modules) },
  ];
  if (dossier.heures_coaching > 0 || seances.length > 0) {
    textes.push({ code: "emargement", texte: texteEmargement(dossier, organisme, seances) });
  }
  if (dossier.heures_elearning > 0) {
    textes.push({ code: "suivi", texte: texteSuivi(dossier, modules) });
  }
  return textes;
}

function texteAnalyse(dossier: DossierComplet, programme: string): string {
  void programme;
  return documentHtml(
    "Analyse du besoin et de la demande",
    [dossier.entreprise, dossier.stagiaire_nom].filter(Boolean).join(" · "),
    paragraphes([
      dossier.entreprise ? `Client : ${dossier.entreprise}` : "",
      dossier.stagiaire_nom ? `Bénéficiaire : ${dossier.stagiaire_nom}` : "",
      dossier.intitule,
    ]) +
      [
        "1. Objectif principal de la demande",
        "2. Compétences à acquérir",
        "3. Contraintes (temps, lieu, budget)",
        "4. Résultats attendus",
        "5. Besoins particuliers (handicap, prérequis)",
      ]
        .map((question) => sousTitre(question) + paragraphes(["Réponse"]))
        .join(""),
  );
}

function texteQuestions(
  titre: string,
  consigne: string,
  dossier: DossierComplet,
  modules: readonly ModuleProgramme[],
): string {
  const objectifs = modules.flatMap((module) =>
    (module.objectifs.length > 0 ? module.objectifs : [module.titre]).map((objectif) => ({
      module: module.titre,
      objectif,
    })),
  );
  const questions =
    objectifs.length > 0
      ? objectifs
          .map((ligne, index) => sousTitre(`${index + 1}. ${ligne.module}`) + paragraphes([ligne.objectif, "Réponse"]))
          .join("")
      : sousTitre(`1. ${dossier.intitule}`) + paragraphes(["Réponse"]);
  return documentHtml(titre, identite(dossier).join(" · "), paragraphes([consigne]) + questions);
}

function texteConvocation(dossier: DossierComplet, organisme: Organisme, convention: string): string {
  const fin = dossier.date_fin ? afficherJour(dossier.date_fin) : "";
  return documentHtml(
    "Convocation",
    convention ? `Convention ${convention}` : "",
    sousTitre("Organisme") +
      paragraphes([
        organisme.nom,
        [organisme.adresse, organisme.code_postal, organisme.ville].filter(Boolean).join(" "),
        organisme.email,
        organisme.telephone,
      ]) +
      sousTitre("Destinataire") +
      paragraphes(identite(dossier)) +
      sousTitre("Déroulement") +
      paragraphes([
        dossier.intitule,
        `Début : ${afficherJour(dossier.date_debut)}`,
        fin ? `Fin : ${fin}` : "",
        `${dossier.heures_total} heures`,
        dossier.modalite,
      ]),
  );
}

function texteEmargement(
  dossier: DossierComplet,
  organisme: Organisme,
  seances: readonly SeanceProgramme[],
): string {
  const lignesSeances = seances.length > 0 ? seances : [{ titre: "Coaching", duree: `${dossier.heures_coaching} heures`, sujet: "" }];
  return documentHtml(
    "Feuille d'émargement",
    identite(dossier).join(" · "),
    paragraphes([`Formateur : ${organisme.nom}`, dossier.intitule]) +
      tableauLibre(
        ["Séance", "Durée", "Date", "Stagiaire", "Formateur"],
        lignesSeances.map((seance) => [seance.titre, seance.duree, "", "", ""]),
      ),
  );
}

function texteSuivi(dossier: DossierComplet, modules: readonly ModuleProgramme[]): string {
  const utiles = modules.filter((module) => /e-learning|h/i.test(module.heures));
  const lignesModules = utiles.length > 0 ? utiles : [{ titre: "E-learning", heures: `${dossier.heures_elearning} heures`, objectifs: [] }];
  return documentHtml(
    "Suivi du e-learning",
    identite(dossier).join(" · "),
    tableauLibre(
      ["Module", "Prévu", "Fait", "Date"],
      lignesModules.map((module) => [module.titre, module.heures, "", ""]),
    ),
  );
}

function identite(dossier: DossierComplet): string[] {
  return [dossier.stagiaire_nom, dossier.entreprise, dossier.intitule].filter((ligne) => ligne.trim() !== "");
}

function objectifsDe(bloc: string): string[] {
  const debut = bloc.search(/\bobjectifs?\b/i);
  if (debut < 0) return [];
  const lignes: string[] = [];
  for (const ligne of bloc.slice(debut).split(/\n/).slice(1)) {
    if (/^(contenu|coaching|module\s+\d+)/i.test(ligne.trim())) break;
    const propre = ligne.replace(/^[-–—]\s*/, "").replace(/\s+/g, " ").trim();
    if (propre && !/^objectifs?$/i.test(propre)) lignes.push(propre);
  }
  return lignes;
}
