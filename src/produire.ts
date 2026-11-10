import { jourEcrit, pdfReconnu } from "./convention.ts";
import type { DossierComplet, Organisme, Preparer } from "./db.ts";
import {
  ajouterVersionProgramme,
  deposerPieceDossier,
  enregistrerDevis,
  enregistrerModele,
  enregistrerProgramme,
  lireContenuProgramme,
  lireDevisEmis,
  lireDossier,
  lireEtatPieces,
  lireShaModeles,
  lireShaRetour,
} from "./db.ts";
import { modulesDuProgramme, pieceProduite, REGLEMENT_URL, textesModeles } from "./modeles.ts";
import { documentHtml, htmlVersPdf, normaliserHtml, paragraphes, sousTitre, tableauLibre } from "./html-pdf.ts";
import { afficherEuros, afficherJour, afficherTaux, numeroDevis, tvaCentimes } from "./montants.ts";
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

export function htmlDevis(entree: {
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
  programme: string;
}): string {
  const tva = tvaCentimes(entree.ht, entree.tauxBp);
  const emetteur = [
    entree.organisme.nom,
    [entree.organisme.adresse, entree.organisme.code_postal, entree.organisme.ville].filter(Boolean).join(" "),
    entree.organisme.siret ? `SIRET ${entree.organisme.siret}` : "",
    entree.organisme.nda ? `NDA ${entree.organisme.nda}` : "",
    entree.organisme.numero_tva ? `TVA ${entree.organisme.numero_tva}` : "",
    entree.organisme.email,
    entree.organisme.telephone,
  ].filter((ligne) => ligne.trim() !== "");
  const destinataire = [
    entree.entreprise,
    entree.representant || entree.stagiaire,
    entree.adresse,
    entree.siret ? `SIRET ${entree.siret}` : "",
  ].filter((ligne) => ligne.trim() !== "");
  const taille = Math.max(emetteur.length, destinataire.length, 1);
  const parties = Array.from({ length: taille }, (_, index) => [emetteur[index] ?? "", destinataire[index] ?? ""]);
  const modules = modulesDuProgramme(entree.programme)
    .map((module) => [module.titre, module.heures].filter(Boolean).join(" — "))
    .filter(Boolean);
  const meta = [afficherJour(entree.dateIso), entree.convention ? `Convention ${entree.convention}` : ""].filter(Boolean).join(" · ");
  return documentHtml(
    `Devis ${entree.numero}`,
    meta,
    [
      tableauLibre(["Émetteur", "Destinataire"], parties),
      sousTitre("Détail"),
      paragraphes([
        `Service — ${entree.intitule} — ${entree.heures} heures`,
        detailHeures(entree.coaching, entree.elearning),
        modules.length > 0 ? "Programme" : "",
        ...modules,
      ]),
      tableauLibre(
        ["Libellé", "Montant"],
        [
          ["Prix unitaire HT", afficherEuros(entree.ht)],
          ["Quantité", "1"],
          [`TVA ${afficherTaux(entree.tauxBp)}`, afficherEuros(tva)],
          ["Total HT", afficherEuros(entree.ht)],
          ["Total TTC", afficherEuros(entree.ht + tva)],
        ],
      ),
      sousTitre("Conditions"),
      paragraphes(["Conditions de règlement", "Mode de règlement"]),
      sousTitre("Bon pour accord"),
      paragraphes(["Signature et cachet", "Qualité du signataire"]),
    ].join(""),
  );
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
  const numeroConnu = numeroDepuis(etat.convention.corps);
  const programmeManque = !etat.programme;
  const devisManque = !etat.devis && numeroConnu !== "";
  let texte = "";
  if (programmeManque || devisManque) {
    try {
      const octets = await lireObjet(fichiers, etat.convention.r2_cle);
      texte = octets ? await textePdf(octets.slice()) : "";
    } catch {
      texte = "";
    }
  }
  if (programmeManque) await poserProgramme(db, fichiers, dossier, texte, ip, userAgent, maintenant);
  if (devisManque) {
    const mention = mentionDevis(texte);
    const numero = mention.numero || numeroConnu;
    if (mention.dateIso) {
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
  const presents = new Set(etat.modeles);
  const sha = await lireShaModeles(db, dossierId);
  const programme = (await lireContenuProgramme(db, dossierId)) || extraireProgramme(texte);
  await poserModeles(db, fichiers, dossier, organisme, programme, numeroConvention(etat.convention.corps), sha, ip, userAgent, maintenant, null);
  if (!presents.has("reglement")) await poserReglement(db, fichiers, dossier.id, ip, userAgent, maintenant);
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

export async function produireModele(
  db: Preparer,
  fichiers: Stockage | undefined,
  dossierId: string,
  code: string,
  organisme: Organisme,
  ip: string,
  userAgent: string,
  maintenant: string,
): Promise<boolean> {
  if (!fichiers || !pieceProduite(code)) return false;
  if (code === "devis") return produireDevis(db, fichiers, dossierId, organisme, ip, userAgent, maintenant);
  if (code === "convention") return produireConvention(db, fichiers, dossierId, organisme, ip, userAgent, maintenant);
  if (code === "programme") return produireProgramme(db, fichiers, dossierId, ip, userAgent, maintenant);
  if (code === "reglement") return produireReglement(db, fichiers, dossierId, ip, userAgent, maintenant);
  if (code === "attestation") return produireAttestation(db, fichiers, dossierId, organisme, ip, userAgent, maintenant);
  if (code === "facture") return produireFacture(db, fichiers, dossierId, organisme, ip, userAgent, maintenant);
  const dossier = await lireDossier(db, dossierId);
  const etat = await lireEtatPieces(db, dossierId);
  if (!dossier || !etat.convention) return false;
  const programme = await lireContenuProgramme(db, dossierId);
  const sha = await lireShaModeles(db, dossierId);
  const avant = sha.get(code);
  await poserModeles(
    db,
    fichiers,
    dossier,
    organisme,
    programme,
    numeroConvention(etat.convention.corps),
    sha,
    ip,
    userAgent,
    maintenant,
    code,
  );
  const apres = await lireShaModeles(db, dossierId);
  return apres.has(code) && apres.get(code) !== avant;
}

async function produireDevis(
  db: Preparer,
  fichiers: Stockage,
  dossierId: string,
  organisme: Organisme,
  ip: string,
  userAgent: string,
  maintenant: string,
): Promise<boolean> {
  const dossier = await lireDossier(db, dossierId);
  const etat = await lireEtatPieces(db, dossierId);
  if (!dossier || !etat.convention) return false;
  const emis = await lireDevisEmis(db, dossierId);
  let texte = "";
  try {
    const octets = await lireObjet(fichiers, etat.convention.r2_cle);
    texte = octets ? await textePdf(octets.slice()) : "";
  } catch {
    texte = "";
  }
  const mention = mentionDevis(texte);
  const numero = emis ? numeroDevis(emis.annee, emis.numero) : mention.numero || numeroDepuis(etat.convention.corps);
  const dateIso = (emis?.cree_le ?? "").slice(0, 10) || mention.dateIso;
  const parties = decomposerNumeroDevis(numero);
  const adresse = dossier.entreprise_adresse.trim() || dossier.entreprise.trim();
  if (!parties || !adresse || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return false;
  const programme = await lireContenuProgramme(db, dossierId);
  const pdf = htmlVersPdf(
    htmlDevis({
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
      convention: numeroConvention(etat.convention.corps),
      programme,
    }),
  );
  const sha256 = await empreinte(pdf);
  if (emis?.sha256 === sha256 || (await lireShaModeles(db, dossierId)).get("devis") === sha256) return true;
  if (!emis) {
    await poserDevis(db, fichiers, dossier, organisme, numero, dateIso, numeroConvention(etat.convention.corps), ip, maintenant);
    return (await lireDevisEmis(db, dossierId)) !== null;
  }
  if (!(await poser(fichiers, `scans/${sha256}`, pdf))) return false;
  await enregistrerModele(db, {
    dossierId,
    code: "devis",
    recuLe: maintenant,
    ip,
    userAgent,
    sha256,
    taille: pdf.byteLength,
  });
  return true;
}

async function produireConvention(
  db: Preparer,
  fichiers: Stockage,
  dossierId: string,
  organisme: Organisme,
  ip: string,
  userAgent: string,
  maintenant: string,
): Promise<boolean> {
  const dossier = await lireDossier(db, dossierId);
  const etat = await lireEtatPieces(db, dossierId);
  if (!dossier || !etat.convention) return false;
  const numero = numeroConvention(etat.convention.corps);
  const devis = corpsNumero(etat.convention.corps);
  const pdf = htmlVersPdf(htmlConvention(dossier, organisme, numero, devis));
  const sha256 = await empreinte(pdf);
  if ((await lireShaRetour(db, dossierId, "convention")) === sha256) return true;
  if (!(await poser(fichiers, `scans/${sha256}`, pdf))) return false;
  const detail: Record<string, string> = {};
  if (numero) detail.numero = numero;
  if (devis) detail.devis = devis;
  return deposerPieceDossier(db, {
    dossierId,
    code: "convention",
    recuLe: maintenant,
    ip,
    userAgent,
    sha256,
    taille: pdf.byteLength,
    corps: JSON.stringify(detail),
  });
}

async function produireProgramme(
  db: Preparer,
  fichiers: Stockage,
  dossierId: string,
  ip: string,
  userAgent: string,
  maintenant: string,
): Promise<boolean> {
  const dossier = await lireDossier(db, dossierId);
  const etat = await lireEtatPieces(db, dossierId);
  if (!dossier || !etat.convention) return false;
  let texte = "";
  try {
    const octets = await lireObjet(fichiers, etat.convention.r2_cle);
    texte = octets ? await textePdf(octets.slice()) : "";
  } catch {
    texte = "";
  }
  const contenu = extraireProgramme(texte) || (await lireContenuProgramme(db, dossierId));
  if (!contenu) return false;
  const pdf = ecrirePdf(contenu);
  const sha256 = await empreinte(pdf);
  if ((await lireShaRetour(db, dossierId, "programme")) === sha256) return true;
  if (!(await poser(fichiers, `scans/${sha256}`, pdf))) return false;
  await ajouterVersionProgramme(db, {
    dossierId,
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
  return true;
}

async function produireReglement(
  db: Preparer,
  fichiers: Stockage,
  dossierId: string,
  ip: string,
  userAgent: string,
  maintenant: string,
): Promise<boolean> {
  try {
    const reponse = await fetch(REGLEMENT_URL, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!reponse.ok) return false;
    const octets = new Uint8Array(await reponse.arrayBuffer());
    if (!pdfReconnu(octets) || octets.byteLength > 2_000_000) return false;
    const sha256 = await empreinte(octets);
    if ((await lireShaModeles(db, dossierId)).get("reglement") === sha256) return true;
    if (!(await poser(fichiers, `scans/${sha256}`, octets))) return false;
    await enregistrerModele(db, {
      dossierId,
      code: "reglement",
      recuLe: maintenant,
      ip,
      userAgent,
      sha256,
      taille: octets.byteLength,
    });
    return true;
  } catch {
    return false;
  }
}

async function produireAttestation(
  db: Preparer,
  fichiers: Stockage,
  dossierId: string,
  organisme: Organisme,
  ip: string,
  userAgent: string,
  maintenant: string,
): Promise<boolean> {
  const dossier = await lireDossier(db, dossierId);
  if (!dossier) return false;
  return poserModele(db, fichiers, dossierId, "attestation", htmlVersPdf(htmlAttestation(dossier, organisme)), ip, userAgent, maintenant);
}

async function produireFacture(
  db: Preparer,
  fichiers: Stockage,
  dossierId: string,
  organisme: Organisme,
  ip: string,
  userAgent: string,
  maintenant: string,
): Promise<boolean> {
  const dossier = await lireDossier(db, dossierId);
  if (!dossier) return false;
  const etat = await lireEtatPieces(db, dossierId);
  const devis = etat?.convention ? corpsNumero(etat.convention.corps) : "";
  return poserModele(db, fichiers, dossierId, "facture", htmlVersPdf(htmlFacture(dossier, organisme, devis)), ip, userAgent, maintenant);
}

async function poserModele(
  db: Preparer,
  fichiers: Stockage,
  dossierId: string,
  code: string,
  pdf: Uint8Array,
  ip: string,
  userAgent: string,
  maintenant: string,
): Promise<boolean> {
  const sha256 = await empreinte(pdf);
  if ((await lireShaModeles(db, dossierId)).get(code) === sha256) return true;
  if (!(await poser(fichiers, `scans/${sha256}`, pdf))) return false;
  await enregistrerModele(db, {
    dossierId,
    code,
    recuLe: maintenant,
    ip,
    userAgent,
    sha256,
    taille: pdf.byteLength,
  });
  return true;
}

function htmlAttestation(dossier: DossierComplet, organisme: Organisme): string {
  const fin = dossier.date_fin && dossier.date_fin.trim() !== "" ? `Fin : ${afficherJour(dossier.date_fin)}` : "";
  return documentHtml(
    "Attestation de formation",
    [dossier.stagiaire_nom, dossier.intitule].filter(Boolean).join(" · "),
    [
      sousTitre("Organisme"),
      paragraphes([
        organisme.nom,
        [organisme.adresse, organisme.code_postal, organisme.ville].filter(Boolean).join(" "),
        organisme.siret ? `SIRET ${organisme.siret}` : "",
        organisme.nda ? `NDA ${organisme.nda}` : "",
      ]),
      sousTitre("Stagiaire"),
      paragraphes([
        dossier.stagiaire_nom,
        dossier.entreprise,
        dossier.representant,
        dossier.entreprise_siret ? `SIRET ${dossier.entreprise_siret}` : "",
        dossier.entreprise_adresse,
      ]),
      sousTitre("Action"),
      paragraphes([
        dossier.intitule,
        dossier.modalite,
        `${dossier.heures_total} heures`,
        dossier.heures_coaching > 0 ? `${dossier.heures_coaching} heures de coaching` : "",
        dossier.heures_elearning > 0 ? `${dossier.heures_elearning} heures en e-learning` : "",
        `Début : ${afficherJour(dossier.date_debut)}`,
        fin,
      ]),
      sousTitre("Résultat de l'évaluation"),
    ].join(""),
  );
}

function htmlFacture(dossier: DossierComplet, organisme: Organisme, devis: string): string {
  const tva = tvaCentimes(dossier.prix_ht_centimes, dossier.tva_taux_bp);
  const fin = dossier.date_fin && dossier.date_fin.trim() !== "" ? afficherJour(dossier.date_fin) : "";
  const periode = fin ? `${afficherJour(dossier.date_debut)} – ${fin}` : afficherJour(dossier.date_debut);
  return documentHtml(
    "Facture",
    devis ? `Devis ${devis}` : "",
    [
      sousTitre("Émetteur"),
      paragraphes([
        organisme.nom,
        [organisme.adresse, organisme.code_postal, organisme.ville].filter(Boolean).join(" "),
        organisme.siret ? `SIRET ${organisme.siret}` : "",
        organisme.numero_tva ? `TVA ${organisme.numero_tva}` : "",
      ]),
      sousTitre("Client"),
      paragraphes([
        dossier.entreprise,
        dossier.representant || dossier.stagiaire_nom,
        dossier.entreprise_siret ? `SIRET ${dossier.entreprise_siret}` : "",
        dossier.entreprise_adresse,
      ]),
      sousTitre("Prestation"),
      paragraphes([dossier.intitule, dossier.modalite, `${dossier.heures_total} heures`, periode]),
      tableauLibre(
        ["Libellé", "Montant"],
        [
          ["Prix HT", afficherEuros(dossier.prix_ht_centimes)],
          [`TVA ${afficherTaux(dossier.tva_taux_bp)}`, afficherEuros(tva)],
          ["Prix TTC", afficherEuros(dossier.prix_ht_centimes + tva)],
        ],
      ),
    ].join(""),
  );
}

function htmlConvention(dossier: DossierComplet, organisme: Organisme, numero: string, devis: string): string {
  const ttc = dossier.prix_ht_centimes + tvaCentimes(dossier.prix_ht_centimes, dossier.tva_taux_bp);
  const meta = [numero ? `N° ${numero}` : "", devis ? `Devis ${devis}` : ""].filter(Boolean).join(" · ");
  const fin = dossier.date_fin && dossier.date_fin.trim() !== "" ? `Fin : ${afficherJour(dossier.date_fin)}` : "";
  return documentHtml(
    "Convention de formation",
    meta,
    [
      sousTitre("Organisme"),
      paragraphes([
        organisme.nom,
        [organisme.adresse, organisme.code_postal, organisme.ville].filter(Boolean).join(" "),
        organisme.siret ? `SIRET ${organisme.siret}` : "",
        organisme.nda ? `NDA ${organisme.nda}` : "",
        organisme.email,
      ]),
      sousTitre("Bénéficiaire"),
      paragraphes([
        dossier.entreprise,
        dossier.representant || dossier.stagiaire_nom,
        dossier.entreprise_siret ? `SIRET ${dossier.entreprise_siret}` : "",
        dossier.entreprise_adresse,
      ]),
      sousTitre("Formation"),
      paragraphes([dossier.intitule, dossier.modalite]),
      sousTitre("Durée"),
      paragraphes([
        `${dossier.heures_total} heures`,
        dossier.heures_coaching > 0 ? `${dossier.heures_coaching} heures de coaching` : "",
        dossier.heures_elearning > 0 ? `${dossier.heures_elearning} heures en e-learning` : "",
        `Début : ${afficherJour(dossier.date_debut)}`,
        fin,
      ]),
      sousTitre("Prix"),
      paragraphes([
        `${afficherEuros(dossier.prix_ht_centimes)} HT`,
        `TVA ${afficherTaux(dossier.tva_taux_bp)}`,
        `${afficherEuros(ttc)} TTC`,
      ]),
    ].join(""),
  );
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
  const programme = await lireContenuProgramme(db, dossier.id);
  const pdf = htmlVersPdf(
    htmlDevis({
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
      programme,
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

async function poserModeles(
  db: Preparer,
  fichiers: Stockage,
  dossier: DossierComplet,
  organisme: Organisme,
  programme: string,
  convention: string,
  shaActuels: Map<string, string>,
  ip: string,
  userAgent: string,
  maintenant: string,
  seulement: string | null,
): Promise<void> {
  for (const modele of textesModeles(dossier, organisme, programme, convention)) {
    if (seulement && modele.code !== seulement) continue;
    const pdf = htmlVersPdf(normaliserHtml(modele.texte));
    const sha256 = await empreinte(pdf);
    if (shaActuels.get(modele.code) === sha256) continue;
    if (!(await poser(fichiers, `scans/${sha256}`, pdf))) continue;
    try {
      await enregistrerModele(db, {
        dossierId: dossier.id,
        code: modele.code,
        recuLe: maintenant,
        ip,
        userAgent,
        sha256,
        taille: pdf.byteLength,
      });
    } catch {
      continue;
    }
  }
}

async function poserReglement(
  db: Preparer,
  fichiers: Stockage,
  dossierId: string,
  ip: string,
  userAgent: string,
  maintenant: string,
): Promise<void> {
  try {
    const reponse = await fetch(REGLEMENT_URL, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!reponse.ok) return;
    const octets = new Uint8Array(await reponse.arrayBuffer());
    if (!pdfReconnu(octets) || octets.byteLength > 2_000_000) return;
    const sha256 = await empreinte(octets);
    if (!(await poser(fichiers, `scans/${sha256}`, octets))) return;
    await enregistrerModele(db, {
      dossierId,
      code: "reglement",
      recuLe: maintenant,
      ip,
      userAgent,
      sha256,
      taille: octets.byteLength,
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

