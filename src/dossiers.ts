export type SaisieDossier = {
  stagiaire_nom: string;
  stagiaire_email: string;
  stagiaire_tel: string;
  entreprise: string;
  entreprise_siret: string;
  entreprise_adresse: string;
  representant: string;
  financeur: string;
  financeur_dossier: string;
  intitule: string;
  date_debut: string;
  date_fin: string;
  heures_total: string;
  heures_coaching: string;
  heures_elearning: string;
  prix_ht: string;
  tva: string;
  modalite: string;
};

export type DossierPret = {
  id: string;
  cree_le: string;
  stagiaire_nom: string;
  stagiaire_email: string;
  stagiaire_tel: string;
  entreprise: string;
  entreprise_siret: string;
  entreprise_adresse: string;
  representant: string;
  financeur: string;
  financeur_dossier: string;
  intitule: string;
  date_debut: string;
  date_fin: string | null;
  heures_total: number;
  heures_coaching: number;
  heures_elearning: number;
  prix_ht_centimes: number;
  tva_taux_bp: number;
  modalite: string;
};

export function saisieVide(): SaisieDossier {
  return {
    stagiaire_nom: "",
    stagiaire_email: "",
    stagiaire_tel: "",
    entreprise: "",
    entreprise_siret: "",
    entreprise_adresse: "",
    representant: "",
    financeur: "",
    financeur_dossier: "",
    intitule: "",
    date_debut: "",
    date_fin: "",
    heures_total: "",
    heures_coaching: "0",
    heures_elearning: "0",
    prix_ht: "",
    tva: "",
    modalite: "",
  };
}

export function analyserDossier(
  formulaire: FormData,
  id: string,
  creeLe: string,
): { ok: true; dossier: DossierPret; saisie: SaisieDossier } | { ok: false; raison: string; saisie: SaisieDossier } {
  const saisie = lireSaisie(formulaire);
  const raisons = raisonsSaisie(saisie);
  if (raisons.length > 0) return { ok: false, raison: raisons[0] ?? "Le dossier est incomplet.", saisie };
  const debut = jour(saisie.date_debut);
  const fin = saisie.date_fin === "" ? null : jour(saisie.date_fin);
  const heuresTotal = entier(saisie.heures_total);
  const heuresCoaching = entier(saisie.heures_coaching);
  const heuresElearning = entier(saisie.heures_elearning);
  const prix = eurosEnCentimes(saisie.prix_ht);
  const tva = pourcentEnBp(saisie.tva);
  if (
    !debut ||
    (saisie.date_fin !== "" && !fin) ||
    heuresTotal === null ||
    heuresCoaching === null ||
    heuresElearning === null ||
    prix === null ||
    tva === null
  ) {
    return { ok: false, raison: "Le dossier est incomplet.", saisie };
  }

  return {
    ok: true,
    saisie,
    dossier: {
      id,
      cree_le: creeLe,
      stagiaire_nom: saisie.stagiaire_nom,
      stagiaire_email: saisie.stagiaire_email,
      stagiaire_tel: saisie.stagiaire_tel,
      entreprise: saisie.entreprise,
      entreprise_siret: saisie.entreprise_siret,
      entreprise_adresse: saisie.entreprise_adresse,
      representant: saisie.representant,
      financeur: saisie.financeur,
      financeur_dossier: saisie.financeur_dossier,
      intitule: saisie.intitule,
      date_debut: debut,
      date_fin: fin,
      heures_total: heuresTotal,
      heures_coaching: heuresCoaching,
      heures_elearning: heuresElearning,
      prix_ht_centimes: prix,
      tva_taux_bp: tva,
      modalite: saisie.modalite,
    },
  };
}

export function raisonsSaisie(saisie: SaisieDossier): string[] {
  if (Object.values(saisie).some((valeur) => [...valeur].length > 500)) return ["Un champ est trop long."];
  const raisons: string[] = [];
  if (saisie.stagiaire_nom === "") raisons.push("Le nom du stagiaire est vide.");
  if (saisie.stagiaire_email !== "" && !emailValide(saisie.stagiaire_email)) {
    raisons.push("L'e-mail du stagiaire est invalide.");
  }
  if (saisie.intitule === "") raisons.push("L'intitulé est vide.");
  const debut = jour(saisie.date_debut);
  const fin = saisie.date_fin === "" ? null : jour(saisie.date_fin);
  if (!debut) raisons.push("La date de début est invalide.");
  if (saisie.date_fin !== "" && !fin) raisons.push("La date de fin est invalide.");
  if (debut && fin && fin < debut) raisons.push("La date de fin précède le début.");
  if (entier(saisie.heures_total) === null || entier(saisie.heures_coaching) === null || entier(saisie.heures_elearning) === null) {
    raisons.push("Les heures sont invalides.");
  }
  if (eurosEnCentimes(saisie.prix_ht) === null) raisons.push("Le prix HT est invalide.");
  if (pourcentEnBp(saisie.tva) === null) raisons.push("Le taux de TVA est invalide.");
  if (saisie.modalite === "") raisons.push("La modalité est vide.");
  return raisons;
}

function lireSaisie(formulaire: FormData): SaisieDossier {
  const vide = saisieVide();
  const saisie = { ...vide };
  for (const nom of Object.keys(vide) as (keyof SaisieDossier)[]) {
    saisie[nom] = champ(formulaire, nom);
  }
  return saisie;
}

function champ(formulaire: FormData, nom: string): string {
  const valeur = formulaire.get(nom);
  return typeof valeur === "string" ? valeur.trim() : "";
}

function emailValide(valeur: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valeur);
}

function jour(valeur: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valeur)) return null;
  const date = new Date(`${valeur}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === valeur ? valeur : null;
}

function entier(valeur: string): number | null {
  if (!/^\d+$/.test(valeur)) return null;
  const nombre = Number(valeur);
  if (nombre > 100_000) return null;
  return nombre;
}

function eurosEnCentimes(valeur: string): number | null {
  const propre = valeur.replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(propre)) return null;
  const [entierPartie, decimale = ""] = propre.split(".");
  const centimes = Number(entierPartie) * 100 + Number(decimale.padEnd(2, "0"));
  if (!Number.isSafeInteger(centimes) || centimes > 1_000_000_000) return null;
  return centimes;
}

function pourcentEnBp(valeur: string): number | null {
  const propre = valeur.replace("%", "").replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(propre)) return null;
  const [entierPartie, decimale = ""] = propre.split(".");
  const bp = Number(entierPartie) * 100 + Number(decimale.padEnd(2, "0"));
  if (!Number.isSafeInteger(bp) || bp > 10_000) return null;
  return bp;
}
