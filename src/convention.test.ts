import { describe, expect, it } from "vitest";
import { lireConvention } from "./convention.ts";

const OLIVIER = `
CONVENTION DE FORMATION PROFESSIONNELLE
N° de convention : 2026-OLIVIER-001
1. L'organisme de formation
Mail : thomaslloancy@gmail.com
2. Le bénéficiaire / Entreprise
Raison sociale : EURL Fruits et Primeurs
Représentée par : Monsieur Olivier BENOISTE
Adresse : 21 Rue Pascal Marie Agasse, 66000 Perpignan
SIRET : 421 615 329 00032
IL A ÉTÉ CONVENU CE QUI SUIT :
Article 1 : Objet de la convention
conforme au devis n° D2600007 du 01 février 2026.
Article 2 : Intitulé de la formation
E-commerce : Vente Directe en Ligne – Lancez et développez votre boutique en ligne
(producteurs, artisans, entrepreneurs)
Article 3 : Objectifs et programme
Article 4 : Durée et modalités
Durée totale : 100 heures
- 10 heures de coaching individuel (visioconférence ou présentiel)
- 90 heures en e-learning autonome
Date de début : 13 mai 2026
Article 5 : Prix et règlement
Montant total : 2 500 € HT soit 3 000 € TTC
`;

describe("convention", () => {
  it("lit la convention d'Olivier et signale seulement les trous", () => {
    const lecture = lireConvention(OLIVIER, "tlloancy@deter-mi.net");
    expect(lecture.saisie.stagiaire_nom).toBe("Olivier BENOISTE");
    expect(lecture.saisie.entreprise).toBe("EURL Fruits et Primeurs");
    expect(lecture.saisie.entreprise_siret).toBe("42161532900032");
    expect(lecture.saisie.entreprise_adresse).toBe("21 Rue Pascal Marie Agasse, 66000 Perpignan");
    expect(lecture.saisie.intitule).toContain("E-commerce");
    expect(lecture.saisie.intitule).toContain("producteurs, artisans, entrepreneurs");
    expect(lecture.saisie.date_debut).toBe("2026-05-13");
    expect(lecture.saisie.date_fin).toBe("");
    expect(lecture.saisie.heures_total).toBe("100");
    expect(lecture.saisie.heures_coaching).toBe("10");
    expect(lecture.saisie.heures_elearning).toBe("90");
    expect(lecture.saisie.prix_ht).toBe("2500");
    expect(lecture.saisie.tva).toBe("20");
    expect(lecture.saisie.stagiaire_email).toBe("");
    expect(lecture.saisie.financeur).toBe("");
    expect(lecture.saisie.modalite).toContain("visioconférence ou présentiel");
    expect(lecture.saisie.modalite).toContain("e-learning autonome");
    expect(lecture.numero).toBe("2026-OLIVIER-001");
    expect(lecture.devis).toBe("D2600007");
    expect(lecture.raisons).toEqual([
      "L'e-mail du stagiaire est invalide.",
      "Le financeur est vide.",
      "La date de fin est invalide.",
    ]);
  });

  it("n'invente pas le taux quand le TTC est absent", () => {
    const lecture = lireConvention(OLIVIER.replace("soit 3 000 € TTC", ""), "tlloancy@deter-mi.net");
    expect(lecture.saisie.prix_ht).toBe("2500");
    expect(lecture.saisie.tva).toBe("");
    expect(lecture.raisons).toContain("Le taux de TVA est invalide.");
  });

  it("accepte une convention qui porte la fin, l'e-mail et le financeur", () => {
    const lecture = lireConvention(
      `${OLIVIER}
Date de fin : 13 février 2027
Mail : olivier@example.com
Financeur : AGEFICE
`,
      "tlloancy@deter-mi.net",
    );
    expect(lecture.saisie.date_fin).toBe("2027-02-13");
    expect(lecture.saisie.stagiaire_email).toBe("olivier@example.com");
    expect(lecture.saisie.financeur).toBe("AGEFICE");
    expect(lecture.raisons).toEqual([]);
  });
});
