export type Moment = "avant" | "pendant" | "apres";

export type PieceJointe = {
  code: string;
  libelle: string;
  fichier: string;
};

export type SelectionCourrier = {
  joints: PieceJointe[];
  attente: string[];
};

const TITRES: Record<Moment, string> = {
  avant: "Avant la formation",
  pendant: "Pendant la formation",
  apres: "Après la formation",
};

const LIBELLES: Record<string, string> = {
  devis: "Devis",
  analyse: "Analyse du besoin",
  positionnement: "Positionnement",
  convention: "Convention",
  programme: "Programme",
  reglement: "Règlement intérieur",
  convocation: "Convocation",
  emargement: "Émargement",
  suivi: "Suivi du e-learning",
  qcm: "Évaluation de sortie",
  attestation: "Attestation",
  facture: "Facture",
};

const AVANT = ["devis", "analyse", "positionnement", "convention", "programme", "reglement"] as const;

export function momentConnu(valeur: string): valeur is Moment {
  return valeur === "avant" || valeur === "pendant" || valeur === "apres";
}

export type LigneCatalogue = {
  code: string;
  libelle: string;
  motif: string;
  presente: boolean;
};

export function titreMoment(moment: Moment): string {
  return TITRES[moment];
}

export function catalogueCourrier(entree: {
  moment: Moment;
  heuresElearning: number;
  convocationAutorisee: boolean;
  attestationAutorisee: boolean;
  attestationTenue: boolean;
  presents: ReadonlySet<string>;
}): LigneCatalogue[] {
  return lignes(entree).map((ligne) => ({
    code: ligne.code,
    libelle: ligne.libelle,
    motif: ligne.motif,
    presente: entree.presents.has(ligne.code),
  }));
}

export function selectionCourrier(entree: {
  moment: Moment;
  heuresElearning: number;
  convocationAutorisee: boolean;
  attestationAutorisee: boolean;
  attestationTenue: boolean;
  presents: ReadonlySet<string>;
}): SelectionCourrier {
  const joints: PieceJointe[] = [];
  const attente: string[] = [];
  for (const ligne of catalogueCourrier(entree)) {
    if (ligne.motif) {
      attente.push(ligne.motif);
      continue;
    }
    if (!ligne.presente) {
      attente.push(ligne.libelle);
      continue;
    }
    joints.push({ code: ligne.code, libelle: ligne.libelle, fichier: `${ligne.libelle}.pdf` });
  }
  return { joints, attente };
}

export function lettreCourrier(entree: {
  nom: string;
  intitule: string;
  moment: Moment;
  joints: readonly string[];
  attente: readonly string[];
}): { sujet: string; texte: string } {
  const quand = TITRES[entree.moment];
  const sujet = `${quand} — ${entree.intitule}`.slice(0, 200);
  const blocs = [
    `Bonjour ${entree.nom},`,
    "",
    `${quand}, pour « ${entree.intitule} ».`,
    "",
    entree.joints.length > 0 ? `Pièces jointes :\n${puces(entree.joints)}` : "Pas de pièce jointe.",
  ];
  if (entree.attente.length > 0) blocs.push("", `En attente :\n${puces(entree.attente)}`);
  blocs.push("", "deter-mi.net");
  return { sujet, texte: blocs.join("\n") };
}

export function messagePage(email: string, joints: readonly string[], attente: readonly string[], laissees: readonly string[] = []): string {
  const suite = attente.length > 0 ? ` En attente : ${attente.join(", ")}.` : "";
  const cote = laissees.length > 0 ? ` Laissées de côté : ${laissees.join(", ")}.` : "";
  if (joints.length === 0) return `Rien à envoyer.${suite}${cote}`;
  return `Envoyé à ${email}. Pièces jointes : ${joints.join(", ")}.${suite}${cote}`;
}

export function inclureSiCochee(selection: SelectionCourrier, code: string, cochee: boolean, presente: boolean): SelectionCourrier {
  if (!cochee || !presente || selection.joints.some((piece) => piece.code === code)) return selection;
  const libelle = LIBELLES[code] ?? code;
  return {
    joints: [...selection.joints, { code, libelle, fichier: `${libelle}.pdf` }],
    attente: selection.attente.filter((ligne) => ligne !== libelle && !ligne.startsWith(`${libelle},`) && !ligne.startsWith(`${libelle} `)),
  };
}

export function attenteCochee(attente: readonly string[], coches: ReadonlySet<string>): string[] {
  return attente.filter((ligne) => {
    const code = Object.entries(LIBELLES).find(
      ([, libelle]) => ligne === libelle || ligne.startsWith(`${libelle},`) || ligne.startsWith(`${libelle} `),
    )?.[0];
    return !code || coches.has(code);
  });
}

export function emailAdmissible(valeur: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valeur.trim());
}

export function retenirCible(valeur: string, versions: readonly number[], signe: boolean): number | "signe" | null {
  if (valeur === "signe" && signe) return "signe";
  if (/^\d+$/.test(valeur)) {
    const version = Number(valeur);
    if (versions.includes(version)) return version;
  }
  if (versions.length > 0) return Math.max(...versions);
  return signe ? "signe" : null;
}

export function etiquetteEnvoi(libelle: string, cible: number | "signe" | null): string {
  if (cible === "signe") return `${libelle} signé`;
  if (typeof cible === "number") return `${libelle} v${cible}`;
  return libelle;
}

function lignes(entree: {
  moment: Moment;
  heuresElearning: number;
  convocationAutorisee: boolean;
  attestationAutorisee: boolean;
  attestationTenue: boolean;
}): { code: string; libelle: string; motif: string }[] {
  if (entree.moment === "avant") {
    return [
      ...AVANT.map((code) => ligne(code, "")),
      ligne(
        "convocation",
        entree.convocationAutorisee ? "" : "Convocation, quand le positionnement et le règlement sont renvoyés",
      ),
    ];
  }
  if (entree.moment === "pendant") {
    const suite = [ligne("emargement", "")];
    if (entree.heuresElearning > 0) suite.push(ligne("suivi", ""));
    return suite;
  }
  return [
    ligne("qcm", ""),
    ligne("attestation", entree.attestationAutorisee ? "" : "Attestation, quand les retours sont là"),
    ligne("facture", entree.attestationTenue ? "" : "Facture, après l'attestation"),
  ];
}

function ligne(code: string, motif: string): { code: string; libelle: string; motif: string } {
  return { code, libelle: LIBELLES[code] ?? code, motif };
}

function puces(lignesTexte: readonly string[]): string {
  return lignesTexte.map((ligneTexte) => `- ${ligneTexte}`).join("\n");
}
