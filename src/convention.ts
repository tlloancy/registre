import { raisonsSaisie, saisieVide, type SaisieDossier } from "./dossiers.ts";

export type LectureConvention = {
  saisie: SaisieDossier;
  numero: string;
  devis: string;
  raisons: string[];
};

export function lireConvention(texte: string, emailOrganisme: string): LectureConvention {
  const lignes = texte
    .split(/\r?\n/)
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne !== "");
  const beneficiaire = lignes.slice(indexDebut(lignes), indexFin(lignes));
  const saisie = saisieVide();
  saisie.entreprise = valeur(beneficiaire, /^raison sociale\s*:/);
  saisie.representant = nomPersonne(valeur(beneficiaire, /^represente[e]?\s+par\s*:/));
  saisie.stagiaire_nom = saisie.representant;
  saisie.entreprise_adresse = valeur(beneficiaire, /^adresse\s*:/);
  saisie.entreprise_siret = siret(valeur(beneficiaire, /^siret\s*:/));
  saisie.stagiaire_tel = telephone(beneficiaire.join("\n"));
  saisie.stagiaire_email = emailBeneficiaire(
    lignes.slice(0, indexDebut(lignes)).join("\n"),
    beneficiaire.join("\n"),
    lignes.slice(indexFin(lignes)).join("\n"),
    emailOrganisme,
  );
  saisie.financeur = financeur(texte, lignes);
  saisie.intitule = intitule(lignes);
  saisie.date_debut = dateEtiquette(lignes, /^date de debut\s*:/);
  saisie.date_fin = dateEtiquette(lignes, /^date de fin\s*:/);
  completerIntervalle(texte, saisie);
  const heures = lireHeures(texte);
  saisie.heures_total = heures.total;
  saisie.heures_coaching = heures.coaching;
  saisie.heures_elearning = heures.elearning;
  const prix = lirePrix(lignes);
  saisie.prix_ht = prix.ht;
  saisie.tva = prix.tva;
  saisie.modalite = modalite(lignes);
  return {
    saisie,
    numero: tronquer(valeur(lignes, /^n.\s*de convention\s*:/), 80),
    devis: tronquer(devis(texte), 80),
    raisons: raisonsSaisie(saisie),
  };
}

export function pdfReconnu(octets: Uint8Array): boolean {
  return octets.length >= 5 && octets[0] === 0x25 && octets[1] === 0x50 && octets[2] === 0x44 && octets[3] === 0x46;
}

function indexDebut(lignes: string[]): number {
  const index = lignes.findIndex((ligne) => /^2\.\s*le beneficiaire|^le beneficiaire/.test(nu(ligne)));
  return index === -1 ? 0 : index;
}

function indexFin(lignes: string[]): number {
  const debut = indexDebut(lignes);
  const fin = lignes.findIndex(
    (ligne, index) => index > debut && (/^il a ete convenu/.test(nu(ligne)) || /^article 1\b/.test(nu(ligne))),
  );
  return fin === -1 ? lignes.length : fin;
}

function intitule(lignes: string[]): string {
  const debut = lignes.findIndex((ligne) => /^article 2\b/.test(nu(ligne)));
  if (debut === -1) return "";
  const fin = lignes.findIndex((ligne, index) => index > debut && /^article 3\b/.test(nu(ligne)));
  return lignes
    .slice(debut + 1, fin === -1 ? lignes.length : fin)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function lireHeures(texte: string): { total: string; coaching: string; elearning: string } {
  const plat = nu(texte);
  const total = premier(plat, /duree totale\s*:\s*(\d+)\s*heures/);
  const coaching = premier(plat, /(\d+)\s*heures de coaching/);
  const elearning = premier(plat, /(\d+)\s*heures en e-learning/);
  return {
    total,
    coaching: coaching || (plat.includes("coaching") ? "" : "0"),
    elearning: elearning || (plat.includes("e-learning") ? "" : "0"),
  };
}

function lirePrix(lignes: string[]): { ht: string; tva: string } {
  const ligne = lignes.find((candidate) => /montant total\s*:/.test(nu(candidate)));
  if (!ligne) return { ht: "", tva: "" };
  const trouve = ligne.match(
    /:\s*([0-9][0-9\s\u00a0.,]*)\s*(?:€|EUR)\s*HT(?:\s*soit\s*([0-9][0-9\s\u00a0.,]*)\s*(?:€|EUR)\s*TTC)?/i,
  );
  if (!trouve?.[1]) return { ht: "", tva: "" };
  const ht = centimes(trouve[1]);
  if (ht === null) return { ht: "", tva: "" };
  const ttc = trouve[2] ? centimes(trouve[2]) : null;
  return { ht: saisieEuros(ht), tva: ttc === null ? "" : saisieTaux(tauxDepuisMontants(ht, ttc)) };
}

function modalite(lignes: string[]): string {
  const coaching = lignePropre(lignes, /heures de coaching/);
  const elearning = lignePropre(lignes, /e-learning/);
  return [coaching, elearning].filter(Boolean).join(" ; ");
}

function financeur(texte: string, lignes: string[]): string {
  const etiquette = valeur(lignes, /^financeur\s*:/);
  if (etiquette) return financeurNomme(etiquette) || etiquette;
  const mentions = financeursMentionnes(texte);
  return mentions.length === 1 ? (mentions[0] ?? "") : "";
}

function financeurNomme(valeur: string): string {
  const mentions = financeursMentionnes(valeur);
  return mentions.length === 1 ? (mentions[0] ?? "") : "";
}

function financeursMentionnes(texte: string): string[] {
  const plat = nu(texte);
  const mentions: string[] = [];
  if (/\bagefice\b/.test(plat)) mentions.push("AGEFICE");
  if (/\bfif\s*pl\b/.test(plat)) mentions.push("FIFPL");
  if (/\bfafcea\b/.test(plat)) mentions.push("FAFCEA");
  return mentions;
}

function emailBeneficiaire(organisme: string, bloc: string, suite: string, emailOrganisme: string): string {
  const ignores = new Set(emailsDistincts(organisme).map((adresse) => adresse.toLowerCase()));
  if (emailOrganisme.trim()) ignores.add(emailOrganisme.trim().toLowerCase());
  const dansBloc = emailsDistincts(bloc).filter((adresse) => !ignores.has(adresse.toLowerCase()));
  if (dansBloc.length === 1) return dansBloc[0] ?? "";
  const ailleurs = emailsDistincts(suite).filter((adresse) => !ignores.has(adresse.toLowerCase()));
  return ailleurs.length === 1 ? (ailleurs[0] ?? "") : "";
}

function emailsDistincts(texte: string): string[] {
  const trouves = new Map<string, string>();
  for (const match of texte.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
    trouves.set(match[0].toLowerCase(), match[0]);
  }
  return [...trouves.values()];
}

function devis(texte: string): string {
  return texte.match(/devis\s+n.\s*([A-Za-z0-9-]+)/i)?.[1] ?? "";
}

function dateEtiquette(lignes: string[], motif: RegExp): string {
  const brut = valeur(lignes, motif);
  return brut ? dateVersIso(brut) : "";
}

function completerIntervalle(texte: string, saisie: SaisieDossier): void {
  const trouve = texte.match(
    /du\s+(\d{1,2}\s+[A-Za-zÀ-ÿ]+\s+\d{4})\s+au\s+(\d{1,2}\s+[A-Za-zÀ-ÿ]+\s+\d{4})/i,
  );
  if (!trouve?.[1] || !trouve[2]) return;
  if (!saisie.date_debut) saisie.date_debut = dateVersIso(trouve[1]);
  if (!saisie.date_fin) saisie.date_fin = dateVersIso(trouve[2]);
}

function dateVersIso(valeur: string): string {
  const brut = valeur.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(brut)) return dateValide(brut) ? brut : "";
  const chiffres = brut.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (chiffres?.[1] && chiffres[2] && chiffres[3]) {
    const iso = `${chiffres[3]}-${chiffres[2].padStart(2, "0")}-${chiffres[1].padStart(2, "0")}`;
    return dateValide(iso) ? iso : "";
  }
  const mot = brut.match(/^(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})$/);
  if (!mot?.[1] || !mot[2] || !mot[3]) return "";
  const mois = [
    "janvier",
    "fevrier",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "aout",
    "septembre",
    "octobre",
    "novembre",
    "decembre",
  ].indexOf(nu(mot[2]));
  if (mois < 0) return "";
  const iso = `${mot[3]}-${String(mois + 1).padStart(2, "0")}-${mot[1].padStart(2, "0")}`;
  return dateValide(iso) ? iso : "";
}

function dateValide(iso: string): boolean {
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso;
}

function centimes(valeur: string): number | null {
  const sansEspace = valeur.replace(/[\s\u00a0]/g, "");
  let nombre = sansEspace;
  if (/^\d{1,3}(\.\d{3})+$/.test(sansEspace)) nombre = sansEspace.replaceAll(".", "");
  else if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(sansEspace)) {
    const [entier, decimale] = sansEspace.split(",");
    nombre = `${entier?.replaceAll(".", "") ?? ""}.${decimale ?? ""}`;
  } else nombre = sansEspace.replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(nombre)) return null;
  const [entier, decimale = ""] = nombre.split(".");
  const cents = Number(entier) * 100 + Number(decimale.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

function tauxDepuisMontants(ht: number, ttc: number): number | null {
  if (ht <= 0 || ttc < ht) return null;
  const tva = ttc - ht;
  const cible = Math.round((tva * 10_000) / ht);
  let meilleur: number | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (let bp = 0; bp <= 10_000; bp += 1) {
    if (Math.trunc((ht * bp + 5000) / 10_000) !== tva) continue;
    const ecart = Math.abs(bp - cible);
    if (ecart < distance) {
      distance = ecart;
      meilleur = bp;
    }
  }
  return meilleur;
}

function saisieEuros(cents: number): string {
  const entier = Math.trunc(cents / 100);
  const decimale = cents % 100;
  if (decimale === 0) return String(entier);
  return `${entier},${String(decimale).padStart(2, "0")}`;
}

function saisieTaux(bp: number | null): string {
  if (bp === null) return "";
  const entier = Math.trunc(bp / 100);
  const decimale = bp % 100;
  if (decimale === 0) return String(entier);
  return `${entier},${String(decimale).padStart(2, "0").replace(/0$/, "")}`;
}

function valeur(lignes: string[], motif: RegExp): string {
  for (const ligne of lignes) {
    if (!motif.test(nu(ligne))) continue;
    const coupe = ligne.indexOf(":");
    if (coupe === -1) return "";
    return ligne.slice(coupe + 1).trim();
  }
  return "";
}

function lignePropre(lignes: string[], motif: RegExp): string {
  const ligne = lignes.find((candidate) => motif.test(nu(candidate)));
  return ligne?.replace(/^[-–—•*]\s*/, "").trim() ?? "";
}

function nomPersonne(valeur: string): string {
  return valeur.replace(/^(Monsieur|Madame|Mademoiselle|Mme|Mlle|Mr|M\.)\s+/i, "").trim();
}

function siret(valeur: string): string {
  const chiffres = valeur.replace(/\D/g, "");
  return chiffres.length === 14 ? chiffres : valeur.trim();
}

function telephone(texte: string): string {
  return texte.match(/\b0\d(?:[\s.]?\d{2}){4}\b/)?.[0]?.trim() ?? "";
}

function premier(texte: string, motif: RegExp): string {
  return texte.match(motif)?.[1] ?? "";
}

function tronquer(valeur: string, max: number): string {
  return [...valeur].slice(0, max).join("");
}

function nu(valeur: string): string {
  return valeur.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}
