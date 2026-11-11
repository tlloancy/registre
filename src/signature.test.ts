import { describe, expect, it } from "vitest";
import { couvreDocument, estScan, estSignature } from "./signature.ts";

const LONG = "Analyse du besoin pour Atelier Nord, avec assez de texte pour rester un document et non un scan.";

describe("signature d'un dépôt", () => {
  it("prend un scan pour une signature", () => {
    expect(estScan("")).toBe(true);
    expect(estScan("scan sans texte")).toBe(true);
    expect(estSignature("scan sans texte", "aaa", [])).toBe(true);
  });

  it("reconnaît le même contenu quand l'empreinte change", () => {
    expect(estSignature(LONG, "bbb", [{ texte: LONG, empreinte: "aaa" }])).toBe(true);
    expect(estSignature(`${LONG}  `, "bbb", [{ texte: LONG.replace(/ /g, "   "), empreinte: "aaa" }])).toBe(true);
  });

  it("reconnaît une signature posée sur le même document", () => {
    const origine = [[{ texte: "Devis", x: 40, y: 800 }], [{ texte: "Total", x: 40, y: 100 }]];
    const signe = [
      [{ texte: "Devis", x: 40.2, y: 800 }],
      [{ texte: "Total", x: 40, y: 100 }, { texte: "Perpignan", x: 321, y: 525 }, { texte: "2026", x: 482, y: 523 }],
    ];
    expect(couvreDocument(origine, signe)).toBe(true);
    expect(couvreDocument(signe, origine)).toBe(false);
    expect(couvreDocument([[{ texte: "Autre", x: 40, y: 800 }]], signe)).toBe(false);
  });

  it("laisse un autre contenu en version", () => {
    expect(estScan(LONG)).toBe(false);
    expect(estSignature(LONG, "bbb", [{ texte: "Un programme tout autre, assez long pour ne pas être un scan.", empreinte: "aaa" }])).toBe(false);
    expect(estSignature(LONG, "aaa", [{ texte: LONG, empreinte: "aaa" }])).toBe(false);
  });
});
