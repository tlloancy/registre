import { describe, expect, it } from "vitest";
import { analyserDossier } from "./dossiers.ts";

describe("dossier", () => {
  it("convertit le prix en centimes et la TVA en points de base", async () => {
    const analyse = analyserDossier(await formulaire({ prix_ht: "600,50", tva: "5,5" }), "id", "2026-11-03T18:00:00.000Z");
    expect(analyse.ok).toBe(true);
    if (!analyse.ok) return;
    expect(analyse.dossier.prix_ht_centimes).toBe(60050);
    expect(analyse.dossier.tva_taux_bp).toBe(550);
  });

  it("refuse un taux vide", async () => {
    const analyse = analyserDossier(await formulaire({ tva: "" }), "id", "2026-11-03T18:00:00.000Z");
    expect(analyse).toMatchObject({ ok: false, raison: "Le taux de TVA est invalide." });
  });

  it("refuse un taux au-dessus de 100", async () => {
    const analyse = analyserDossier(await formulaire({ tva: "101" }), "id", "2026-11-03T18:00:00.000Z");
    expect(analyse.ok).toBe(false);
  });

  it("refuse une fin antérieure au début", async () => {
    const analyse = analyserDossier(
      await formulaire({ date_debut: "2026-05-13", date_fin: "2026-05-01" }),
      "id",
      "2026-11-03T18:00:00.000Z",
    );
    expect(analyse).toMatchObject({ ok: false, raison: "La date de fin précède le début." });
  });
});

function formulaire(remplace: Record<string, string>): Promise<FormData> {
  const valeurs = new URLSearchParams({
    stagiaire_nom: "Camille Martin",
    stagiaire_email: "camille@example.com",
    financeur: "AGEFICE",
    intitule: "Administration Linux",
    date_debut: "2026-05-13",
    date_fin: "2026-05-15",
    heures_total: "14",
    heures_coaching: "0",
    heures_elearning: "0",
    prix_ht: "600",
    tva: "20",
    modalite: "distanciel",
    ...remplace,
  });
  return new Request("https://registre.formation.deter-mi.net/dossiers", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: valeurs,
  }).formData();
}
