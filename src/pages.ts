import type { SaisieDossier } from "./dossiers.ts";
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
main { max-width: 52rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
h1 { font-size: 1.6rem; font-weight: 650; margin: 0; }
h2 { font-size: 1.15rem; margin: 1.6rem 0 0.6rem; }
p { line-height: 1.4; }
a { color: inherit; }
ul { margin: 0.4rem 0 0; padding-left: 1.2rem; }
li { margin: 0.35rem 0; }
.barre { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
.barre form { margin: 0; }
.fiche, form.bloc { background: #fff; border: 1px solid #d9d6d0; padding: 1rem 1.1rem 1.2rem; }
dl { display: grid; grid-template-columns: 8rem 1fr; gap: 0.35rem 0.8rem; margin: 0; }
dt { color: #4d4a45; }
dd { margin: 0; }
label { display: block; margin-top: 0.85rem; }
input, button { font: inherit; color: inherit; }
input { display: block; width: 100%; box-sizing: border-box; margin-top: 0.25rem; padding: 0.45rem 0.5rem; border: 1px solid #b9b4ac; background: #fff; }
.deux { display: grid; grid-template-columns: 1fr 1fr; gap: 0 1rem; }
button { margin-top: 1rem; padding: 0.45rem 0.8rem; border: 1px solid #1c1c1c; background: #1c1c1c; color: #fff; }
button.secondaire { margin: 0; background: #fff; color: #1c1c1c; }
.erreur { color: #8a1f1f; }
.table { overflow-x: auto; background: #fff; border: 1px solid #d9d6d0; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 0.45rem 0.55rem; border-bottom: 1px solid #e4e0d8; vertical-align: top; }
@media (max-width: 40rem) { .deux, dl { grid-template-columns: 1fr; } }
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

export type PiecesVues = {
  convention: boolean;
  programme: boolean;
  devis: { annee: number; numero: number } | null;
  numeroConvention: string;
};

export function pageDossier(
  dossier: DossierVue & {
    entreprise: string;
    entreprise_siret: string;
    entreprise_adresse: string;
    heures_total: number;
    modalite: string;
  },
  pieces: PiecesVues,
  csrf: string,
): string {
  const ttc = dossier.prix_ht_centimes + tvaCentimes(dossier.prix_ht_centimes, dossier.tva_taux_bp);
  return document(`
<div class="barre">
<h1>${echapper(dossier.stagiaire_nom)}</h1>
<form method="post" action="/sortie">
<input type="hidden" name="csrf" value="${echapper(csrf)}">
<button class="secondaire" type="submit">Fermer l'accès</button>
</form>
</div>
<p><a href="/">Tous les dossiers</a></p>
<p>${echapper(dossier.intitule)}</p>
${pieces.numeroConvention ? `<p>Convention ${echapper(pieces.numeroConvention)}</p>` : ""}
<h2>Pièces</h2>
<ul>
${elementPiece(dossier.id, "convention", "Convention", pieces.convention)}
${elementPiece(dossier.id, "programme", "Programme", pieces.programme)}
${elementPiece(dossier.id, "devis", pieces.devis ? `Devis ${numeroDevis(pieces.devis.annee, pieces.devis.numero)}` : "Devis", pieces.devis !== null)}
</ul>
<section class="fiche">
<dl>
${ligne("Entreprise", dossier.entreprise)}
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
</section>`);
}

function elementPiece(id: string, code: string, libelle: string, present: boolean): string {
  if (!present) return "";
  return `<li>${echapper(libelle)} <a href="/dossiers/${echapper(id)}/${code}">Télécharger</a></li>`;
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

function document(corps: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Registre</title>
<link rel="stylesheet" href="/registre.css">
</head>
<body>
<main>
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
