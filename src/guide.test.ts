import { describe, expect, it } from "vitest";
import { ecrirePdf } from "./pdf-ecrit.ts";
import {
  conformite,
  guidePerime,
  indicateursDuGuide,
  juger,
  lienDepuisPage,
  presenterGuide,
  telechargerGuide,
  versionDuGuide,
  type Preuves,
} from "./guide.ts";
import { lignesBilan } from "./pages.ts";

const MAINTENANT = new Date("2026-11-04T00:40:00.000Z");

function preuves(partiel: Partial<Preuves> = {}): Preuves {
  return {
    ouverts: 0,
    sansProgramme: 0,
    sansAnalyse: 0,
    sansPositionnement: 0,
    sansConvocation: 0,
    sansMiseEnOeuvre: 0,
    sansEvaluation: 0,
    sansSuivi: 0,
    sansConnexion: 0,
    dates: new Map(),
    ...partiel,
  };
}

describe("guide", () => {
  it("ignore une page rejetée et un autre hôte", () => {
    expect(lienDepuisPage('<html>bobcmn</html><a href="https://travail-emploi.gouv.fr/a.pdf">', "https://travail-emploi.gouv.fr/x")).toBeNull();
    expect(lienDepuisPage('<a href="https://example.com/Guide-Qualiopi.pdf">', "https://travail-emploi.gouv.fr/x")).toBeNull();
    expect(
      lienDepuisPage(
        '<a href="https://travail-emploi.gouv.fr/files/Guide%20lecture%20Qualiopi.pdf">',
        "https://travail-emploi.gouv.fr/x",
      ),
    ).toBe("https://travail-emploi.gouv.fr/files/Guide%20lecture%20Qualiopi.pdf");
  });

  it("relit le guide le jour suivant, et retente un échec après un quart d'heure", () => {
    expect(guidePerime(null, MAINTENANT, null)).toBe(true);
    expect(guidePerime("2026-11-03T23:30:00.000Z", MAINTENANT, "inchange")).toBe(false);
    expect(guidePerime("2026-11-03T22:00:00.000Z", MAINTENANT, "inchange")).toBe(true);
    expect(guidePerime("2026-11-04T00:30:00.000Z", MAINTENANT, "echec")).toBe(false);
    expect(guidePerime("2026-11-03T23:20:00.000Z", MAINTENANT, "echec")).toBe(true);
  });

  it("sépare les indicateurs du sommaire", () => {
    const texte = `V.10 – Novembre 2026
1. Le prestataire diffuse une information accessible au public.
23. Le prestataire réalise une veille légale et réglementaire sur la formation.
26. Le prestataire mobilise un réseau pour les publics en situation de handicap.
Critère 7 : suite
Glossaire
1. Le prestataire ne doit pas être repris dans le corps.`;
    expect(versionDuGuide(texte)).toBe("V.10 – Novembre 2026");
    expect(indicateursDuGuide(texte).map((indicateur) => indicateur.numero)).toEqual([1, 23, 26]);
  });

  it("marque les veilles, le handicap et l'auto-évaluation manquants, et laisse l'apprentissage hors champ", () => {
    const lignes = conformite(
      [
        { numero: 23, titre: "Le prestataire réalise une veille légale et réglementaire sur la formation professionnelle." },
        { numero: 26, titre: "Le prestataire mobilise les réseaux pour les publics en situation de handicap." },
        { numero: 32, titre: "Le prestataire met en œuvre une amélioration continue et une analyse des risques." },
        { numero: 13, titre: "Pour les formations en alternance, le prestataire anticipe les missions." },
        { numero: 33, titre: "Le prestataire évalue les enseignements par les apprenants." },
        { numero: 5, titre: "Le prestataire définit les objectifs opérationnels et évaluables de la prestation." },
      ],
      preuves({ ouverts: 1, sansProgramme: 0 }),
      MAINTENANT,
    );
    expect(lignes.find((ligne) => ligne.numero === 23)?.detail).toBe("Aucune veille légale.");
    expect(lignes.find((ligne) => ligne.numero === 26)?.detail).toBe("Aucun réseau handicap n'est inscrit.");
    expect(lignes.find((ligne) => ligne.numero === 32)?.detail).toContain("Aucune auto-évaluation.");
    expect(lignes.find((ligne) => ligne.numero === 13)?.statut).toBe("hors");
    expect(lignes.find((ligne) => ligne.numero === 33)?.statut).toBe("hors");
    expect(lignes.find((ligne) => ligne.numero === 5)?.statut).toBe("tenu");
    const information = juger(
      {
        numero: 1,
        titre:
          "Le prestataire diffuse une information accessible au public, y compris l'accessibilité aux personnes en situation de handicap.",
      },
      preuves(),
      MAINTENANT,
    );
    expect(information.detail).toBe("L'accessibilité handicap n'est pas publiée.");
  });

  it("tient une veille datée de moins de 90 jours", () => {
    const ligne = juger(
      { numero: 23, titre: "Le prestataire réalise une veille légale et réglementaire." },
      preuves({ dates: new Map([["veille_legale", "2026-10-01T00:00:00.000Z"]]) }),
      MAINTENANT,
    );
    expect(ligne.statut).toBe("tenu");
    const vieille = juger(
      { numero: 23, titre: "Le prestataire réalise une veille légale et réglementaire." },
      preuves({ dates: new Map([["veille_legale", "2026-01-01T00:00:00.000Z"]]) }),
      MAINTENANT,
    );
    expect(vieille.statut).toBe("pas_tenu");
  });

  it("demande le relevé de connexion à part du suivi", () => {
    const ligne = juger(
      { numero: 17, titre: "Le prestataire met à disposition du bénéficiaire des ressources pédagogiques." },
      preuves({ ouverts: 1, sansProgramme: 0, sansConnexion: 1 }),
      MAINTENANT,
    );
    expect(ligne.detail).toBe("Le relevé de connexion n'est pas déposé.");
    const pieces = { tenus: ["analyse", "positionnement", "convocation"], signes: ["convention", "devis", "reglement"], programme: true };
    const lignes = lignesBilan(pieces, 90);
    expect(lignes.find((ligne) => ligne.piece === "Relevé de connexion")?.pret).toBe(false);
    expect(lignes.find((ligne) => ligne.piece === "Devis")?.pret).toBe(true);
    const depose = lignesBilan({ ...pieces, tenus: [...pieces.tenus, "connexion"] }, 90);
    expect(depose.find((ligne) => ligne.piece === "Relevé de connexion")?.pret).toBe(true);
    expect(lignesBilan(pieces, 0).some((ligne) => ligne.piece === "Relevé de connexion")).toBe(false);
  });

  it("lit un guide depuis la page, sans publier l'adresse", async () => {
    const pdf = ecrirePdf(
      ["V.10 – Novembre 2026", ...Array.from({ length: 33 }, (_, index) => `${index + 1}. Le prestataire tient le point numéro ${index + 1} du référentiel.`), "Glossaire"].join("\n"),
    );
    const releve = await telechargerGuide(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes(".pdf")) return new Response(pdf.slice(), { status: 200 });
      return new Response('<a href="https://travail-emploi.gouv.fr/files/guide-lecture-qualiopi.pdf">x</a>', { status: 200 });
    });
    expect(releve.ok).toBe(true);
    if (!releve.ok) return;
    expect(releve.indicateurs).toHaveLength(33);
    expect(releve.version).toContain("V.10");
    const vue = presenterGuide(
      { hash: releve.hash, hashLu: null, verifieLe: MAINTENANT.toISOString(), erreur: "", releve: JSON.stringify({ version: releve.version, indicateurs: releve.indicateurs }) },
      preuves(),
      [],
      MAINTENANT,
    );
    expect(vue.verdict.startsWith("Pas conforme")).toBe(true);
    expect(vue.aLire).toBe(true);
    expect(JSON.stringify(vue)).not.toContain("travail-emploi.gouv.fr");
  });
});
