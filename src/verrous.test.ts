import { describe, expect, it } from "vitest";
import {
  type Derogation,
  type Etat,
  type Exigence,
  type Piece,
  type ReglagesOrganisme,
  type Seance,
  derogationEffective,
  juger,
} from "./verrous";

const REGLAGES: ReglagesOrganisme = {
  nom: "Thomas LLOANCY",
  siret: "85186245800029",
  nda: "76660263766",
  adresse: "8 rue du Madres",
  code_postal: "66680",
  ville: "Canohès",
  email: "tlloancy@deter-mi.net",
  derogation_autorisee: 0,
};

const AGEFICE: Exigence[] = [
  { financeur: "AGEFICE", code_piece: "convention", statut_requis: "revenue" },
  { financeur: "AGEFICE", code_piece: "programme", statut_requis: "prete" },
  { financeur: "AGEFICE", code_piece: "emargement", statut_requis: "revenue" },
  { financeur: "AGEFICE", code_piece: "attestation", statut_requis: "prete" },
  { financeur: "AGEFICE", code_piece: "facture_acquittee", statut_requis: "prete" },
];

function etat(partiel: {
  aujourdhui?: string;
  reglages?: Partial<ReglagesOrganisme>;
  financeur?: string;
  heures_elearning?: number;
  seances?: Seance[];
  retours?: Etat["retours"];
  pieces?: Piece[];
  exigences?: Exigence[];
  derogations?: Derogation[];
} = {}): Etat {
  return {
    aujourdhui: partiel.aujourdhui ?? "2026-11-10",
    reglages: { ...REGLAGES, ...partiel.reglages },
    dossier: {
      id: "d1",
      financeur: partiel.financeur ?? "AGEFICE",
      heures_elearning: partiel.heures_elearning ?? 90,
    },
    seances: partiel.seances ?? [],
    retours: partiel.retours ?? [],
    pieces: partiel.pieces ?? [],
    exigences: partiel.exigences ?? [],
    derogations: partiel.derogations ?? [],
  };
}

function seance(partiel: Partial<Seance> & Pick<Seance, "id" | "statut" | "jour">): Seance {
  return {
    dossier_id: "d1",
    remplacee_par: null,
    ...partiel,
  };
}

function leve(code: Derogation["verrou_code"], creee_le: string, effet: Derogation["effet"] = "levee"): Derogation {
  return { verrou_code: code, effet, creee_le };
}

describe("organisme_incomplet", () => {
  it("bloque generer_devis si l'adresse est vide", () => {
    const jugement = juger(etat({ reglages: { adresse: "  " } }), "generer_devis");
    expect(jugement.ok).toBe(false);
    expect(jugement.verrous).toEqual([
      { code: "organisme_incomplet", tenu: true, effectif: true },
    ]);
  });

  it("bloque generer_devis si le SIRET est vide", () => {
    const jugement = juger(etat({ reglages: { siret: "" } }), "generer_devis");
    expect(jugement.ok).toBe(false);
    expect(jugement.verrous[0]).toMatchObject({ code: "organisme_incomplet", tenu: true });
  });

  it("lache quand les sept champs sont remplis", () => {
    const jugement = juger(etat(), "generer_devis");
    expect(jugement.ok).toBe(true);
    expect(jugement.verrous[0]).toEqual({
      code: "organisme_incomplet",
      tenu: false,
      effectif: false,
    });
  });

  it("une derogation ne le leve pas, meme si l'interrupteur vaut 1", () => {
    const jugement = juger(
      etat({
        reglages: { adresse: "", derogation_autorisee: 1 },
        derogations: [leve("organisme_incomplet", "2026-11-03T00:00:00.000Z")],
      }),
      "generer_convention",
    );
    expect(jugement.verrous.find((verrou) => verrou.code === "organisme_incomplet")).toEqual({
      code: "organisme_incomplet",
      tenu: true,
      effectif: true,
    });
    expect(jugement.ok).toBe(false);
  });

  it("ne bloque pas la convocation", () => {
    const jugement = juger(
      etat({
        reglages: { adresse: "" },
        retours: [
          { type: "positionnement", seance_id: "" },
          { type: "reglement", seance_id: "" },
        ],
      }),
      "envoyer_convocation",
    );
    expect(jugement.verrous.map((verrou) => verrou.code)).not.toContain("organisme_incomplet");
    expect(jugement.ok).toBe(true);
  });
});

describe("convention_sans_analyse", () => {
  it("bloque tant qu'aucun retour analyse n'existe", () => {
    const jugement = juger(etat(), "generer_convention");
    expect(jugement.ok).toBe(false);
    expect(jugement.verrous).toContainEqual({
      code: "convention_sans_analyse",
      tenu: true,
      effectif: true,
    });
  });

  it("lache des qu'une version analyse existe", () => {
    const jugement = juger(
      etat({ retours: [{ type: "analyse", seance_id: "" }] }),
      "generer_convention",
    );
    expect(jugement.ok).toBe(true);
    expect(jugement.verrous).toContainEqual({
      code: "convention_sans_analyse",
      tenu: false,
      effectif: false,
    });
  });

  it("une derogation levee est honoree si l'interrupteur vaut 1", () => {
    const jugement = juger(
      etat({
        reglages: { derogation_autorisee: 1 },
        derogations: [leve("convention_sans_analyse", "2026-11-03T00:00:00.000Z")],
      }),
      "generer_convention",
    );
    expect(jugement.verrous).toContainEqual({
      code: "convention_sans_analyse",
      tenu: true,
      effectif: false,
    });
    expect(jugement.ok).toBe(true);
  });

  it("une derogation levee est ignoree si l'interrupteur vaut 0", () => {
    const jugement = juger(
      etat({
        derogations: [leve("convention_sans_analyse", "2026-11-03T00:00:00.000Z")],
      }),
      "generer_convention",
    );
    expect(jugement.ok).toBe(false);
    expect(jugement.verrous).toContainEqual({
      code: "convention_sans_analyse",
      tenu: true,
      effectif: true,
    });
  });

  it("la derniere ligne gagne : retablie referme le verrou", () => {
    const jugement = juger(
      etat({
        reglages: { derogation_autorisee: 1 },
        derogations: [
          leve("convention_sans_analyse", "2026-11-03T00:00:00.000Z", "levee"),
          leve("convention_sans_analyse", "2026-11-04T00:00:00.000Z", "retablie"),
        ],
      }),
      "generer_convention",
    );
    expect(jugement.ok).toBe(false);
  });
});

describe("convocation_sans_positionnement", () => {
  const reglement = { type: "reglement", seance_id: "" };

  it("bloque sans retour positionnement", () => {
    const jugement = juger(etat({ retours: [reglement] }), "envoyer_convocation");
    expect(jugement.ok).toBe(false);
    expect(jugement.verrous).toContainEqual({
      code: "convocation_sans_positionnement",
      tenu: true,
      effectif: true,
    });
  });

  it("lache avec un retour positionnement et le reglement", () => {
    const jugement = juger(
      etat({
        retours: [reglement, { type: "positionnement", seance_id: "" }],
      }),
      "envoyer_convocation",
    );
    expect(jugement.ok).toBe(true);
  });

  it("une derogation de positionnement ne leve pas le reglement", () => {
    const jugement = juger(
      etat({
        reglages: { derogation_autorisee: 1 },
        derogations: [leve("convocation_sans_positionnement", "2026-11-03T00:00:00.000Z")],
      }),
      "envoyer_convocation",
    );
    expect(jugement.ok).toBe(false);
    expect(jugement.verrous).toContainEqual({
      code: "convocation_sans_positionnement",
      tenu: true,
      effectif: false,
    });
    expect(jugement.verrous).toContainEqual({
      code: "convocation_sans_reglement",
      tenu: true,
      effectif: true,
    });
  });

  it("ignore la derogation si l'interrupteur vaut 0", () => {
    const jugement = juger(
      etat({
        retours: [reglement],
        derogations: [leve("convocation_sans_positionnement", "2026-11-03T00:00:00.000Z")],
      }),
      "envoyer_convocation",
    );
    expect(jugement.verrous).toContainEqual({
      code: "convocation_sans_positionnement",
      tenu: true,
      effectif: true,
    });
  });
});

describe("convocation_sans_reglement", () => {
  const positionnement = { type: "positionnement", seance_id: "" };

  it("bloque sans accusé de reglement", () => {
    const jugement = juger(etat({ retours: [positionnement] }), "envoyer_convocation");
    expect(jugement.ok).toBe(false);
    expect(jugement.verrous).toContainEqual({
      code: "convocation_sans_reglement",
      tenu: true,
      effectif: true,
    });
  });

  it("lache avec l'accusé et le positionnement", () => {
    const jugement = juger(
      etat({ retours: [positionnement, { type: "reglement", seance_id: "" }] }),
      "envoyer_convocation",
    );
    expect(jugement.ok).toBe(true);
  });

  it("honore la derogation si l'interrupteur vaut 1 et le positionnement est la", () => {
    const jugement = juger(
      etat({
        reglages: { derogation_autorisee: 1 },
        retours: [positionnement],
        derogations: [leve("convocation_sans_reglement", "2026-11-03T00:00:00.000Z")],
      }),
      "envoyer_convocation",
    );
    expect(jugement.ok).toBe(true);
  });

  it("ignore la derogation si l'interrupteur vaut 0", () => {
    const jugement = juger(
      etat({
        retours: [positionnement],
        derogations: [leve("convocation_sans_reglement", "2026-11-03T00:00:00.000Z")],
      }),
      "envoyer_convocation",
    );
    expect(jugement.ok).toBe(false);
  });
});

function dossierPretPourAttestation(partiel: {
  heures_elearning?: number;
  seances?: Seance[];
  retours?: Etat["retours"];
  derogations?: Derogation[];
  derogation_autorisee?: 0 | 1;
  aujourdhui?: string;
} = {}): Etat {
  return etat({
    aujourdhui: partiel.aujourdhui,
    heures_elearning: partiel.heures_elearning,
    seances: partiel.seances,
    derogations: partiel.derogations,
    reglages: { derogation_autorisee: partiel.derogation_autorisee ?? 0 },
    retours: [
      { type: "qcm_sortie", seance_id: "" },
      { type: "suivi_elearning", seance_id: "" },
      ...(partiel.retours ?? []),
    ],
  });
}

describe("attestation_sans_qcm_sortie", () => {
  it("bloque sans qcm de sortie", () => {
    const jugement = juger(
      etat({
        heures_elearning: 0,
        retours: [],
      }),
      "generer_attestation",
    );
    expect(jugement.verrous).toContainEqual({
      code: "attestation_sans_qcm_sortie",
      tenu: true,
      effectif: true,
    });
    expect(jugement.ok).toBe(false);
  });

  it("lache avec un qcm de sortie, sans e-learning ni seance", () => {
    const jugement = juger(
      etat({
        heures_elearning: 0,
        retours: [{ type: "qcm_sortie", seance_id: "" }],
      }),
      "generer_attestation",
    );
    expect(jugement.ok).toBe(true);
  });

  it("honore la derogation si l'interrupteur vaut 1", () => {
    const jugement = juger(
      etat({
        heures_elearning: 0,
        reglages: { derogation_autorisee: 1 },
        derogations: [leve("attestation_sans_qcm_sortie", "2026-11-03T00:00:00.000Z")],
      }),
      "generer_attestation",
    );
    expect(jugement.verrous).toContainEqual({
      code: "attestation_sans_qcm_sortie",
      tenu: true,
      effectif: false,
    });
    expect(jugement.ok).toBe(true);
  });

  it("ignore la derogation si l'interrupteur vaut 0", () => {
    const jugement = juger(
      etat({
        heures_elearning: 0,
        derogations: [leve("attestation_sans_qcm_sortie", "2026-11-03T00:00:00.000Z")],
      }),
      "generer_attestation",
    );
    expect(jugement.ok).toBe(false);
  });
});

describe("attestation_sans_suivi", () => {
  it("bloque si des heures d'e-learning n'ont pas de suivi", () => {
    const jugement = juger(
      etat({
        retours: [{ type: "qcm_sortie", seance_id: "" }],
      }),
      "generer_attestation",
    );
    expect(jugement.verrous).toContainEqual({
      code: "attestation_sans_suivi",
      tenu: true,
      effectif: true,
    });
  });

  it("lache quand le suivi est revenu", () => {
    const jugement = juger(dossierPretPourAttestation(), "generer_attestation");
    expect(jugement.verrous).toContainEqual({
      code: "attestation_sans_suivi",
      tenu: false,
      effectif: false,
    });
    expect(jugement.ok).toBe(true);
  });

  it("ne tient pas quand les heures d'e-learning sont a zero", () => {
    const jugement = juger(
      etat({
        heures_elearning: 0,
        retours: [{ type: "qcm_sortie", seance_id: "" }],
      }),
      "generer_attestation",
    );
    expect(jugement.verrous).toContainEqual({
      code: "attestation_sans_suivi",
      tenu: false,
      effectif: false,
    });
    expect(jugement.ok).toBe(true);
  });

  it("honore la derogation si l'interrupteur vaut 1", () => {
    const jugement = juger(
      etat({
        reglages: { derogation_autorisee: 1 },
        retours: [{ type: "qcm_sortie", seance_id: "" }],
        derogations: [leve("attestation_sans_suivi", "2026-11-03T00:00:00.000Z")],
      }),
      "generer_attestation",
    );
    expect(jugement.ok).toBe(true);
  });

  it("ignore la derogation si l'interrupteur vaut 0", () => {
    const jugement = juger(
      etat({
        retours: [{ type: "qcm_sortie", seance_id: "" }],
        derogations: [leve("attestation_sans_suivi", "2026-11-03T00:00:00.000Z")],
      }),
      "generer_attestation",
    );
    expect(jugement.verrous).toContainEqual({
      code: "attestation_sans_suivi",
      tenu: true,
      effectif: true,
    });
  });
});

describe("attestation_sans_emargement", () => {
  it("bloque une seance prevue echue sans retour", () => {
    const jugement = juger(
      dossierPretPourAttestation({
        seances: [seance({ id: "s1", statut: "prevue", jour: "2026-11-10" })],
      }),
      "generer_attestation",
    );
    expect(jugement.verrous).toContainEqual({
      code: "attestation_sans_emargement",
      tenu: true,
      effectif: true,
    });
  });

  it("ne bloque pas une seance prevue future", () => {
    const jugement = juger(
      dossierPretPourAttestation({
        seances: [seance({ id: "s1", statut: "prevue", jour: "2026-11-11" })],
      }),
      "generer_attestation",
    );
    expect(jugement.verrous).toContainEqual({
      code: "attestation_sans_emargement",
      tenu: false,
      effectif: false,
    });
    expect(jugement.ok).toBe(true);
  });

  it("bloque une seance tenue sans emargement, meme future", () => {
    const jugement = juger(
      dossierPretPourAttestation({
        seances: [seance({ id: "s1", statut: "tenue", jour: "2026-12-01" })],
      }),
      "generer_attestation",
    );
    expect(jugement.verrous).toContainEqual({
      code: "attestation_sans_emargement",
      tenu: true,
      effectif: true,
    });
  });

  it("ne bloque pas une seance tenue qui a un retour", () => {
    const jugement = juger(
      dossierPretPourAttestation({
        seances: [seance({ id: "s1", statut: "tenue", jour: "2026-11-01" })],
        retours: [{ type: "emargement", seance_id: "s1" }],
      }),
      "generer_attestation",
    );
    expect(jugement.ok).toBe(true);
  });

  it("bloque une seance reportee sans seance de remplacement", () => {
    const jugement = juger(
      dossierPretPourAttestation({
        seances: [seance({ id: "s1", statut: "reportee", jour: "2026-11-01" })],
      }),
      "generer_attestation",
    );
    expect(jugement.verrous).toContainEqual({
      code: "attestation_sans_emargement",
      tenu: true,
      effectif: true,
    });
  });

  it("ne bloque pas l'ancienne seance si le remplacement est encore futur", () => {
    const jugement = juger(
      dossierPretPourAttestation({
        seances: [
          seance({ id: "s1", statut: "reportee", jour: "2026-11-01", remplacee_par: "s2" }),
          seance({ id: "s2", statut: "prevue", jour: "2026-11-20" }),
        ],
      }),
      "generer_attestation",
    );
    expect(jugement.ok).toBe(true);
  });

  it("bloque si le remplacement echu n'a pas d'emargement", () => {
    const jugement = juger(
      dossierPretPourAttestation({
        seances: [
          seance({ id: "s1", statut: "reportee", jour: "2026-11-01", remplacee_par: "s2" }),
          seance({ id: "s2", statut: "prevue", jour: "2026-11-10" }),
        ],
      }),
      "generer_attestation",
    );
    expect(jugement.verrous).toContainEqual({
      code: "attestation_sans_emargement",
      tenu: true,
      effectif: true,
    });
  });

  it("ignore un remplacement qui n'est pas une seance du dossier", () => {
    const jugement = juger(
      dossierPretPourAttestation({
        seances: [
          seance({ id: "s1", statut: "reportee", jour: "2026-11-01", remplacee_par: "ailleurs" }),
          seance({ id: "ailleurs", statut: "prevue", jour: "2026-12-01", dossier_id: "d2" }),
        ],
      }),
      "generer_attestation",
    );
    expect(jugement.verrous).toContainEqual({
      code: "attestation_sans_emargement",
      tenu: true,
      effectif: true,
    });
  });

  it("honore la derogation si l'interrupteur vaut 1", () => {
    const jugement = juger(
      dossierPretPourAttestation({
        derogation_autorisee: 1,
        seances: [seance({ id: "s1", statut: "tenue", jour: "2026-11-01" })],
        derogations: [leve("attestation_sans_emargement", "2026-11-03T00:00:00.000Z")],
      }),
      "generer_attestation",
    );
    expect(jugement.ok).toBe(true);
  });

  it("ignore la derogation si l'interrupteur vaut 0", () => {
    const jugement = juger(
      dossierPretPourAttestation({
        seances: [seance({ id: "s1", statut: "tenue", jour: "2026-11-01" })],
        derogations: [leve("attestation_sans_emargement", "2026-11-03T00:00:00.000Z")],
      }),
      "generer_attestation",
    );
    expect(jugement.ok).toBe(false);
  });
});

describe("facture_acquittee_sans_facture", () => {
  it.each(["attente", "annulee"] as const)("bloque si la facture est %s", (statut) => {
    const jugement = juger(
      etat({ pieces: [{ code: "facture", statut }] }),
      "generer_facture_acquittee",
    );
    expect(jugement.verrous).toContainEqual({
      code: "facture_acquittee_sans_facture",
      tenu: true,
      effectif: true,
    });
  });

  it("bloque s'il n'y a pas de facture", () => {
    const jugement = juger(etat(), "generer_facture_acquittee");
    expect(jugement.ok).toBe(false);
  });

  it.each(["prete", "envoyee", "revenue"] as const)("lache si la facture est %s", (statut) => {
    const jugement = juger(
      etat({ pieces: [{ code: "facture", statut }] }),
      "generer_facture_acquittee",
    );
    expect(jugement.ok).toBe(true);
  });

  it("honore la derogation si l'interrupteur vaut 1", () => {
    const jugement = juger(
      etat({
        reglages: { derogation_autorisee: 1 },
        derogations: [leve("facture_acquittee_sans_facture", "2026-11-03T00:00:00.000Z")],
      }),
      "generer_facture_acquittee",
    );
    expect(jugement.ok).toBe(true);
  });

  it("ignore la derogation si l'interrupteur vaut 0", () => {
    const jugement = juger(
      etat({
        derogations: [leve("facture_acquittee_sans_facture", "2026-11-03T00:00:00.000Z")],
      }),
      "generer_facture_acquittee",
    );
    expect(jugement.ok).toBe(false);
  });
});

describe("cloture_sans_exigences", () => {
  const piecesOk: Piece[] = [
    { code: "convention", statut: "revenue" },
    { code: "programme", statut: "prete" },
    { code: "emargement", statut: "revenue" },
    { code: "emargement", statut: "revenue" },
    { code: "attestation", statut: "prete" },
    { code: "facture_acquittee", statut: "prete" },
  ];

  it("bloque FIF PL tant qu'aucune exigence n'est enregistree", () => {
    const jugement = juger(
      etat({ financeur: "FIFPL", pieces: piecesOk, exigences: AGEFICE }),
      "clore_financeur",
    );
    expect(jugement.ok).toBe(false);
    expect(jugement.verrous).toContainEqual({
      code: "cloture_sans_exigences",
      tenu: true,
      effectif: true,
    });
  });

  it("lache AGEFICE quand chaque code est au statut demande", () => {
    const jugement = juger(
      etat({ pieces: piecesOk, exigences: AGEFICE }),
      "clore_financeur",
    );
    expect(jugement.ok).toBe(true);
  });

  it("bloque si un emargement n'est pas revenu", () => {
    const jugement = juger(
      etat({
        exigences: AGEFICE,
        pieces: [
          ...piecesOk.filter((piece) => piece.code !== "emargement"),
          { code: "emargement", statut: "revenue" },
          { code: "emargement", statut: "envoyee" },
        ],
      }),
      "clore_financeur",
    );
    expect(jugement.ok).toBe(false);
  });

  it("bloque si un code exige n'a aucune piece", () => {
    const jugement = juger(
      etat({
        exigences: AGEFICE,
        pieces: piecesOk.filter((piece) => piece.code !== "programme"),
      }),
      "clore_financeur",
    );
    expect(jugement.ok).toBe(false);
  });

  it("une convention seulement prete ne suffit pas", () => {
    const jugement = juger(
      etat({
        exigences: AGEFICE,
        pieces: piecesOk.map((piece) =>
          piece.code === "convention" ? { ...piece, statut: "prete" as const } : piece,
        ),
      }),
      "clore_financeur",
    );
    expect(jugement.ok).toBe(false);
  });

  it("honore la derogation si l'interrupteur vaut 1", () => {
    const jugement = juger(
      etat({
        financeur: "FIFPL",
        reglages: { derogation_autorisee: 1 },
        derogations: [leve("cloture_sans_exigences", "2026-11-03T00:00:00.000Z")],
      }),
      "clore_financeur",
    );
    expect(jugement.ok).toBe(true);
  });

  it("ignore la derogation si l'interrupteur vaut 0", () => {
    const jugement = juger(
      etat({
        financeur: "FIFPL",
        derogations: [leve("cloture_sans_exigences", "2026-11-03T00:00:00.000Z")],
      }),
      "clore_financeur",
    );
    expect(jugement.ok).toBe(false);
  });
});

describe("derogationEffective", () => {
  it("reste faux pour un verrou non derogable", () => {
    expect(
      derogationEffective(1, false, [
        { verrou_code: "organisme_incomplet", effet: "levee", creee_le: "2026-11-03T00:00:00.000Z" },
      ]),
    ).toBe(false);
  });

  it("reste faux quand l'interrupteur vaut 0", () => {
    expect(
      derogationEffective(0, true, [
        { verrou_code: "convention_sans_analyse", effet: "levee", creee_le: "2026-11-03T00:00:00.000Z" },
      ]),
    ).toBe(false);
  });
});
