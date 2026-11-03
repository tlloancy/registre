import { jourEcrit } from "./convention.ts";
import type { Organisme, Preparer } from "./db.ts";
import { enregistrerDevis, enregistrerProgramme, lireEtatPieces, lireDossier } from "./db.ts";
import { afficherEuros, afficherJour, afficherTaux, tvaCentimes } from "./montants.ts";
import { ecrirePdf } from "./pdf-ecrit.ts";
import { textePdf } from "./pdf.ts";

export type Stockage = {
  head(cle: string): Promise<unknown | null>;
  get(cle: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(cle: string, valeur: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
};

export function extraireProgramme(texte: string): string {
  const index = texte.search(/PROGRAMME DE FORMATION/);
  if (index < 0) return "";
  return texte
    .slice(index)
    .replace(/\f/g, "\n")
    .replace(/[▸•●▪]/g, "-")
    .replace(/\u00a0/g, " ")
    .trim();
}

export function mentionDevis(texte: string): { numero: string; dateIso: string } {
  const numero = texte.match(/devis\s+n.\s*([A-Za-z0-9-]+)/i)?.[1] ?? "";
  const ecrit = texte.match(/devis\s+n.\s*[A-Za-z0-9-]+\s+du\s+([^\n.]+)/i)?.[1]?.trim() ?? "";
  return { numero, dateIso: ecrit ? jourEcrit(ecrit) : "" };
}

export function decomposerNumeroDevis(numero: string): { annee: number; numero: number } | null {
  const trouve = /^D(\d{2})(\d{5})$/.exec(numero.trim());
  if (!trouve?.[1] || !trouve[2]) return null;
  const numeroDevis = Number(trouve[2]);
  if (numeroDevis < 1) return null;
  return { annee: 2000 + Number(trouve[1]), numero: numeroDevis };
}

export function texteDevis(entree: {
  numero: string;
  dateIso: string;
  organisme: Organisme;
  entreprise: string;
  representant: string;
  stagiaire: string;
  siret: string;
  adresse: string;
  intitule: string;
  heures: number;
  coaching: number;
  elearning: number;
  ht: number;
  tauxBp: number;
  convention: string;
}): string {
  const tva = tvaCentimes(entree.ht, entree.tauxBp);
  const lignes = [`Devis ${entree.numero}`, afficherJour(entree.dateIso), "", "Émetteur"];
  ajouter(lignes, entree.organisme.nom);
  ajouter(lignes, [entree.organisme.adresse, entree.organisme.code_postal, entree.organisme.ville].filter(Boolean).join(" "));
  ajouter(lignes, entree.organisme.siret ? `SIRET ${entree.organisme.siret}` : "");
  ajouter(lignes, entree.organisme.nda ? `NDA ${entree.organisme.nda}` : "");
  ajouter(lignes, entree.organisme.numero_tva ? `N° TVA ${entree.organisme.numero_tva}` : "");
  ajouter(lignes, entree.organisme.email);
  ajouter(lignes, entree.organisme.telephone);
  lignes.push("", "Destinataire");
  ajouter(lignes, entree.entreprise);
  ajouter(lignes, entree.representant || entree.stagiaire);
  ajouter(lignes, entree.adresse);
  ajouter(lignes, entree.siret ? `SIRET ${entree.siret}` : "");
  lignes.push("", "Formation", entree.intitule, `${entree.heures} heures`);
  ajouter(lignes, detailHeures(entree.coaching, entree.elearning));
  lignes.push(
    "",
    `Total HT ${afficherEuros(entree.ht)}`,
    `TVA ${afficherTaux(entree.tauxBp)} ${afficherEuros(tva)}`,
    `Total TTC ${afficherEuros(entree.ht + tva)}`,
  );
  if (entree.convention) lignes.push("", `Convention ${entree.convention}`);
  return lignes.join("\n");
}

function ajouter(lignes: string[], valeur: string): void {
  if (valeur.trim()) lignes.push(valeur.trim());
}

export async function produirePieces(
  db: Preparer,
  fichiers: Stockage | undefined,
  dossierId: string,
  organisme: Organisme,
  ip: string,
  userAgent: string,
  maintenant: string,
): Promise<void> {
  if (!fichiers) return;
  const dossier = await lireDossier(db, dossierId);
  const etat = await lireEtatPieces(db, dossierId);
  if (!dossier || !etat.convention) return;
  const programmeManque = !etat.programme;
  const numeroConnu = numeroDepuis(etat.convention.corps);
  const devisManque = !etat.devis && numeroConnu !== "";
  if (!programmeManque && !devisManque) return;
  let texte = "";
  try {
    const octets = await lireObjet(fichiers, etat.convention.r2_cle);
    texte = octets ? await textePdf(octets.slice()) : "";
  } catch {
    texte = "";
  }
  if (programmeManque) await poserProgramme(db, fichiers, dossier, texte, ip, userAgent, maintenant);
  if (devisManque) {
    const mention = mentionDevis(texte);
    const numero = mention.numero || numeroConnu;
    if (!mention.dateIso) return;
    await poserDevis(
      db,
      fichiers,
      dossier,
      organisme,
      numero,
      mention.dateIso,
      numeroConvention(etat.convention.corps),
      ip,
      maintenant,
    );
  }
}

function detailHeures(coaching: number, elearning: number): string {
  const parts = [
    coaching > 0 ? `${coaching} heures de coaching` : "",
    elearning > 0 ? `${elearning} heures de e-learning` : "",
  ].filter(Boolean);
  return parts.join(", ");
}

function numeroDepuis(corps: string): string {
  return corpsNumero(corps);
}

function corpsNumero(corps: string): string {
  try {
    const valeur = JSON.parse(corps) as { numero?: unknown; devis?: unknown };
    return typeof valeur.devis === "string" ? valeur.devis : "";
  } catch {
    return "";
  }
}

export function numeroConvention(corps: string): string {
  try {
    const valeur = JSON.parse(corps) as { numero?: unknown };
    return typeof valeur.numero === "string" ? valeur.numero : "";
  } catch {
    return "";
  }
}

async function poserProgramme(
  db: Preparer,
  fichiers: Stockage,
  dossier: NonNullable<Awaited<ReturnType<typeof lireDossier>>>,
  texte: string,
  ip: string,
  userAgent: string,
  maintenant: string,
): Promise<void> {
  const contenu = extraireProgramme(texte);
  if (!contenu) return;
  const pdf = ecrirePdf(contenu);
  const sha256 = await empreinte(pdf);
  if (!(await poser(fichiers, `scans/${sha256}`, pdf))) return;
  try {
    await enregistrerProgramme(db, {
      dossierId: dossier.id,
      intitule: dossier.intitule,
      heuresTotal: dossier.heures_total,
      heuresCoaching: dossier.heures_coaching,
      heuresElearning: dossier.heures_elearning,
      contenu: [...contenu].slice(0, 100_000).join(""),
      recuLe: maintenant,
      ip,
      userAgent,
      sha256,
      taille: pdf.byteLength,
    });
  } catch {
    return;
  }
}

async function poserDevis(
  db: Preparer,
  fichiers: Stockage,
  dossier: NonNullable<Awaited<ReturnType<typeof lireDossier>>>,
  organisme: Organisme,
  numero: string,
  dateIso: string,
  convention: string,
  ip: string,
  maintenant: string,
): Promise<void> {
  const parties = decomposerNumeroDevis(numero);
  const adresse = dossier.entreprise_adresse.trim() || dossier.entreprise.trim();
  if (!parties || !adresse || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return;
  const tva = tvaCentimes(dossier.prix_ht_centimes, dossier.tva_taux_bp);
  const pdf = ecrirePdf(
    texteDevis({
      numero,
      dateIso,
      organisme,
      entreprise: dossier.entreprise,
      representant: dossier.representant,
      stagiaire: dossier.stagiaire_nom,
      siret: dossier.entreprise_siret,
      adresse,
      intitule: dossier.intitule,
      heures: dossier.heures_total,
      coaching: dossier.heures_coaching,
      elearning: dossier.heures_elearning,
      ht: dossier.prix_ht_centimes,
      tauxBp: dossier.tva_taux_bp,
      convention,
    }),
  );
  const sha256 = await empreinte(pdf);
  if (!(await poser(fichiers, `devis/${sha256}`, pdf))) return;
  try {
    await enregistrerDevis(db, {
      dossierId: dossier.id,
      annee: parties.annee,
      numero: parties.numero,
      creeLe: `${dateIso}T12:00:00.000Z`,
      ht: dossier.prix_ht_centimes,
      tauxBp: dossier.tva_taux_bp,
      tva,
      ttc: dossier.prix_ht_centimes + tva,
      adresse,
      sha256,
      ip,
      maintenant,
    });
  } catch {
    return;
  }
}

async function poser(fichiers: Stockage, cle: string, octets: Uint8Array): Promise<boolean> {
  try {
    if (await fichiers.head(cle)) return true;
    await fichiers.put(cle, octets, { httpMetadata: { contentType: "application/pdf" } });
    return true;
  } catch {
    return false;
  }
}

async function lireObjet(fichiers: Stockage, cle: string): Promise<Uint8Array | null> {
  const objet = await fichiers.get(cle);
  if (!objet) return null;
  return new Uint8Array(await objet.arrayBuffer());
}

async function empreinte(octets: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", octets.slice());
  return [...new Uint8Array(digest)].map((octet) => octet.toString(16).padStart(2, "0")).join("");
}

