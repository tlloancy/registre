import { describe, expect, it } from "vitest";
import { attenteCochee, etiquetteEnvoi, inclureSiCochee, lettreCourrier, messagePage, retenirCible, selectionCourrier } from "./courrier.ts";

describe("courrier", () => {
  it("tient la convocation tant que les retours manquent", () => {
    const selection = selectionCourrier({
      moment: "avant",
      heuresElearning: 0,
      convocationAutorisee: false,
      attestationAutorisee: false,
      attestationTenue: false,
      presents: new Set(["devis", "analyse", "convocation"]),
    });
    expect(selection.joints.map((piece) => piece.code)).toEqual(["devis", "analyse"]);
    expect(selection.attente.join(" ")).toContain("positionnement et le règlement");
    expect(selection.joints.some((piece) => piece.code === "convocation")).toBe(false);
  });

  it("joint la convocation quand elle peut partir", () => {
    const selection = selectionCourrier({
      moment: "avant",
      heuresElearning: 0,
      convocationAutorisee: true,
      attestationAutorisee: false,
      attestationTenue: false,
      presents: new Set(["convocation"]),
    });
    expect(selection.joints.map((piece) => piece.fichier)).toContain("Convocation.pdf");
  });

  it("ajoute le suivi seulement s'il y a des heures à distance", () => {
    const sans = selectionCourrier({
      moment: "pendant",
      heuresElearning: 0,
      convocationAutorisee: false,
      attestationAutorisee: false,
      attestationTenue: false,
      presents: new Set(["emargement", "suivi"]),
    });
    expect(sans.joints.map((piece) => piece.code)).toEqual(["emargement"]);
    const avec = selectionCourrier({
      moment: "pendant",
      heuresElearning: 90,
      convocationAutorisee: false,
      attestationAutorisee: false,
      attestationTenue: false,
      presents: new Set(["emargement"]),
    });
    expect(avec.attente).toContain("Suivi du e-learning");
  });

  it("ajoute l'attestation puis la facture", () => {
    const tot = selectionCourrier({
      moment: "apres",
      heuresElearning: 0,
      convocationAutorisee: false,
      attestationAutorisee: false,
      attestationTenue: false,
      presents: new Set(["qcm", "attestation", "facture"]),
    });
    expect(tot.joints.map((piece) => piece.code)).toEqual(["qcm"]);
    expect(tot.attente.join(" ")).toContain("quand les retours sont là");
    expect(tot.attente.join(" ")).toContain("après l'attestation");
    const pret = selectionCourrier({
      moment: "apres",
      heuresElearning: 0,
      convocationAutorisee: false,
      attestationAutorisee: true,
      attestationTenue: true,
      presents: new Set(["qcm", "attestation", "facture"]),
    });
    expect(pret.joints.map((piece) => piece.code)).toEqual(["qcm", "attestation", "facture"]);
    expect(pret.attente).toEqual([]);
  });

  it("écrit la lettre et le message de la page", () => {
    const lettre = lettreCourrier({
      nom: "Camille MARTIN",
      intitule: "Administration Linux",
      moment: "avant",
      joints: ["Devis"],
      attente: ["Convocation"],
    });
    expect(lettre.sujet).toContain("Avant la formation");
    expect(lettre.texte).toContain("Pièces jointes :\n- Devis");
    expect(lettre.texte).toContain("En attente :\n- Convocation");
    expect(messagePage("camille@example.com", ["Devis"], ["Convocation"])).toBe(
      "Envoyé à camille@example.com. Pièces jointes : Devis. En attente : Convocation.",
    );
    expect(messagePage("camille@example.com", [], ["Convocation"])).toBe("Rien à envoyer. En attente : Convocation.");
  });

  it("retient la dernière version, ou le choix demandé", () => {
    expect(retenirCible("", [1, 2], true)).toBe(2);
    expect(retenirCible("1", [1, 2], true)).toBe(1);
    expect(retenirCible("signe", [1, 2], true)).toBe("signe");
    expect(retenirCible("9", [1], false)).toBe(1);
    expect(retenirCible("", [], true)).toBe("signe");
    expect(retenirCible("signe", [1], false)).toBe(1);
    expect(etiquetteEnvoi("Analyse du besoin", 2)).toBe("Analyse du besoin v2");
    expect(etiquetteEnvoi("Convention", "signe")).toBe("Convention signé");
    expect(attenteCochee(["Convocation, quand le positionnement et le règlement sont renvoyés", "Devis"], new Set(["devis"]))).toEqual(["Devis"]);
    const tenue = selectionCourrier({
      moment: "avant",
      heuresElearning: 0,
      convocationAutorisee: false,
      attestationAutorisee: false,
      attestationTenue: false,
      presents: new Set(["convocation", "devis"]),
    });
    const forcee = inclureSiCochee(tenue, "convocation", true, true);
    expect(forcee.joints.map((piece) => piece.fichier)).toEqual(["Devis.pdf", "Convocation.pdf"]);
    expect(forcee.attente.join(" ")).not.toContain("Convocation");
    expect(inclureSiCochee(tenue, "convocation", false, true)).toBe(tenue);
  });
});
