export const ACTIONS_PDF = [
  "generer_devis",
  "generer_convention",
  "generer_attestation",
  "generer_facture",
  "generer_facture_acquittee",
] as const;

export const CHAMPS_ORGANISME = [
  "nom",
  "siret",
  "nda",
  "adresse",
  "code_postal",
  "ville",
  "email",
] as const;

export type ActionPdf = (typeof ACTIONS_PDF)[number];

export type Action = ActionPdf | "envoyer_convocation" | "clore_financeur";

export type VerrouCode =
  | "organisme_incomplet"
  | "convention_sans_analyse"
  | "convocation_sans_positionnement"
  | "convocation_sans_reglement"
  | "attestation_sans_qcm_sortie"
  | "attestation_sans_suivi"
  | "attestation_sans_emargement"
  | "facture_acquittee_sans_facture"
  | "cloture_sans_exigences";

export type ReglagesOrganisme = {
  nom: string;
  siret: string;
  nda: string;
  adresse: string;
  code_postal: string;
  ville: string;
  email: string;
  derogation_autorisee: 0 | 1;
};

export type Dossier = {
  id: string;
  financeur: string;
  heures_elearning: number;
};

export type Seance = {
  id: string;
  dossier_id: string;
  jour: string;
  statut: "prevue" | "tenue" | "reportee";
  remplacee_par: string | null;
};

export type Retour = {
  type: string;
  seance_id: string;
};

export type StatutPiece = "attente" | "prete" | "envoyee" | "revenue" | "annulee";

export type Piece = {
  code: string;
  statut: StatutPiece;
};

export type Exigence = {
  financeur: string;
  code_piece: string;
  statut_requis: "prete" | "revenue";
};

export type Derogation = {
  verrou_code: string;
  effet: "levee" | "retablie";
  creee_le: string;
};

export type Etat = {
  aujourdhui: string;
  reglages: ReglagesOrganisme;
  dossier: Dossier;
  seances: readonly Seance[];
  retours: readonly Retour[];
  pieces: readonly Piece[];
  exigences: readonly Exigence[];
  derogations: readonly Derogation[];
};

export type VerrouJuge = {
  code: VerrouCode;
  tenu: boolean;
  effectif: boolean;
};

export type Jugement = {
  ok: boolean;
  verrous: VerrouJuge[];
};

const PDF = new Set<Action>(ACTIONS_PDF);

const DEROGEABLES = new Set<VerrouCode>([
  "convention_sans_analyse",
  "convocation_sans_positionnement",
  "convocation_sans_reglement",
  "attestation_sans_qcm_sortie",
  "attestation_sans_suivi",
  "attestation_sans_emargement",
  "facture_acquittee_sans_facture",
  "cloture_sans_exigences",
]);

export function derogationEffective(
  derogationAutorisee: 0 | 1,
  derogable: boolean,
  lignes: readonly Derogation[],
): boolean {
  if (derogationAutorisee !== 1 || !derogable) return false;
  let derniere: Derogation | undefined;
  for (const ligne of lignes) {
    if (!derniere || ligne.creee_le >= derniere.creee_le) derniere = ligne;
  }
  return derniere?.effet === "levee";
}

export function juger(etat: Etat, action: Action): Jugement {
  const codes = codesPour(action);
  const verrous = codes.map((code) => jugerUn(etat, code));
  return { ok: verrous.every((verrou) => !verrou.effectif), verrous };
}

function codesPour(action: Action): VerrouCode[] {
  const codes: VerrouCode[] = [];
  if (PDF.has(action)) codes.push("organisme_incomplet");
  if (action === "generer_convention") codes.push("convention_sans_analyse");
  if (action === "envoyer_convocation") {
    codes.push("convocation_sans_positionnement", "convocation_sans_reglement");
  }
  if (action === "generer_attestation") {
    codes.push(
      "attestation_sans_qcm_sortie",
      "attestation_sans_suivi",
      "attestation_sans_emargement",
    );
  }
  if (action === "generer_facture_acquittee") codes.push("facture_acquittee_sans_facture");
  if (action === "clore_financeur") codes.push("cloture_sans_exigences");
  return codes;
}

function jugerUn(etat: Etat, code: VerrouCode): VerrouJuge {
  const tenu = condition(etat, code);
  const levee = derogationEffective(
    etat.reglages.derogation_autorisee,
    DEROGEABLES.has(code),
    etat.derogations.filter((ligne) => ligne.verrou_code === code),
  );
  return { code, tenu, effectif: tenu && !levee };
}

function condition(etat: Etat, code: VerrouCode): boolean {
  switch (code) {
    case "organisme_incomplet":
      return CHAMPS_ORGANISME.some((champ) => etat.reglages[champ].trim() === "");
    case "convention_sans_analyse":
      return !aUnRetour(etat, "analyse", "");
    case "convocation_sans_positionnement":
      return !aUnRetour(etat, "positionnement", "");
    case "convocation_sans_reglement":
      return !aUnRetour(etat, "reglement", "");
    case "attestation_sans_qcm_sortie":
      return !aUnRetour(etat, "qcm_sortie", "");
    case "attestation_sans_suivi":
      return etat.dossier.heures_elearning > 0 && !aUnRetour(etat, "suivi_elearning", "");
    case "attestation_sans_emargement":
      return seancesDuDossier(etat).some((seance) => seanceBloque(etat, seance));
    case "facture_acquittee_sans_facture":
      return !etat.pieces.some(
        (piece) =>
          piece.code === "facture" &&
          (piece.statut === "prete" || piece.statut === "envoyee" || piece.statut === "revenue"),
      );
    case "cloture_sans_exigences":
      return clotureBloquee(etat);
  }
}

function aUnRetour(etat: Etat, type: string, seanceId: string): boolean {
  return etat.retours.some((retour) => retour.type === type && retour.seance_id === seanceId);
}

function seancesDuDossier(etat: Etat): Seance[] {
  return etat.seances.filter((seance) => seance.dossier_id === etat.dossier.id);
}

function seanceBloque(etat: Etat, seance: Seance): boolean {
  const signe = aUnRetour(etat, "emargement", seance.id);
  if (seance.statut === "tenue") return !signe;
  if (seance.statut === "prevue") return seance.jour <= etat.aujourdhui && !signe;
  const cible = seancesDuDossier(etat).find((autre) => autre.id === seance.remplacee_par);
  return !cible;
}

function clotureBloquee(etat: Etat): boolean {
  const dues = etat.exigences.filter((exigence) => exigence.financeur === etat.dossier.financeur);
  if (dues.length === 0) return true;
  return dues.some((exigence) => {
    const pieces = etat.pieces.filter((piece) => piece.code === exigence.code_piece);
    return pieces.length === 0 || pieces.some((piece) => piece.statut !== exigence.statut_requis);
  });
}
