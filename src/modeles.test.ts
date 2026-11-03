import { describe, expect, it } from "vitest";
import { modulesDuProgramme, seancesDuProgramme } from "./modeles.ts";

const PROGRAMME = `
Module 1 Fondamentaux 10h e-learning
Module 1 – Fondamentaux (10h e-learning)
Objectifs
- Comprendre les enjeux de la vente en ligne
- Définir son positionnement
Contenu
Les modèles de vente
Séance 1 (2h) : Bilan de l'installation
Module 2 Créer sa boutique 25h e-learning
Séance 2 (2h) : Revue du catalogue
`;

describe("programme", () => {
  it("relève les séances et les objectifs écrits", () => {
    expect(seancesDuProgramme(PROGRAMME).map((seance) => seance.titre)).toEqual(["Séance 1", "Séance 2"]);
    const modules = modulesDuProgramme(PROGRAMME);
    expect(modules).toHaveLength(2);
    expect(modules[0]?.objectifs).toContain("Comprendre les enjeux de la vente en ligne");
    expect(modules[0]?.heures).toContain("10h");
  });
});
