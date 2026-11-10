import type { SaisieDossier } from "./dossiers.ts";
import type { VueGuide } from "./guide.ts";
import { MODELES, pieceProduite } from "./modeles.ts";
import { DOCUMENTS_ORGANISME } from "./organisme.ts";
import { afficherEuros, afficherJour, afficherTaux, numeroDevis, tvaCentimes } from "./montants.ts";

export type Fiche = {
  nom: string;
  siret: string;
  nda: string;
  adresse: string;
  code_postal: string;
  ville: string;
  telephone: string;
  email: string;
  numero_tva: string;
};

export type DossierVue = {
  id: string;
  stagiaire_nom: string;
  intitule: string;
  financeur: string;
  date_debut: string;
  date_fin: string | null;
  statut: string;
  prix_ht_centimes: number;
  tva_taux_bp: number;
};

export const FEUILLE = `
body { margin: 0; color: #1c1c1c; background: #f6f5f3; font-family: "Segoe UI", system-ui, sans-serif; }
main { max-width: 70rem; margin: 0 auto; padding: 1.25rem 1.25rem 3rem; }
h1 { font-size: 1.45rem; font-weight: 650; margin: 0; }
h2 { font-size: 1.05rem; margin: 1.25rem 0 0.45rem; }
p { line-height: 1.35; margin: 0.35rem 0; }
a { color: inherit; }
.geste { color: #4d4a45; }
.meta { color: #4d4a45; }
table.pieces td.liens { text-align: right; }
.actions { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 0.35rem; }
.actions a { display: inline-flex; align-items: center; padding: 0.28rem 0.45rem; border: 1px solid #b9b4ac; text-decoration: none; background: #fff; }
.actions form { display: flex; width: auto; gap: 0.35rem; align-items: center; margin: 0; }
.actions button { margin: 0; padding: 0.28rem 0.55rem; }
.actions input[type="file"] { width: 9.5rem; max-width: 9.5rem; font-size: 0.85rem; }
.actions select { width: auto; margin: 0; padding: 0.28rem 0.35rem; border: 1px solid #b9b4ac; background: #fff; font: inherit; }
.actions label.joindre { display: inline-flex; align-items: center; gap: 0.25rem; margin: 0; font-size: 0.85rem; }
.actions label.joindre input { width: auto; margin: 0; padding: 0; }
main.dossier table.pieces td { vertical-align: top; }
tr.piece td { padding: 0.75rem 0.9rem 0.85rem; vertical-align: top; }
.piece-entete { display: flex; flex-direction: column; align-items: flex-start; gap: 0.15rem; }
.piece-entete .nom { font-weight: 650; line-height: 1.3; }
.piece-entete .geste { line-height: 1.45; }
.piece-outils { display: flex; flex-direction: column; align-items: flex-start; gap: 0.45rem; width: 100%; margin-top: 0.55rem; }
.rang { display: flex; flex-wrap: wrap; justify-content: flex-start; align-items: center; gap: 0.4rem; }
.rang a { display: inline-flex; align-items: center; padding: 0.28rem 0.5rem; border: 1px solid #b9b4ac; text-decoration: none; background: #fff; }
.rang form { display: flex; width: auto; gap: 0.4rem; align-items: center; margin: 0; }
.rang button { margin: 0; padding: 0.28rem 0.55rem; }
.rang.depot form:has(input[type="file"]) { flex: 0 1 auto; max-width: 24rem; min-width: 0; }
.rang.depot form input[type="file"] { flex: 0 1 auto; width: 18rem; max-width: 20rem; min-width: 0; font-size: 0.85rem; }
.rang select { width: auto; margin: 0; padding: 0.28rem 0.35rem; border: 1px solid #b9b4ac; background: #fff; font: inherit; }
.rang label.joindre { display: inline-flex; align-items: center; gap: 0.25rem; margin: 0; font-size: 0.85rem; }
.rang label.joindre input { width: auto; margin: 0; padding: 0; }
details.anciennes > summary { margin: 0; padding: 0.28rem 0.45rem; border: 1px solid #b9b4ac; background: #fff; list-style: none; }
details.anciennes > summary::-webkit-details-marker { display: none; }
details.anciennes[open] .liste { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.35rem; margin-top: 0.35rem; }
dialog.confirmation { border: 1px solid #1c1c1c; padding: 0; background: #fff; color: inherit; max-width: 32rem; width: calc(100% - 2rem); }
dialog.confirmation::backdrop { background: rgb(28 28 28 / 0.45); }
dialog.confirmation form { margin: 0; padding: 1rem 1.1rem 1.1rem; }
dialog.confirmation h2 { margin: 0; font-size: 1.15rem; }
dialog.confirmation ul { list-style: none; margin: 0.8rem 0 0; padding: 0; }
dialog.confirmation li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.35rem 0.75rem; padding: 0.45rem 0; border-top: 1px solid #e4e0d8; }
dialog.confirmation label { display: flex; align-items: center; gap: 0.45rem; margin: 0; }
dialog.confirmation label input { width: auto; margin: 0; padding: 0; }
dialog.confirmation select { width: auto; margin: 0; padding: 0.28rem 0.35rem; border: 1px solid #b9b4ac; background: #fff; font: inherit; }
dialog.confirmation .motif { color: #4d4a45; font-size: 0.85rem; }
dialog.confirmation .barre-modale { display: flex; justify-content: flex-end; gap: 0.35rem; margin-top: 0.9rem; }
dialog.confirmation .barre-modale button { margin: 0; }
tr.moment th { background: #efece6; }
ul { margin: 0.4rem 0 0; padding-left: 1.2rem; }
li { margin: 0.35rem 0; }
.barre { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
.barre form { margin: 0; }
form.courriel { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; margin: 0.2rem 0 0.6rem; }
form.courriel label { display: flex; align-items: center; gap: 0.35rem; margin: 0; }
form.courriel input { width: 16rem; margin: 0; }
form.courriel button { margin: 0; }
.envois { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; margin: 0.2rem 0 0.8rem; }
.envois form { margin: 0; }
.envois button { margin: 0; }
.envois label.relire { display: inline-flex; align-items: center; gap: 0.35rem; margin: 0; }
.envois label.relire input { width: auto; margin: 0; padding: 0; }
.fiche, form.bloc { background: #fff; border: 1px solid #d9d6d0; padding: 0.75rem 0.9rem; }
form.bloc { max-width: 40rem; }
dl { display: grid; grid-template-columns: 7rem 1fr 7rem 1fr; gap: 0.28rem 0.7rem; margin: 0; }
dt { color: #4d4a45; }
dd { margin: 0; }
label { display: block; margin-top: 0.85rem; }
input, button { font: inherit; color: inherit; }
input { display: block; width: 100%; box-sizing: border-box; margin-top: 0.25rem; padding: 0.45rem 0.5rem; border: 1px solid #b9b4ac; background: #fff; }
.deux { display: grid; grid-template-columns: 1fr 1fr; gap: 0 1rem; }
button { margin-top: 1rem; padding: 0.45rem 0.8rem; border: 1px solid #1c1c1c; background: #1c1c1c; color: #fff; }
button.secondaire { margin: 0; background: #fff; color: #1c1c1c; }
.erreur { color: #8a1f1f; }
.avertissement { color: #6b4a12; }
details.plie { margin: 0.55rem 0; }
details.plie > summary { margin: 0; padding: 0.42rem 0.65rem; background: #efece6; border: 1px solid #d9d6d0; font-weight: 650; }
details.plie .table { border-top: 0; }
.table { overflow-x: auto; background: #fff; border: 1px solid #d9d6d0; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 0.32rem 0.5rem; border-bottom: 1px solid #e4e0d8; vertical-align: middle; }
summary { cursor: pointer; margin-top: 1rem; }
td form { display: flex; gap: 0.35rem; align-items: center; margin: 0; }
td form input { margin: 0; min-width: 8rem; }
td form input[type="file"] { width: auto; max-width: 11rem; min-width: 0; }
td form button { margin: 0; white-space: nowrap; }
@media (max-width: 40rem) { .deux, dl { grid-template-columns: 1fr; } }
`.trim();

export const SCRIPT = `
const relire = document.getElementById("relire-liste");
const memoire = "registre-relire";
try {
  if (relire && localStorage.getItem(memoire) === "0") relire.checked = false;
} catch {
  /* le navigateur refuse le stockage */
}
if (relire) {
  relire.addEventListener("change", () => {
    try {
      localStorage.setItem(memoire, relire.checked ? "1" : "0");
    } catch {
      /* le navigateur refuse le stockage */
    }
  });
}
for (const bouton of document.querySelectorAll("[data-modale]")) {
  bouton.addEventListener("click", (event) => {
    if (relire && !relire.checked) return;
    event.preventDefault();
    const id = bouton.getAttribute("data-modale");
    const dialogue = id ? document.getElementById(id) : null;
    if (dialogue instanceof HTMLDialogElement && !dialogue.open) dialogue.showModal();
  });
}
for (const dialogue of document.querySelectorAll("dialog.confirmation")) {
  dialogue.addEventListener("click", (event) => {
    if (event.target === dialogue) dialogue.close();
  });
}
`.trim();

export function pageConnexion(csrf: string, erreur: string | null): string {
  return document(`
<h1>Registre</h1>
${paragrapheErreur(erreur)}
<form class="bloc" method="post" action="/connexion">
<input type="hidden" name="csrf" value="${echapper(csrf)}">
<label for="phrase">Phrase</label>
<input id="phrase" name="phrase" type="password" autocomplete="current-password" spellcheck="false" required minlength="20" autofocus>
<button type="submit">Ouvrir</button>
</form>`);
}

export type Reprise = {
  sha256: string;
  numero: string;
  devis: string;
};

export function pageAccueil(
  fiche: Fiche,
  dossiers: readonly DossierVue[],
  csrf: string,
  erreur: string | null,
  saisie: SaisieDossier,
  reprise: Reprise | null = null,
  guide: VueGuide | null = null,
  publies: readonly { code: string; version: number }[] = [],
): string {
  return document(`
<div class="barre">
<h1>Registre</h1>
<form method="post" action="/sortie">
<input type="hidden" name="csrf" value="${echapper(csrf)}">
<button class="secondaire" type="submit">Fermer l'accès</button>
</form>
</div>
<section class="fiche">
<dl>
${ligne("Nom", fiche.nom)}
${ligne("SIRET", fiche.siret)}
${ligne("NDA", fiche.nda)}
${ligne("Adresse", [fiche.adresse, fiche.code_postal, fiche.ville].filter(Boolean).join(" "))}
${ligne("Téléphone", fiche.telephone)}
${ligne("E-mail", fiche.email)}
${ligne("N° TVA", fiche.numero_tva)}
</dl>
</section>
${guide ? coinAudit(guide, csrf, publies) : ""}
<h2>Dossiers</h2>
${tableau(dossiers)}
<h2>Ouvrir un dossier</h2>
${paragrapheErreur(erreur)}
${reprise ? identiteConvention(reprise) : ""}
${reprise ? formulaireComplet(csrf, saisie, reprise) : formulaireDepot(csrf)}
`);
}

function formulaireDepot(csrf: string): string {
  return `<form class="bloc" method="post" action="/dossiers" enctype="multipart/form-data">
<input type="hidden" name="csrf" value="${echapper(csrf)}">
<label for="convention">Convention
<input id="convention" name="convention" type="file" accept="application/pdf" required>
</label>
<button type="submit">Ouvrir le dossier</button>
</form>`;
}

function formulaireComplet(csrf: string, saisie: SaisieDossier, reprise: Reprise): string {
  return `<form class="bloc" method="post" action="/dossiers">
<input type="hidden" name="csrf" value="${echapper(csrf)}">
<input type="hidden" name="sha256" value="${echapper(reprise.sha256)}">
<input type="hidden" name="numero" value="${echapper(reprise.numero)}">
<input type="hidden" name="devis" value="${echapper(reprise.devis)}">
${champ("stagiaire_nom", "Nom du stagiaire", saisie.stagiaire_nom, "text")}
${champ("stagiaire_email", "E-mail", saisie.stagiaire_email, "email")}
${champ("stagiaire_tel", "Téléphone", saisie.stagiaire_tel, "tel")}
<div class="deux">
${champ("entreprise", "Entreprise", saisie.entreprise, "text")}
${champ("entreprise_siret", "SIRET de l'entreprise", saisie.entreprise_siret, "text")}
</div>
${champ("entreprise_adresse", "Adresse de l'entreprise", saisie.entreprise_adresse, "text")}
${champ("representant", "Représentant", saisie.representant, "text")}
<div class="deux">
${champ("financeur", "Financeur", saisie.financeur, "text")}
${champ("financeur_dossier", "N° de dossier financeur", saisie.financeur_dossier, "text")}
</div>
${champ("intitule", "Intitulé", saisie.intitule, "text")}
<div class="deux">
${champ("date_debut", "Début", saisie.date_debut, "date")}
${champ("date_fin", "Fin", saisie.date_fin, "date")}
</div>
<div class="deux">
${champ("heures_total", "Heures", saisie.heures_total, "number")}
${champ("modalite", "Modalité", saisie.modalite, "text")}
</div>
<div class="deux">
${champ("heures_coaching", "Heures de coaching", saisie.heures_coaching, "number")}
${champ("heures_elearning", "Heures de e-learning", saisie.heures_elearning, "number")}
</div>
<div class="deux">
${champ("prix_ht", "Prix HT, en euros", saisie.prix_ht, "text")}
${champ("tva", "TVA, en pourcentage", saisie.tva, "text")}
</div>
<button type="submit">Enregistrer le dossier</button>
</form>`;
}

function identiteConvention(reprise: Reprise): string {
  const lignes = [
    reprise.numero ? `Convention ${reprise.numero}` : "",
    reprise.devis ? `Devis ${reprise.devis}` : "",
  ].filter(Boolean);
  if (lignes.length === 0) return "";
  return lignes.map((ligne) => `<p>${echapper(ligne)}</p>`).join("");
}

export type MomentEnvoi = {
  moment: string;
  titre: string;
  lignes: readonly {
    code: string;
    libelle: string;
    motif: string;
    coche: boolean;
    versions: readonly number[];
    signe: boolean;
  }[];
};

export type PiecesVues = {
  convention: boolean;
  programme: boolean;
  devis: { annee: number; numero: number } | null;
  numeroConvention: string;
  modeles: readonly string[];
  tenus: readonly string[];
  versions: readonly { code: string; version: number }[];
  signes: readonly string[];
  moments: readonly MomentEnvoi[];
};

export function bilanDossier(pieces: Pick<PiecesVues, "tenus" | "signes" | "programme">, heuresElearning: number): string {
  const tenu = (code: string) => pieces.tenus.includes(code) || pieces.signes.includes(code);
  const manques = [
    !pieces.signes.includes("devis") ? "le devis signé" : "",
    !tenu("analyse") ? "l'analyse du besoin" : "",
    !tenu("positionnement") ? "le positionnement" : "",
    !pieces.signes.includes("convention") ? "la convention signée" : "",
    !pieces.programme ? "le programme" : "",
    !pieces.signes.includes("reglement") ? "le règlement signé" : "",
    !tenu("convocation") ? "la convocation envoyée" : "",
  ].filter(Boolean);
  const avant = manques.length > 0
    ? `Avant la formation : il manque ${manques.join(", ")}.`
    : "Avant la formation : les pièces signées et envoyées sont au registre.";
  if (heuresElearning <= 0) return avant;
  const releve = tenu("connexion")
    ? "Le relevé de connexion est au registre."
    : "Le relevé de connexion des heures à distance se dépose, il ne se produit pas.";
  return `${avant} ${releve}`;
}

export function pageDossier(
  dossier: DossierVue & {
    entreprise: string;
    entreprise_siret: string;
    entreprise_adresse: string;
    stagiaire_email: string;
    heures_total: number;
    heures_elearning: number;
    modalite: string;
  },
  pieces: PiecesVues,
  csrf: string,
  maintenant: Date,
  erreur: string | null = null,
  info: string | null = null,
): string {
  const ttc = dossier.prix_ht_centimes + tvaCentimes(dossier.prix_ht_centimes, dossier.tva_taux_bp);
  const debut = dossier.date_debut;
  const fin = dossier.date_fin && dossier.date_fin.trim() !== "" ? dossier.date_fin : null;
  const tenu = (code: string) =>
    pieces.tenus.includes(code) || (code === "convention" && pieces.convention) || (code === "programme" && pieces.programme);
  const avant = (code: string, action: string) => echeanceAvant(action, debut, maintenant, tenu(code));
  const signe = (code: string) => pieces.signes.includes(code);
  const devis = echeanceAvant("À signer", debut, maintenant, signe("devis"));
  const analyse = avant("analyse", "À renvoyer");
  const positionnement = avant("positionnement", "À renvoyer");
  const convention = avant("convention", "À signer");
  const programme = avant("programme", "À joindre à la convention");
  const reglement = echeanceAvant("À signer", debut, maintenant, signe("reglement"));
  const convocation = avant("convocation", "À envoyer");
  return document(`
<div class="barre">
<h1>${echapper(dossier.stagiaire_nom)}</h1>
<form method="post" action="/sortie">
<input type="hidden" name="csrf" value="${echapper(csrf)}">
<button class="secondaire" type="submit">Fermer l'accès</button>
</form>
</div>
<p class="meta"><a href="/">Dossiers</a> · <a href="/#audit">Pour l'audit</a>${pieces.numeroConvention ? ` · Convention ${echapper(pieces.numeroConvention)}` : ""}</p>
<p>${echapper(dossier.intitule)}</p>
<p class="meta">${[dossier.entreprise, periode(dossier.date_debut, dossier.date_fin), `${dossier.heures_total} h`, afficherEuros(dossier.prix_ht_centimes) + " HT"].filter(Boolean).map((valeur) => echapper(valeur)).join(" · ")}</p>
<h2>Pièces</h2>
<p>${echapper(bilanDossier(pieces, dossier.heures_elearning))}</p>
${paragrapheErreur(erreur)}
${info ? `<p>${echapper(info)}</p>` : ""}
<p class="meta">${dossier.stagiaire_email.trim() ? `Envoi à ${echapper(dossier.stagiaire_email.trim())}` : "Pas d'e-mail sur le dossier."}</p>
${formulaireEmail(dossier.id, dossier.stagiaire_email, csrf)}
<div class="envois">
${boutonsEnvoi(dossier.id, csrf)}
</div>
${modalesEnvoi(dossier.stagiaire_email, pieces.moments)}
${classeurs([
  ["devis", lignePiece(dossier.id, "devis", pieces.devis ? `Devis ${numeroDevis(pieces.devis.annee, pieces.devis.numero)}` : "Devis", devis.texte, numeros(pieces, "devis"), csrf, devis.retard, false, signe("devis"))],
  ["analyse", lignePiece(dossier.id, "analyse", libelleModele("analyse"), analyse.texte, numeros(pieces, "analyse"), csrf, analyse.retard, false, signe("analyse"))],
  ["positionnement", lignePiece(dossier.id, "positionnement", libelleModele("positionnement"), positionnement.texte, numeros(pieces, "positionnement"), csrf, positionnement.retard, false, signe("positionnement"))],
  ["convention", lignePiece(dossier.id, "convention", "Convention", convention.texte, numeros(pieces, "convention"), csrf, convention.retard, true, signe("convention"))],
  ["programme", lignePiece(dossier.id, "programme", "Programme", programme.texte, numeros(pieces, "programme"), csrf, programme.retard, true, signe("programme"))],
  ["reglement", lignePiece(dossier.id, "reglement", libelleModele("reglement"), reglement.texte, numeros(pieces, "reglement"), csrf, reglement.retard, true, signe("reglement"))],
  ["convocation", lignePiece(dossier.id, "convocation", libelleModele("convocation"), convocation.texte, numeros(pieces, "convocation"), csrf, convocation.retard, false, signe("convocation"))],
  ["emargement", lignePiece(dossier.id, "emargement", libelleModele("emargement"), tenu("emargement") ? "Au registre." : echeanceDes("À signer à chaque séance de coaching.", debut, maintenant), numeros(pieces, "emargement"), csrf, false, false, signe("emargement"))],
  ["suivi", dossier.heures_elearning > 0 ? lignePiece(dossier.id, "suivi", libelleModele("suivi"), tenu("suivi") ? "Au registre." : echeanceDes("À tenir pour les heures à distance.", debut, maintenant), numeros(pieces, "suivi"), csrf, false, false, signe("suivi")) : ""],
  ["connexion", dossier.heures_elearning > 0 ? lignePiece(dossier.id, "connexion", "Relevé de connexion", tenu("connexion") ? "Au registre." : echeanceDes("À déposer depuis la plateforme.", debut, maintenant), numeros(pieces, "connexion"), csrf, false, false, false) : ""],
  ["qcm", lignePiece(dossier.id, "qcm", libelleModele("qcm"), tenu("qcm") ? "Au registre." : echeanceApres("En fin de parcours.", debut, fin, maintenant), numeros(pieces, "qcm"), csrf, false, false, signe("qcm"))],
  ["attestation", lignePiece(dossier.id, "attestation", "Attestation", tenu("attestation") ? "Au registre." : echeanceApres("Quand les retours sont là.", debut, fin, maintenant), numeros(pieces, "attestation"), csrf, false, false, signe("attestation"))],
  ["facture", lignePiece(dossier.id, "facture", "Facture", tenu("facture") ? "Au registre." : echeanceApres("Après l'attestation.", debut, fin, maintenant), numeros(pieces, "facture"), csrf, false, false, signe("facture"))],
], "", false)}
<details>
<summary>Identité</summary>
<section class="fiche">
<dl>
${ligne("Entreprise", dossier.entreprise)}
${ligne("E-mail", dossier.stagiaire_email)}
${ligne("SIRET", dossier.entreprise_siret)}
${ligne("Adresse", dossier.entreprise_adresse)}
${ligne("Financeur", dossier.financeur)}
${ligne("Dates", periode(dossier.date_debut, dossier.date_fin))}
${ligne("Heures", String(dossier.heures_total))}
${ligne("Modalité", dossier.modalite)}
${ligne("Prix HT", afficherEuros(dossier.prix_ht_centimes))}
${ligne("TVA", afficherTaux(dossier.tva_taux_bp))}
${ligne("Prix TTC", afficherEuros(ttc))}
${ligne("Statut", statut(dossier.statut))}
</dl>
</section>
</details>
`, "dossier");
}

function libelleModele(code: string): string {
  return MODELES.find(([valeur]) => valeur === code)?.[1] ?? code;
}

const RANGS: { titre: string; codes: readonly string[] }[] = [
  { titre: "00 Général", codes: ["certificat"] },
  { titre: "01 Communication", codes: ["devis", "convocation", "reglement", "resultats", "engagement", "catalogue", "cgv"] },
  { titre: "02 Actions réalisées", codes: ["convention", "emargement", "suivi", "connexion", "qcm", "attestation", "facture"] },
  { titre: "03 Veille", codes: ["veille_legale", "veille_metiers", "veille_pedagogique"] },
  { titre: "04 Moyens humains", codes: ["analyse", "positionnement", "programme", "moyens", "intervenants", "competences", "maintien"] },
  { titre: "05 Handicap et accessibilité", codes: ["handicap", "accessibilite"] },
  { titre: "06 Réclamations", codes: ["reclamations"] },
  { titre: "07 Amélioration continue", codes: ["appreciations", "auto_evaluation", "risques"] },
];

function coinAudit(guide: VueGuide, csrf: string, publies: readonly { code: string; version: number }[]): string {
  const ecarts = guide.lignes.filter((ligne) => ligne.statut === "pas_tenu");
  const tenus = guide.lignes.filter((ligne) => ligne.statut === "tenu").map((ligne) => String(ligne.numero));
  const hors = guide.lignes.filter((ligne) => ligne.statut === "hors").map((ligne) => String(ligne.numero));
  const bilan = [
    tenus.length > 0 ? `Tenus : ${tenus.join(", ")}` : "",
    hors.length > 0 ? `Hors champ : ${hors.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(". ");
  const lignePieceAudit = (piece: VueGuide["pieces"][number]) => {
    const base = `/audit/${piece.code}`;
    const versions = [...piece.anterieures.map((ancienne) => ancienne.version), ...(piece.courante ? [piece.courante.version] : [])];
    const etat = piece.courante
      ? `${piece.periode} · ${instantParis(piece.courante.poseLe)}${piece.fraiche ? "" : ", à refaire"}`
      : `${piece.periode} · ${piece.vide}`;
    const fichier = piece.courante ? `${liensCourant(base, versions)}${liensAnciennes(base, versions)}` : "";
    return blocPiece(piece.libelle, etat, [
      fichier ? `<div class="rang">${fichier}</div>` : "",
      `<div class="rang depot">${depotPiece(csrf, piece)}</div>`,
    ]);
  };
  const parCode = new Map(guide.pieces.map((piece) => [piece.code, lignePieceAudit(piece)]));
  for (const document of DOCUMENTS_ORGANISME) {
    const base = `/organisme/${document.code}`;
    const reprendre = `<form method="post" action="${echapper(base)}/reprendre"><input type="hidden" name="csrf" value="${echapper(csrf)}"><button type="submit">Nouvelle version</button></form>`;
    parCode.set(document.code, ligneDocument(document.libelle, "À présenter", base, numerosPublies(publies, document.code), reprendre));
  }
  const verifie = guide.verifieLe ? `Vérifié le ${instantParis(guide.verifieLe)}` : "";
  const entete = [guide.version, verifie].filter(Boolean).join(" · ");
  const tout = `<form method="post" action="/audit/produire"><input type="hidden" name="csrf" value="${echapper(csrf)}"><button type="submit">Tout produire</button></form>`;
  const zero =
    ecarts.length > 0
      ? tableauNu(ecarts.map((ligne) => blocPiece(String(ligne.numero), ligne.detail, [], false, false, ligne.titre)).join(""), false)
      : "";
  return `<h2 id="audit">Pour l'audit</h2>
<p>${echapper(guide.verdict)}</p>
${entete ? `<p class="meta">${echapper(entete)}</p>` : ""}
${bilan ? `<p class="meta">${echapper(bilan)}.</p>` : ""}
${guide.erreur ? `<p class="erreur">${echapper(guide.erreur)}</p>` : ""}
${guide.aLire ? formulaireLu(csrf) : ""}
${tout}
${classeurs([...parCode], zero, false)}`;
}

function formulaireLu(csrf: string): string {
  return `<p>Le guide a changé.</p>
<form class="bloc" method="post" action="/guide/lu">
<input type="hidden" name="csrf" value="${echapper(csrf)}">
<label>Ce que tu en fais
<input name="note" required maxlength="2000">
</label>
<button type="submit">C'est lu</button>
</form>`;
}

function depotPiece(csrf: string, piece: VueGuide["pieces"][number]): string {
  const produire = piece.produit
    ? `<form method="post" action="/audit/${echapper(piece.code)}/produire"><input type="hidden" name="csrf" value="${echapper(csrf)}"><button type="submit">Produire</button></form>`
    : "";
  const depot = `<form method="post" action="/audit/${echapper(piece.code)}" enctype="multipart/form-data"><input type="hidden" name="csrf" value="${echapper(csrf)}"><input name="fichier" type="file" accept="application/pdf" required aria-label="Nouvelle version"><button type="submit">Déposer</button></form>`;
  return `${produire}${depot}`;
}

function instantParis(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "long" }).format(date);
}

function classeurs(lignes: Iterable<readonly [string, string]>, avant = "", entete = true): string {
  const parCode = new Map(lignes);
  return RANGS.map((groupe, index) => {
    const corps = groupe.codes.map((code) => parCode.get(code) ?? "").join("");
    return accordeon(groupe.titre, `${index === 0 ? avant : ""}${tableauNu(corps, entete)}`);
  }).join("");
}

function accordeon(titre: string, contenu: string): string {
  if (contenu.trim() === "") return "";
  return `<details class="plie" open><summary>${echapper(titre)}</summary>${contenu}</details>`;
}

function tableauNu(lignes: string, entete = true): string {
  if (lignes.trim() === "") return "";
  const tete = entete ? `<thead><tr><th>Pièce</th><th>À faire</th><th></th></tr></thead>` : "";
  return `<div class="table"><table class="pieces">
${tete}<tbody>${lignes}</tbody>
</table></div>`;
}

function numeros(pieces: PiecesVues, code: string): number[] {
  return pieces.versions.filter((ligne) => ligne.code === code).map((ligne) => ligne.version);
}

function numerosPublies(publies: readonly { code: string; version: number }[], code: string): number[] {
  return publies.filter((ligne) => ligne.code === code).map((ligne) => ligne.version);
}

function formulaireEmail(id: string, email: string, csrf: string): string {
  return `<form class="courriel" method="post" action="${echapper(`/dossiers/${id}/email`)}">
<input type="hidden" name="csrf" value="${echapper(csrf)}">
<label>E-mail <input name="email" type="email" value="${echapper(email.trim())}" required autocomplete="off"></label>
<button type="submit">Enregistrer</button>
</form>`;
}

function boutonsEnvoi(id: string, csrf: string): string {
  const bouton = (moment: string, libelle: string) =>
    `<button type="submit" form="envoi" name="moment" value="${echapper(moment)}" data-modale="envoi-${echapper(moment)}">${echapper(libelle)}</button>`;
  return `<form id="envoi" method="post" action="${echapper(`/dossiers/${id}/courrier`)}"><input type="hidden" name="csrf" value="${echapper(csrf)}"><input type="hidden" name="choix" value="1"></form><label class="relire"><input type="checkbox" id="relire-liste" checked> Relire la liste</label><label class="relire"><input form="envoi" type="checkbox" name="copie" value="1"> Recevoir une copie</label>${bouton("avant", "Envoyer l'avant")}${bouton("pendant", "Envoyer le pendant")}${bouton("apres", "Envoyer l'après")}`;
}

function modalesEnvoi(email: string, moments: readonly MomentEnvoi[]): string {
  const dest = email.trim() ? `Envoi à ${echapper(email.trim())}` : "Pas d'e-mail sur le dossier.";
  return moments
    .map((moment) => {
      const lignes = moment.lignes
        .map((ligne) => {
          const select = ligne.versions.length > 0 || ligne.signe ? choixEnvoi(ligne.code, ligne.libelle, ligne.versions, ligne.signe) : "";
          const motif = ligne.motif ? `<span class="motif">${echapper(precision(ligne.libelle, ligne.motif))}</span>` : "";
          return `<li><label><input form="envoi" type="checkbox" name="inclure" value="${echapper(ligne.code)}"${ligne.coche ? " checked" : ""}> ${echapper(ligne.libelle)}</label>${select}${motif}</li>`;
        })
        .join("");
      return `<dialog id="envoi-${echapper(moment.moment)}" class="confirmation" closedby="any" aria-labelledby="titre-envoi-${echapper(moment.moment)}">
<form method="dialog">
<h2 id="titre-envoi-${echapper(moment.moment)}">${echapper(moment.titre)}</h2>
<p class="meta">${dest}</p>
<ul>${lignes}</ul>
<div class="barre-modale"><button class="secondaire" type="submit" value="cancel">Annuler</button><button type="submit" form="envoi" name="moment" value="${echapper(moment.moment)}">Envoyer</button></div>
</form>
</dialog>`;
    })
    .join("");
}

function precision(libelle: string, motif: string): string {
  if (motif.startsWith(`${libelle}, `)) return motif.slice(libelle.length + 2);
  if (motif.startsWith(`${libelle} `)) return motif.slice(libelle.length + 1);
  return motif;
}

function choixEnvoi(code: string, libelle: string, versions: readonly number[], signe: boolean): string {
  const numeros = [...new Set(versions)].sort((a, b) => b - a);
  const options = [
    ...numeros.map((version) => ({ valeur: String(version), libelle: `v${version}` })),
    ...(signe ? [{ valeur: "signe", libelle: "Signé" }] : []),
  ];
  if (options.length < 2) return "";
  const choix = options
    .map(
      (option, index) =>
        `<option value="${echapper(option.valeur)}"${index === 0 ? " selected" : ""}>${echapper(option.libelle)}</option>`,
    )
    .join("");
  return `<select form="envoi" name="${echapper(code)}" aria-label="${echapper(`Version de ${libelle}`)}">${choix}</select>`;
}

function blocPiece(nom: string, geste: string, rangs: readonly string[] = [], retard = false, figee = false, titre = ""): string {
  const avertissement = figee ? ` <span class="avertissement">Ne se produit pas.</span>` : "";
  const classe = retard ? " erreur" : "";
  const outils = rangs.filter(Boolean).join("");
  const titreAttribut = titre ? ` title="${echapper(titre)}"` : "";
  return `<tr class="piece"><td colspan="3"><div class="piece-entete"><span class="nom"${titreAttribut}>${echapper(nom)}</span><span class="geste${classe}">${echapper(geste)}${avertissement}</span></div>${outils ? `<div class="piece-outils">${outils}</div>` : ""}</td></tr>`;
}

function lignePiece(id: string, code: string, libelle: string, geste: string, versions: readonly number[], csrf: string, retard = false, figee = false, signe = false): string {
  const base = `/dossiers/${id}/${code}`;
  const produire = pieceProduite(code)
    ? `<form method="post" action="${echapper(base)}/produire"><input type="hidden" name="csrf" value="${echapper(csrf)}"><button type="submit">Produire</button></form>`
    : "";
  const depot = `<form method="post" action="${echapper(base)}" enctype="multipart/form-data"><input type="hidden" name="csrf" value="${echapper(csrf)}"><input name="fichier" type="file" accept="application/pdf" required aria-label="Déposer ${echapper(libelle)} signé"><button type="submit">Déposer</button></form>`;
  const signeLien = signe ? `<a href="${echapper(`${base}/signe/apercu`)}" target="_blank" rel="noopener">Signé</a>` : "";
  const fichier = versions.length > 0 ? `${liensCourant(base, versions)}${signeLien}${liensAnciennes(base, versions)}` : signeLien;
  return blocPiece(libelle, geste, [fichier ? `<div class="rang">${fichier}</div>` : "", `<div class="rang depot">${produire}${depot}</div>`], retard, figee);
}

function ligneDocument(libelle: string, geste: string, base: string, versions: readonly number[], suite = "", retard = false, toujoursLien = true, figee = false): string {
  const fichier = versions.length > 0 ? `${liensCourant(base, versions)}${liensAnciennes(base, versions)}` : toujoursLien ? liensAcces(base) : "";
  return blocPiece(libelle, geste, [fichier ? `<div class="rang">${fichier}</div>` : "", suite ? `<div class="rang depot">${suite}</div>` : ""], retard, figee);
}

function liensAcces(base: string): string {
  return `<a href="${echapper(`${base}/apercu`)}" target="_blank" rel="noopener">Aperçu</a><a href="${echapper(base)}">Télécharger</a>`;
}

function liensCourant(base: string, versions: readonly number[]): string {
  const derniere = Math.max(...versions);
  return `${liensAcces(base)}<span>v${derniere}</span>`;
}

function versionsAnciennes(versions: readonly number[]): number[] {
  const derniere = Math.max(...versions);
  return [...new Set(versions)].filter((version) => version !== derniere).sort((a, b) => a - b);
}

function liensAnciennes(base: string, versions: readonly number[]): string {
  const anciennes = versionsAnciennes(versions);
  if (anciennes.length === 0) return "";
  const liens = anciennes.map((version) => `<a href="${echapper(`${base}/${version}`)}">v${version}</a>`).join("");
  if (anciennes.length === 1) return liens;
  const premier = anciennes[0];
  const dernier = anciennes[anciennes.length - 1];
  return `<details class="anciennes"><summary>v${premier}–v${dernier}</summary><span class="liste">${liens}</span></details>`;
}

export function echeanceAvant(action: string, debut: string, maintenant: Date, fait: boolean): { texte: string; retard: boolean } {
  const jour = jourLong(debut);
  if (fait) return { texte: "Au registre.", retard: false };
  if (jourAtteint(debut, maintenant)) return { texte: `En retard. ${action} avant le ${jour}.`, retard: true };
  return { texte: `${action} avant le ${jour}.`, retard: false };
}

export function echeanceDes(action: string, debut: string, maintenant: Date): string {
  const jour = jourLong(debut);
  if (jourAtteint(debut, maintenant)) return `Depuis le ${jour}. ${action}`;
  return `À partir du ${jour}. ${action}`;
}

export function echeanceApres(action: string, debut: string, fin: string | null, maintenant: Date): string {
  if (fin) {
    const jour = jourLong(fin);
    if (jourAtteint(fin, maintenant)) return `Depuis le ${jour}. ${action}`;
    return `Après le ${jour}. ${action}`;
  }
  if (!jourAtteint(debut, maintenant)) return `Pas avant le ${jourLong(debut)}. ${action}`;
  return action;
}

function jourAtteint(iso: string, maintenant: Date): boolean {
  return jourParis(maintenant) >= iso;
}

function jourParis(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function jourLong(iso: string): string {
  const parties = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!parties) return iso;
  const date = new Date(Date.UTC(Number(parties[1]), Number(parties[2]) - 1, Number(parties[3]), 12));
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" }).format(date);
}

function tableau(dossiers: readonly DossierVue[]): string {
  if (dossiers.length === 0) return "<p>Aucun dossier.</p>";
  const lignes = dossiers
    .map(
      (dossier) => `<tr>
<td><a href="/dossiers/${echapper(dossier.id)}">${echapper(dossier.stagiaire_nom)}</a></td>
<td>${echapper(dossier.intitule)}</td>
<td>${echapper(dossier.financeur)}</td>
<td>${echapper(periode(dossier.date_debut, dossier.date_fin))}</td>
<td>${echapper(afficherEuros(dossier.prix_ht_centimes))}</td>
<td>${echapper(afficherTaux(dossier.tva_taux_bp))}</td>
<td>${echapper(statut(dossier.statut))}</td>
</tr>`,
    )
    .join("");
  return `<div class="table"><table>
<thead><tr><th>Stagiaire</th><th>Intitulé</th><th>Financeur</th><th>Dates</th><th>Prix HT</th><th>TVA</th><th>Statut</th></tr></thead>
<tbody>${lignes}</tbody>
</table></div>`;
}

function champ(nom: string, libelle: string, valeur: string, type: string): string {
  const extras = type === "number" ? ` min="0" step="1"` : "";
  return `<label>${echapper(libelle)}
<input name="${nom}" type="${type}" value="${echapper(valeur)}"${extras}>
</label>`;
}

function ligne(libelle: string, valeur: string): string {
  if (!valeur.trim()) return "";
  return `<dt>${echapper(libelle)}</dt><dd>${echapper(valeur)}</dd>`;
}

function paragrapheErreur(message: string | null): string {
  if (!message) return "";
  return `<p class="erreur">${echapper(message)}</p>`;
}

function document(corps: string, classe = ""): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Registre</title>
<link rel="stylesheet" href="/registre.css">
${classe === "dossier" ? `<script src="/registre.js" defer></script>` : ""}
</head>
<body>
<main${classe ? ` class="${echapper(classe)}"` : ""}>
${corps}
</main>
</body>
</html>
`;
}

function echapper(valeur: string): string {
  return valeur
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function periode(debut: string, fin: string | null): string {
  if (!fin) return afficherJour(debut);
  return `${afficherJour(debut)} – ${afficherJour(fin)}`;
}

function statut(valeur: string): string {
  if (valeur === "ouvert") return "Ouvert";
  if (valeur === "en_cours") return "En cours";
  if (valeur === "clos") return "Clos";
  return valeur;
}
