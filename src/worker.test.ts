import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ecrirePdf } from "./pdf-ecrit.ts";
import { textePdf } from "./pdf.ts";
import { NOM_CSRF, NOM_SESSION } from "./cookies.ts";
import type { Preparer, RequeteLiee } from "./db.ts";
import { deriver } from "./mot-de-passe.ts";
import { CSP, HSTS } from "./entetes.ts";
import { repondre, type Env } from "./worker.ts";

const PHRASE = "une phrase assez longue";
const AUTRE = "une autre phrase longue";
const ORIGINE = "https://registre.formation.deter-mi.net";

describe("worker", () => {
  it("répond 503 sans formulaire tant que le hash est vide", async () => {
    const reponse = await repondre(demande("GET", "/"), base(null));
    expect(reponse.status).toBe(503);
    await assertSansFormulaire(reponse, "Le mot de passe n'est pas posé.\n");
  });

  it("répond 503 aussi en POST", async () => {
    const reponse = await repondre(demande("POST", "/"), base(""));
    expect(reponse.status).toBe(503);
    expect(await reponse.text()).toBe("Le mot de passe n'est pas posé.\n");
  });

  it("répond 503 si la base ne répond pas, sans détail", async () => {
    const reponse = await repondre(demande("GET", "/"), base("erreur"));
    expect(reponse.status).toBe(503);
    expect(await reponse.text()).toBe("La base ne répond pas.\n");
    assertEntetes(reponse);
  });

  it("sert la feuille de style sans ouvrir la base", async () => {
    const reponse = await repondre(demande("GET", "/registre.css"), base("erreur"));
    expect(reponse.status).toBe(200);
    expect(reponse.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
    expect(await reponse.text()).toContain("font-family");
    assertSecurite(reponse);
    const script = await repondre(demande("GET", "/registre.js"), base("erreur"));
    expect(script.status).toBe(200);
    expect(script.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(await script.text()).toContain("showModal");
    assertSecurite(script);
  });

  it("ne lance pas la preuve tant que PREUVE n'est pas 1", async () => {
    const reponse = await repondre(demande("GET", "/preuve-pbkdf2"), base(null));
    expect(reponse.status).toBe(503);
  });

  it("prouve PBKDF2 à 100000 itérations quand PREUVE vaut 1", async () => {
    const env = base(null);
    env.PREUVE = "1";
    const reponse = await repondre(demande("GET", "/preuve-pbkdf2"), env);
    expect(reponse.status).toBe(200);
    expect(await reponse.text()).toBe("pbkdf2 ok\n");
    assertEntetes(reponse);
  });
});

describe("accès", () => {
  beforeAll(async () => {
    const empreinte = await deriver(PHRASE);
    selMotDePasse = empreinte.sel;
    hashMotDePasse = empreinte.hash;
    pdfGuide = ecrirePdf(sommaireGuide());
  });

  beforeEach(() => {
    horloge = new Date("2026-11-03T18:00:00.000Z");
    fichiers = new MemoireFichiers();
    ouvrirBase();
    globalThis.fetch = guideFetch;
  });

  afterAll(() => {
    baseSql?.close();
    globalThis.fetch = fetchOriginal;
  });

  it("affiche le formulaire et un jeton, sans session", async () => {
    const reponse = await repondre(demande("GET", "/"), env());
    expect(reponse.status).toBe(200);
    const html = await reponse.text();
    expect(html).toContain("<form");
    expect(html).toContain('action="/connexion"');
    expect(html).toContain('type="password"');
    expect(html).not.toContain(PHRASE);
    expect(html.toLowerCase()).not.toContain("<script");
    const cookies = reponse.headers.getSetCookie();
    expect(cookies.some((cookie) => cookie.startsWith(`${NOM_CSRF}=`))).toBe(true);
    expect(cookies.some((cookie) => cookie.startsWith(`${NOM_SESSION}=`))).toBe(false);
    for (const cookie of cookies) assertCookie(cookie);
    assertSecurite(reponse);
    expect(reponse.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  });

  it("refuse une phrase trop courte sans compter l'échec", async () => {
    const avant = echecs();
    const reponse = await envoyer(await jetonPage(await repondre(demande("GET", "/"), env())), "court");
    expect(reponse.status).toBe(401);
    expect(await reponse.text()).toContain("20 caractères");
    expect(echecs()).toBe(avant);
    expect(sessions()).toBe(0);
  });

  it("ouvre l'accès et montre l'organisme", async () => {
    const reponse = await envoyer(await jetonPage(await repondre(demande("GET", "/"), env())), PHRASE);
    expect(reponse.status).toBe(303);
    expect(reponse.headers.get("Location")).toBe("/");
    for (const cookie of reponse.headers.getSetCookie()) assertCookie(cookie);
    const suite = await repondre(demande("GET", "/", cookieEntete(reponse)), env());
    const html = await suite.text();
    expect(suite.status).toBe(200);
    expect(html).toContain("Atelier Test");
    expect(html).toContain("Aucun dossier.");
    expect(html).toContain('type="file"');
    expect(html).toContain("Ouvrir le dossier");
    expect(html).toContain("Pour l'audit");
    expect(html).toContain("Pas conforme");
    expect(html).toContain("Veille légale");
    expect(html).toContain("Référent handicap");
    expect(html).toContain("Auto-évaluation");
    expect(html).toContain("Le guide a changé.");
    expect(html).toContain("Déposer");
    expect(html).toContain("Produire");
    expect(html).toContain("Tout produire");
    expect(html).toContain('action="/audit/veille_metiers/produire"');
    expect(html).toContain('action="/audit/handicap/produire"');
    expect(html).toContain('action="/audit/risques/produire"');
    expect((html.match(/\/produire"/g) ?? []).length).toBe(16);
    expect(html).not.toContain(">Noter<");
    expect(html).not.toContain("travail-emploi.gouv.fr");
    expect(html).toContain("Certificat Qualiopi");
    expect(html).toContain("Catalogue des formations");
    expect(html).toContain("/organisme/certificat/apercu");
    expect(html).not.toContain(PHRASE);
    expect(audits()).not.toContain(PHRASE);
    const longue = await envoyer(await jetonPage(await repondre(demande("GET", "/"), env())), PHRASE, "B".repeat(600));
    expect(agents()).toContain("B".repeat(512));
    expect(longue.status).toBe(303);
  });

  it("versionne un dépôt et une production, sans écraser la précédente", async () => {
    const ouverte = await envoyer(await jetonPage(await repondre(demande("GET", "/"), env())), PHRASE);
    const cookies = cookieEntete(ouverte);
    const accueil = await repondre(demande("GET", "/", cookies), env());
    const csrf = champCsrf(await accueil.text());
    const premier = await deposerPdf(cookies, csrf, ecrirePdf("Veille du 4 novembre, version 1."), "/audit/veille_legale", "fichier");
    expect(premier.status).toBe(303);
    const deuxieme = await deposerPdf(cookies, csrf, ecrirePdf("Veille du 4 novembre, version 2, plus longue."), "/audit/veille_legale", "fichier");
    expect(deuxieme.status).toBe(303);
    const produit = await repondre(demande("POST", "/audit/auto_evaluation/produire", cookies, { csrf }), env());
    expect(produit.status).toBe(303);
    const html = await (await repondre(demande("GET", "/", cookies), env())).text();
    expect(html).toContain("v1");
    expect(html).toContain("v2");
    expect(html).toContain("/audit/veille_legale/1");
    expect(html).not.toContain("Aucune veille légale.");
    expect(html).not.toContain("Aucune auto-évaluation.");
    const v1 = await repondre(demande("GET", "/audit/veille_legale/1", cookies), env());
    const v2 = await repondre(demande("GET", "/audit/veille_legale/2", cookies), env());
    expect(v1.headers.get("Content-Disposition")).toContain("veille_legale-v1.pdf");
    expect(v2.headers.get("Content-Disposition")).toContain("veille_legale-v2.pdf");
    expect((await v1.arrayBuffer()).byteLength).not.toBe((await v2.arrayBuffer()).byteLength);
    const veille = await repondre(demande("POST", "/audit/veille_legale/produire", cookies, { csrf }), env());
    expect(veille.status).toBe(303);
    const generee = await textePdf(new Uint8Array(await (await repondre(demande("GET", "/audit/veille_legale", cookies), env())).arrayBuffer()));
    expect(generee).toContain("Guide de lecture");
    expect(generee).toContain("Décret n° 2026-728");
    expect(generee).not.toContain("travail-emploi.gouv.fr");
    expect(generee).not.toContain("90 heures");
    const metiers = await repondre(demande("POST", "/audit/veille_metiers/produire", cookies, { csrf }), env());
    expect(metiers.status).toBe(303);
    const texteMetiers = await textePdf(new Uint8Array(await (await repondre(demande("GET", "/audit/veille_metiers", cookies), env())).arrayBuffer()));
    expect(texteMetiers).toContain("Fevad");
    expect(texteMetiers).toContain("L'Opcommerce");
    expect(texteMetiers).not.toContain("90 heures");
    const pageMetiers = await (await repondre(demande("GET", "/", cookies), env())).text();
    expect(pageMetiers).not.toContain("Aucune veille métiers.");
    const tout = await repondre(demande("POST", "/audit/produire", cookies, { csrf }), env());
    expect(tout.status).toBe(303);
    const apres = await (await repondre(demande("GET", "/", cookies), env())).text();
    expect(apres).toContain("Pas conforme");
    expect(apres).not.toContain("Conforme dans le registre.");
    expect(apres).toContain("Aucun taux");
    expect(apres).toContain("Aucun réseau handicap");
    expect(apres).toContain("pas publiée");
    expect(apres).toContain("ne sont pas mises en œuvre");
    expect(apres).toContain("ne sont pas évaluées");
    expect(apres).toContain("Aucune appréciation recueillie.");
    expect(apres).not.toContain("Les intervenants ne sont pas notés.");
    const indicateurs = await repondre(demande("GET", "/audit/resultats", cookies), env());
    const texte = new TextDecoder().decode(await indicateurs.arrayBuffer());
    expect(texte).toContain("Aucun taux");
    expect(texte).not.toMatch(/\d+ %/);
    const handicap = await textePdf(new Uint8Array(await (await repondre(demande("GET", "/audit/handicap", cookies), env())).arrayBuffer()));
    expect(handicap).toContain("Référent : Atelier Test");
    expect(handicap).toContain("Agefiph");
    expect(handicap).toContain("Cap Emploi");
    expect(handicap).not.toContain("aucun organisme partenaire");
    const pedagogique = await textePdf(new Uint8Array(await (await repondre(demande("GET", "/audit/veille_pedagogique", cookies), env())).arrayBuffer()));
    expect(pedagogique).toContain("Centre Inffo");
    expect(pedagogique).toContain("Mascret");
    expect(pedagogique).toContain("Source");
    expect(pedagogique).not.toContain("90 heures");
    expect(pedagogique).not.toContain("coaching");
    const maintien = await textePdf(new Uint8Array(await (await repondre(demande("GET", "/audit/maintien", cookies), env())).arrayBuffer()));
    expect(maintien).toContain("Journal");
    expect(maintien).not.toContain("Aucune action de maintien");
  });

  it("bloque au cinquième échec, puis accepte après le délai", async () => {
    let jeton = await jetonPage(await repondre(demande("GET", "/"), env()));
    for (let essai = 0; essai < 4; essai += 1) {
      const refus = await envoyer(jeton, AUTRE);
      expect(refus.status).toBe(401);
      jeton = await jetonPage(refus);
    }
    const blocage = await envoyer(jeton, AUTRE);
    const pageBlocage = await blocage.text();
    expect(blocage.status).toBe(429);
    expect(pageBlocage).toContain("19:15");
    const pendant = await envoyer(
      {
        cookie: blocage.headers.getSetCookie().find((ligne) => ligne.startsWith(`${NOM_CSRF}=`))?.split(";")[0] ?? "",
        champ: champCsrf(pageBlocage),
      },
      PHRASE,
    );
    expect(pendant.status).toBe(429);
    expect(sessions()).toBe(0);
    horloge = new Date("2026-11-03T18:16:00.000Z");
    const ouverte = await envoyer(await jetonPage(await repondre(demande("GET", "/"), env())), PHRASE);
    expect(ouverte.status).toBe(303);
    expect(echecs()).toBe(0);
  });

  it("refuse un dossier sans convention", async () => {
    const ouverte = await envoyer(await jetonPage(await repondre(demande("GET", "/"), env())), PHRASE);
    const cookies = cookieEntete(ouverte);
    const csrf = champCsrf(await (await repondre(demande("GET", "/", cookies), env())).text());
    const creation = await repondre(demande("POST", "/dossiers", cookies, { csrf, stagiaire_nom: "Camille" }), env());
    expect(creation.status).toBe(400);
    expect(await creation.text()).toContain("La convention manque.");
    expect(nombreDossiers()).toBe(0);
  });

  it("ouvre le dossier même sans e-mail, financeur ni date de fin", async () => {
    const ouverte = await envoyer(await jetonPage(await repondre(demande("GET", "/"), env())), PHRASE);
    const cookies = cookieEntete(ouverte);
    const csrf = champCsrf(await (await repondre(demande("GET", "/", cookies), env())).text());
    const depot = await deposerPdf(
      cookies,
      csrf,
      pdfTexte(`CONVENTION DE FORMATION PROFESSIONNELLE
N° de convention : 2026-TEST-001
2. Le beneficiaire / Entreprise
Raison sociale : Atelier Nord
Representee par : Camille MARTIN
Adresse : 1 rue des Lilas, 75011 Paris
SIRET : 123 456 789 00011
Article 2 : Intitule de la formation
Administration Linux
Article 3 : Objectifs
Article 4 : Duree et modalites
Duree totale : 14 heures
- 14 heures de coaching individuel (visioconference ou presentiel)
Date de debut : 13 mai 2026
Article 5 : Prix et reglement
Montant total : 600 EUR HT soit 720 EUR TTC
conforme au devis n° D2600001.`),
    );
    expect(depot.status).toBe(303);
    const html = await (await repondre(demande("GET", "/", cookies), env())).text();
    expect(html).toContain("Camille MARTIN");
    expect(html).toContain("13/05/2026");
    expect(html).not.toContain("Aucun dossier.");
    const ligne = dbCourante()
      .prepare("SELECT stagiaire_email, financeur, date_fin FROM dossiers")
      .get() as { stagiaire_email: string; financeur: string; date_fin: string | null };
    expect(ligne.stagiaire_email).toBe("");
    expect(ligne.financeur).toBe("");
    expect(ligne.date_fin).toBeNull();
    const id = /href="\/dossiers\/([^"]+)"/.exec(html)?.[1] ?? "";
    const page = await (await repondre(demande("GET", `/dossiers/${id}`, cookies), env())).text();
    expect(page).toContain("Pas d'e-mail sur le dossier.");
    expect(page).toContain(`action="/dossiers/${id}/email"`);
    const refus = await repondre(
      demande("POST", `/dossiers/${id}/email`, cookies, { csrf: champCsrf(page), email: "pas-une-adresse" }),
      env(),
    );
    expect(refus.status).toBe(400);
    expect(await refus.text()).toContain("valide");
    const pose = await repondre(
      demande("POST", `/dossiers/${id}/email`, cookies, { csrf: champCsrf(page), email: "camille@example.com" }),
      env(),
    );
    expect(pose.status).toBe(303);
    const apres = await (await repondre(demande("GET", `/dossiers/${id}`, cookies), env())).text();
    expect(apres).toContain("Envoi à camille@example.com");
    const enregistre = dbCourante().prepare("SELECT stagiaire_email FROM dossiers").get() as { stagiaire_email: string };
    expect(enregistre.stagiaire_email).toBe("camille@example.com");
    const retour = dbCourante().prepare("SELECT sha256, r2_cle, corps FROM retours").get() as {
      sha256: string;
      r2_cle: string;
      corps: string;
    };
    expect(retour.r2_cle).toBe(`scans/${retour.sha256}`);
    expect(retour.corps).toContain("2026-TEST-001");
    expect([...fichiers.objets.values()][0]?.[0]).toBe(0x25);
  });

  it("produit le programme et le devis cités par la convention", async () => {
    const ouverte = await envoyer(await jetonPage(await repondre(demande("GET", "/"), env())), PHRASE);
    const cookies = cookieEntete(ouverte);
    const csrf = champCsrf(await (await repondre(demande("GET", "/", cookies), env())).text());
    const depot = await deposerPdf(
      cookies,
      csrf,
      pdfTexte(`2. Le beneficiaire / Entreprise
Raison sociale : Atelier Nord
Representee par : Camille MARTIN
Adresse : 1 rue des Lilas, 75011 Paris
SIRET : 12345678900011
Article 2 : Intitule de la formation
Administration Linux
Article 3 : Suite
Article 4 : Duree et modalites
Duree totale : 14 heures
- 14 heures de coaching individuel (visioconference ou presentiel)
Date de debut : 13 mai 2026
Article 5 : Prix et reglement
Montant total : 600 EUR HT soit 720 EUR TTC
conforme au devis n° D2600007 du 01 fevrier 2026.
PROGRAMME DE FORMATION
Module 1 Fondamentaux`),
    );
    expect(depot.status).toBe(303);
    const accueil = await (await repondre(demande("GET", "/", cookies), env())).text();
    expect(accueil).toContain('id="audit"');
    expect(accueil).toContain("<th>Prêt</th>");
    expect(accueil).toContain("<td>Devis</td><td>Signé</td><td class=\"erreur\">Pas prêt</td>");
    const id = /href="\/dossiers\/([^"]+)"/.exec(accueil)?.[1] ?? "";
    const page = await repondre(demande("GET", `/dossiers/${id}`, cookies), env());
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain("Programme");
    expect(html).toContain("Devis D2600007");
    expect(html).toContain("Analyse du besoin");
    expect(html).toContain("Positionnement");
    expect(html).toContain("Convocation");
    expect(html).toContain("Émargement");
    expect(html).toContain("Évaluation de sortie");
    expect(html).toContain("720,00 €");
    expect(html).toContain("Télécharger");
    expect(html).toContain("Aperçu");
    expect(html).toContain(">v1<");
    expect(html).toContain("Déposer");
    expect(html).toContain(`action="/dossiers/${id}/analyse"`);
    expect(html).toContain(`action="/dossiers/${id}/attestation"`);
    expect(html).not.toContain(`/dossiers/${id}/attestation/apercu`);
    const ancienne = await repondre(demande("GET", `/dossiers/${id}/programme/1`, cookies), env());
    expect(ancienne.status).toBe(200);
    expect(ancienne.headers.get("Content-Disposition")).toContain("programme-v1.pdf");
    const absente = await repondre(demande("GET", `/dossiers/${id}/programme/2`, cookies), env());
    expect(absente.status).toBe(404);
    expect(html).toContain("01 Communication");
    expect(html).toContain("02 Actions réalisées");
    expect(html).toContain("04 Moyens humains");
    expect(html).toContain(`action="/dossiers/${id}/devis/produire"`);
    expect(html).toContain("En retard. À signer avant le 13 mai 2026.");
    expect(html).toContain("En retard. À envoyer avant le 13 mai 2026.");
    expect(html).toContain("Depuis le 13 mai 2026. À signer à chaque séance de coaching.");
    expect(html).toContain("En règle.");
    expect(html).toContain("<th>Prêt</th>");
    expect(html).toContain("Pas prêt");
    expect(html).not.toContain("Relevé de connexion");
    expect(html).toContain("Ne se produit pas.");
    expect(html.match(/Ne se produit pas\./g)?.length).toBe(3);
    expect(html).toContain(`action="/dossiers/${id}/analyse/produire"`);
    expect(html).toContain(`action="/dossiers/${id}/convocation/produire"`);
    expect(html).toContain(`action="/dossiers/${id}/convention/produire"`);
    expect(html).toContain(`action="/dossiers/${id}/programme/produire"`);
    expect(html).toContain(`action="/dossiers/${id}/reglement/produire"`);
    expect(html).toContain(`action="/dossiers/${id}/attestation/produire"`);
    expect(html).toContain(`action="/dossiers/${id}/facture/produire"`);
    const produit = await repondre(demande("POST", `/dossiers/${id}/analyse/produire`, cookies, { csrf: champCsrf(html) }), env());
    expect(produit.status).toBe(303);
    const devis = await repondre(demande("GET", `/dossiers/${id}/devis`, cookies), env());
    expect(devis.status).toBe(200);
    expect(devis.headers.get("Content-Type")).toBe("application/pdf");
    expect(devis.headers.get("Content-Disposition")).toContain("attachment");
    const apercu = await repondre(demande("GET", `/dossiers/${id}/devis/apercu`, cookies), env());
    expect(apercu.status).toBe(200);
    expect(apercu.headers.get("Content-Disposition")).toContain("inline");
    const octets = new Uint8Array(await devis.arrayBuffer());
    expect(octets[0]).toBe(0x25);
    expect(new TextDecoder().decode(octets)).toContain("D2600007");
    const ligne = dbCourante().prepare("SELECT annee, numero, montant_ttc_centimes, r2_cle FROM devis").get() as {
      annee: number;
      numero: number;
      montant_ttc_centimes: number;
      r2_cle: string;
    };
    expect(ligne.annee).toBe(2026);
    expect(ligne.numero).toBe(7);
    expect(ligne.montant_ttc_centimes).toBe(72000);
    expect(ligne.r2_cle.startsWith("devis/")).toBe(true);
    const programme = dbCourante().prepare("SELECT r2_cle FROM retours WHERE type = 'programme'").get() as { r2_cle: string };
    expect(programme.r2_cle.startsWith("scans/")).toBe(true);
    const signe = await deposerPdf(cookies, champCsrf(html), ecrirePdf("Analyse signee."), `/dossiers/${id}/analyse`, "fichier");
    expect(signe.status).toBe(303);
    const apres = await (await repondre(demande("GET", `/dossiers/${id}`, cookies), env())).text();
    expect(apres).toContain('<span class="nom">Analyse du besoin</span><span class="geste">En règle.</span>');
    expect(apres).toContain(`/dossiers/${id}/analyse/signe/apercu`);
    expect(apres).not.toContain(">v2<");
    const v2 = await repondre(demande("GET", `/dossiers/${id}/analyse/2`, cookies), env());
    expect(v2.status).toBe(404);
    const fichierSigne = await repondre(demande("GET", `/dossiers/${id}/analyse/signe`, cookies), env());
    expect(fichierSigne.status).toBe(200);
    expect(fichierSigne.headers.get("Content-Disposition")).toContain("analyse-signe.pdf");
    const identique = await deposerPdf(cookies, champCsrf(apres), ecrirePdf("Analyse signee."), `/dossiers/${id}/analyse`, "fichier");
    expect(identique.status).toBe(303);
    const stable = await (await repondre(demande("GET", `/dossiers/${id}`, cookies), env())).text();
    expect(stable).not.toContain(">v3<");
    const autre = "Analyse du besoin distincte, avec assez de texte pour rester une version et non un scan.";
    const version = await deposerPdf(cookies, champCsrf(stable), ecrirePdf(autre), `/dossiers/${id}/analyse`, "fichier");
    expect(version.status).toBe(303);
    const pageVersion = await (await repondre(demande("GET", `/dossiers/${id}`, cookies), env())).text();
    expect(pageVersion).toContain(">v2<");
    expect(pageVersion).toContain(`/dossiers/${id}/analyse/signe/apercu`);
    const meme = await deposerPdf(cookies, champCsrf(pageVersion), ecrirePdf(autre.replace(/ /g, "  ")), `/dossiers/${id}/analyse`, "fichier");
    expect(meme.status).toBe(303);
    const pageSignature = await (await repondre(demande("GET", `/dossiers/${id}`, cookies), env())).text();
    expect(pageSignature).not.toContain(">v3<");
    expect(pageSignature).toContain(`/dossiers/${id}/analyse/signe/apercu`);
    const devisNu = "Devis refait pour Atelier Nord, assez long pour rester une version tant qu'il n'est pas signé.";
    const depotDevis = await deposerPdf(cookies, champCsrf(pageSignature), ecrirePdf(devisNu), `/dossiers/${id}/devis`, "fichier");
    expect(depotDevis.status).toBe(303);
    const pageDevisNu = await (await repondre(demande("GET", `/dossiers/${id}`, cookies), env())).text();
    expect(pageDevisNu).toContain('<span class="nom">Devis D2600007</span><span class="geste erreur">En retard. À signer avant le 13 mai 2026.</span>');
    expect(pageDevisNu).toContain("<td>Devis</td><td>Signé</td><td class=\"erreur\">Pas prêt</td>");
    const signeDevis = await deposerPdf(cookies, champCsrf(pageDevisNu), ecrirePdf("Devis signe."), `/dossiers/${id}/devis`, "fichier");
    expect(signeDevis.status).toBe(303);
    const devisApres = dbCourante().prepare("SELECT r2_cle FROM devis").get() as { r2_cle: string };
    expect(devisApres.r2_cle).toBe(ligne.r2_cle);
    const pageDevis = await (await repondre(demande("GET", `/dossiers/${id}`, cookies), env())).text();
    expect(pageDevis).toContain('<span class="nom">Devis D2600007</span><span class="geste">En règle.</span>');
    const convoquee = await deposerPdf(cookies, champCsrf(pageDevis), ecrirePdf("Convocation envoyee."), `/dossiers/${id}/convocation`, "fichier");
    expect(convoquee.status).toBe(303);
    const pageConvocation = await (await repondre(demande("GET", `/dossiers/${id}`, cookies), env())).text();
    expect(pageConvocation).not.toContain("À envoyer avant le");
    const relue = await deposerPdf(
      cookies,
      champCsrf(pageConvocation),
      pdfTexte(`CONVENTION DE FORMATION PROFESSIONNELLE
N° de convention : 2026-TEST-002
2. Le beneficiaire
Raison sociale : Atelier Martin
Representee par : Camille MARTIN
Adresse : 1 rue des Lilas, 75011 Paris
SIRET : 12345678900011
Article 2 : Intitule de la formation
Administration reseau
Article 4 : Duree et modalites
Duree totale : 14 heures
- 14 heures de coaching individuel (visioconference ou presentiel)
Date de debut : 13 mai 2026
Date de fin : 1 juin 2026
Montant total : 600 EUR HT soit 720 EUR TTC
conforme au devis n° D2600007 du 01 fevrier 2026.`),
      `/dossiers/${id}/convention`,
      "fichier",
    );
    expect(relue.status).toBe(303);
    const fiche = await (await repondre(demande("GET", `/dossiers/${id}`, cookies), env())).text();
    expect(fiche).toContain("Administration reseau");
    expect(fiche).toContain("01/06/2026");
    expect(fiche).toContain("Convention 2026-TEST-002");
    const devisFige = dbCourante().prepare("SELECT r2_cle FROM devis").get() as { r2_cle: string };
    expect(devisFige.r2_cle).toBe(ligne.r2_cle);
    const muette = await deposerPdf(cookies, champCsrf(fiche), ecrirePdf("scan sans texte"), `/dossiers/${id}/convention`, "fichier");
    expect(muette.status).toBe(200);
    const pageMuette = await muette.text();
    expect(pageMuette).toContain("pas de texte");
    expect(pageMuette).toContain("Convention 2026-TEST-002");
    expect(pageMuette).toContain(`/dossiers/${id}/convention/signe/apercu`);
    expect(pageMuette).not.toContain("/convention/2");
    const inchangee = dbCourante().prepare("SELECT intitule, date_fin FROM dossiers").get() as { intitule: string; date_fin: string };
    expect(inchangee.intitule.startsWith("Administration reseau")).toBe(true);
    expect(inchangee.date_fin).toBe("2026-06-01");
    const csrfFin = champCsrf(await (await repondre(demande("GET", `/dossiers/${id}`, cookies), env())).text());
    const attestation = await repondre(demande("POST", `/dossiers/${id}/attestation/produire`, cookies, { csrf: csrfFin }), env());
    expect(attestation.status).toBe(303);
    const facture = await repondre(demande("POST", `/dossiers/${id}/facture/produire`, cookies, { csrf: csrfFin }), env());
    expect(facture.status).toBe(303);
    const emises = await (await repondre(demande("GET", `/dossiers/${id}`, cookies), env())).text();
    expect(emises).toContain(`/dossiers/${id}/attestation/apercu`);
    expect(emises).toContain(`/dossiers/${id}/facture/apercu`);
    expect(emises).not.toContain('<span class="nom">Attestation</span><span class="geste">En règle.</span>');
    expect(emises).not.toContain('<span class="nom">Facture</span><span class="geste">En règle.</span>');
    const modeles = dbCourante().prepare("SELECT type, seance_id FROM retours WHERE seance_id IN ('attestation', 'facture') ORDER BY seance_id").all() as {
      type: string;
      seance_id: string;
    }[];
    expect(modeles).toEqual([
      { type: "modele", seance_id: "attestation" },
      { type: "modele", seance_id: "facture" },
    ]);
    const sequence = dbCourante().prepare("SELECT count(*) AS n FROM sequences WHERE cle = 'facture'").get() as { n: number };
    expect(sequence.n).toBe(0);
  });

  it("envoie l'avant en un seul courrier, la convocation quand les retours sont là", async () => {
    const ouverte = await envoyer(await jetonPage(await repondre(demande("GET", "/"), env())), PHRASE);
    const cookies = cookieEntete(ouverte);
    dbCourante().prepare("UPDATE reglages SET email = 'atelier@example.com' WHERE id = 1").run();
    const csrf = champCsrf(await (await repondre(demande("GET", "/", cookies), env())).text());
    const creation = await deposerPdf(
      cookies,
      csrf,
      pdfTexte(`2. Le beneficiaire / Entreprise
Raison sociale : Atelier Nord
Representee par : Camille MARTIN
Adresse : 1 rue des Lilas, 75011 Paris
SIRET : 12345678900011
Mail : camille@example.com
Article 2 : Intitule de la formation
Administration Linux
Article 3 : Suite
Article 4 : Duree et modalites
Duree totale : 14 heures
- 14 heures de coaching individuel (visioconference ou presentiel)
Date de debut : 13 mai 2026
Article 5 : Prix et reglement
Montant total : 600 EUR HT soit 720 EUR TTC
conforme au devis n° D2600007 du 01 fevrier 2026.
PROGRAMME DE FORMATION
Module 1 Fondamentaux`),
    );
    expect(creation.status).toBe(303);
    const accueil = await (await repondre(demande("GET", "/", cookies), env())).text();
    const id = /href="\/dossiers\/([^"]+)"/.exec(accueil)?.[1] ?? "";
    const page = await (await repondre(demande("GET", `/dossiers/${id}`, cookies), env())).text();
    expect(page).toContain("Envoi à camille@example.com");
    expect(page).toContain(`action="/dossiers/${id}/courrier"`);
    expect(page).toContain('name="moment" value="avant"');
    expect(page).toContain('name="moment" value="pendant"');
    expect(page).toContain('name="moment" value="apres"');
    expect(page).toContain('id="envoi-avant"');
    expect(page).toContain("Avant la formation");
    expect(page).toContain("Relire la liste");
    expect(page).toContain("Recevoir une copie");
    expect(page).not.toContain('name="copie" value="1" checked');
    expect(page).toContain('value="devis" checked');
    expect(page).not.toContain('value="convocation" checked');
    const sansCle = await repondre(demande("POST", `/dossiers/${id}/courrier`, cookies, { csrf: champCsrf(page), moment: "avant" }), env());
    expect(await pageApres(sansCle, cookies)).toContain("pas posée");
    const partis: { sujet: string; texte: string; noms: string[]; copie: string; fichiers: { nom: string; octets: Uint8Array }[] }[] = [];
    const avecCourrier = () => ({
      ...env(),
      envoyerCourrier: async (courrier: { sujet: string; texte: string; pieces: { nom: string; octets: Uint8Array }[]; copie: { email: string } | null }) => {
        partis.push({
          sujet: courrier.sujet,
          texte: courrier.texte,
          noms: courrier.pieces.map((piece) => piece.nom),
          copie: courrier.copie?.email ?? "",
          fichiers: courrier.pieces.map((piece) => ({ nom: piece.nom, octets: piece.octets })),
        });
        return true;
      },
    });
    const envoi = await repondre(
      demande("POST", `/dossiers/${id}/courrier`, cookies, { csrf: champCsrf(page), moment: "avant" }),
      avecCourrier(),
    );
    const apresEnvoi = await pageApres(envoi, cookies);
    expect(apresEnvoi).toContain("Envoyé à camille@example.com");
    expect(apresEnvoi).toContain("Analyse du besoin");
    expect(apresEnvoi).not.toContain('<span class="nom">Analyse du besoin</span><span class="geste">En règle.</span>');
    const recharge = await (await repondre(demande("GET", `/dossiers/${id}`, cookies), env())).text();
    expect(recharge).not.toContain("Envoyé à camille@example.com");
    expect(partis).toHaveLength(1);
    expect(partis[0]?.sujet).toContain("Avant la formation");
    expect(partis[0]?.noms).toContain("Devis.pdf");
    expect(partis[0]?.noms).toContain("Analyse du besoin.pdf");
    expect(partis[0]?.noms).not.toContain("Convocation.pdf");
    expect(partis[0]?.texte).toContain("quand le positionnement et le règlement sont renvoyés");
    expect(partis[0]?.copie).toBe("");
    const convoquee = dbCourante().prepare("SELECT count(*) AS n FROM pieces WHERE code = 'convocation' AND statut = 'envoyee'").get() as { n: number };
    expect(convoquee.n).toBe(0);
    const seuleConvocation = await repondre(
      demande("POST", `/dossiers/${id}/courrier`, cookies, {
        csrf: champCsrf(page),
        moment: "avant",
        choix: "1",
        inclure: "convocation",
      }),
      avecCourrier(),
    );
    expect(seuleConvocation.status).toBe(303);
    expect(partis.at(-1)?.noms).toEqual(["Convocation.pdf"]);
    expect(partis.at(-1)?.texte).not.toContain("quand le positionnement");
    const jeton = champCsrf(apresEnvoi);
    expect((await deposerPdf(cookies, jeton, ecrirePdf("Positionnement signe."), `/dossiers/${id}/positionnement`, "fichier")).status).toBe(303);
    const apresPosition = await (await repondre(demande("GET", `/dossiers/${id}`, cookies), env())).text();
    expect((await deposerPdf(cookies, champCsrf(apresPosition), ecrirePdf("Reglement signe."), `/dossiers/${id}/reglement`, "fichier")).status).toBe(303);
    const avantConvocation = await (await repondre(demande("GET", `/dossiers/${id}`, cookies), env())).text();
    const second = await repondre(
      demande("POST", `/dossiers/${id}/courrier`, cookies, { csrf: champCsrf(avantConvocation), moment: "avant" }),
      avecCourrier(),
    );
    expect(partis).toHaveLength(3);
    expect(partis[2]?.noms).toContain("Convocation.pdf");
    const partie = await pageApres(second, cookies);
    expect(partie).not.toContain("À envoyer avant le");
    const statut = dbCourante().prepare("SELECT statut FROM pieces WHERE code = 'convocation' AND seance_id = ''").get() as { statut: string };
    expect(statut.statut).toBe("envoyee");
    const audits = dbCourante().prepare("SELECT action FROM audit WHERE action = 'courrier_envoye'").all() as { action: string }[];
    expect(audits).toHaveLength(3);
    const v1 = new Uint8Array(await (await repondre(demande("GET", `/dossiers/${id}/analyse/1`, cookies), env())).arrayBuffer());
    const relue = await deposerPdf(
      cookies,
      champCsrf(partie),
      pdfTexte(`CONVENTION DE FORMATION PROFESSIONNELLE
N° de convention : 2026-TEST-009
2. Le beneficiaire
Raison sociale : Atelier Nord
Representee par : Camille MARTIN
Adresse : 1 rue des Lilas, 75011 Paris
SIRET : 12345678900011
Mail : camille@example.com
Article 2 : Intitule de la formation
Administration reseau
Article 3 : Suite
Article 4 : Duree et modalites
Duree totale : 14 heures
- 14 heures de coaching individuel (visioconference ou presentiel)
Date de debut : 13 mai 2026
Date de fin : 1 juin 2026
Montant total : 600 EUR HT soit 720 EUR TTC
conforme au devis n° D2600007 du 01 fevrier 2026.`),
      `/dossiers/${id}/convention`,
      "fichier",
    );
    expect(relue.status).toBe(303);
    const pageVersions = await (await repondre(demande("GET", `/dossiers/${id}`, cookies), env())).text();
    expect(pageVersions).toContain('name="analyse"');
    expect(pageVersions).toContain('value="2" selected');
    expect(pageVersions).toContain('value="1"');
    const v2 = new Uint8Array(await (await repondre(demande("GET", `/dossiers/${id}/analyse`, cookies), env())).arrayBuffer());
    expect(v2).not.toEqual(v1);
    const ancienne = await repondre(
      demande("POST", `/dossiers/${id}/courrier`, cookies, { csrf: champCsrf(pageVersions), moment: "avant", analyse: "1" }),
      avecCourrier(),
    );
    expect(ancienne.status).toBe(303);
    const choisi = partis.at(-1)?.fichiers.find((fichier) => fichier.nom === "Analyse du besoin.pdf");
    expect(choisi?.octets).toEqual(v1);
    const recente = await repondre(
      demande("POST", `/dossiers/${id}/courrier`, cookies, { csrf: champCsrf(pageVersions), moment: "avant" }),
      avecCourrier(),
    );
    expect(recente.status).toBe(303);
    const derniere = partis.at(-1)?.fichiers.find((fichier) => fichier.nom === "Analyse du besoin.pdf");
    expect(derniere?.octets).toEqual(v2);
    const seul = await repondre(
      demande("POST", `/dossiers/${id}/courrier`, cookies, {
        csrf: champCsrf(pageVersions),
        moment: "avant",
        choix: "1",
        inclure: "devis",
      }),
      avecCourrier(),
    );
    expect(partis.at(-1)?.noms).toEqual(["Devis.pdf"]);
    const texteSeul = await pageApres(seul, cookies);
    expect(texteSeul).toContain("Laissées de côté");
    expect(texteSeul).not.toContain("quand le positionnement");
    const avecCopie = await repondre(
      demande("POST", `/dossiers/${id}/courrier`, cookies, {
        csrf: champCsrf(pageVersions),
        moment: "avant",
        choix: "1",
        inclure: "devis",
        copie: "1",
      }),
      avecCourrier(),
    );
    expect(avecCopie.status).toBe(303);
    expect(partis.at(-1)?.noms).toEqual(["Devis.pdf"]);
    expect(partis.at(-1)?.copie).toBe("atelier@example.com");
  });

  it("enregistre un dossier lu en entier et échappe le nom", async () => {
    const ouverte = await envoyer(await jetonPage(await repondre(demande("GET", "/"), env())), PHRASE);
    const cookies = cookieEntete(ouverte);
    const csrf = champCsrf(await (await repondre(demande("GET", "/", cookies), env())).text());
    const creation = await deposerPdf(
      cookies,
      csrf,
      pdfTexte(`2. Le beneficiaire / Entreprise
Representee par : A<script>
Mail : camille@example.com
Article 2 : Intitule de la formation
Administration Linux
Article 3 : Suite
Article 4 : Duree et modalites
Duree totale : 14 heures
- 14 heures de coaching individuel (visioconference ou presentiel)
Date de debut : 13 mai 2026
Date de fin : 15 mai 2026
Article 5 : Prix et reglement
Montant total : 600 EUR HT soit 720 EUR TTC
Financeur : AGEFICE`),
    );
    expect(creation.status).toBe(303);
    const html = await (await repondre(demande("GET", "/", cookies), env())).text();
    expect(html).toContain("&lt;script&gt;");
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html).toContain("13/05/2026");
    expect(html).toContain("600,00 €");
    expect(html).toContain("20 %");
    expect(html).not.toContain("Aucun dossier.");
  });

  it("ferme l'accès", async () => {
    const ouverte = await envoyer(await jetonPage(await repondre(demande("GET", "/"), env())), PHRASE);
    const cookies = cookieEntete(ouverte);
    const page = await repondre(demande("GET", "/", cookies), env());
    const sortie = await repondre(
      demande("POST", "/sortie", cookies, { csrf: champCsrf(await page.text()) }),
      env(),
    );
    expect(sortie.status).toBe(303);
    const html = await (await repondre(demande("GET", "/", cookieEntete(ouverte)), env())).text();
    expect(html).toContain('action="/connexion"');
    expect(html).not.toContain("Atelier Test");
  });
});

function demande(
  method: string,
  pathname: string,
  cookie = "",
  champs?: Record<string, string>,
): Request {
  const headers = new Headers();
  if (cookie) headers.set("Cookie", cookie);
  headers.set("CF-Connecting-IP", "203.0.113.8");
  let body: string | undefined;
  if (champs) {
    headers.set("Content-Type", "application/x-www-form-urlencoded");
    body = new URLSearchParams(champs).toString();
  }
  return new Request(`${ORIGINE}${pathname}`, { method, headers, body });
}

function base(hash: string | null | "erreur"): Env {
  return {
    DB: {
      prepare(requete: string) {
        if (!requete.includes("?") || !requete.includes("mot_de_passe_hash")) {
          throw new Error(`requête inattendue : ${requete}`);
        }
        return {
          bind(...valeurs: unknown[]) {
            if (valeurs.length !== 1 || valeurs[0] !== 1) throw new Error("bind");
            return {
              async first() {
                if (hash === "erreur") throw new Error("d1 indisponible");
                return { mot_de_passe_hash: hash };
              },
              async all() {
                return { results: [] };
              },
              async run() {},
            };
          },
        };
      },
      async batch() {},
    },
  };
}

function env(): Env {
  return { DB: adapter(dbCourante()), FICHIERS: fichiers, maintenant: () => instantCourant() };
}

const fetchOriginal = globalThis.fetch.bind(globalThis);
let pdfGuide = new Uint8Array();

function sommaireGuide(): string {
  const phrase = (numero: number): string => {
    if (numero === 1) return "Le prestataire diffuse une information accessible au public, détaillée et vérifiable.";
    if (numero === 2) return "Le prestataire diffuse des indicateurs de résultats adaptés à la nature des prestations.";
    if (numero === 4) return "Le prestataire analyse le besoin du bénéficiaire en lien avec l'entreprise.";
    if (numero === 5) return "Le prestataire définit les objectifs opérationnels et évaluables de la prestation.";
    if (numero === 6) return "Le prestataire établit les contenus et les modalités de mise en œuvre de la prestation.";
    if (numero === 8) return "Le prestataire détermine les procédures de positionnement et d'évaluation des acquis.";
    if (numero === 9) return "Le prestataire informe les publics bénéficiaires des conditions de déroulement de la prestation.";
    if (numero === 10) return "Le prestataire met en œuvre et adapte la prestation, l'accompagnement et le suivi.";
    if (numero === 11) return "Le prestataire évalue l'atteinte par les publics bénéficiaires des objectifs de la prestation.";
    if (numero === 12) return "Le prestataire décrit et met en œuvre les mesures pour favoriser l'engagement des bénéficiaires.";
    if (numero === 13) return "Pour les formations en alternance, le prestataire anticipe les missions confiées à l'apprenant.";
    if (numero === 17) return "Le prestataire met à disposition les moyens humains et techniques adaptés.";
    if (numero === 18) return "Le prestataire mobilise et coordonne les différents intervenants internes et externes.";
    if (numero === 19) return "Le prestataire met à disposition du bénéficiaire des ressources pédagogiques et permet de se les approprier.";
    if (numero === 21) return "Le prestataire détermine, mobilise et évalue les compétences des différents intervenants internes.";
    if (numero === 22) return "Le prestataire entretient et développe les compétences de ses salariés, adaptées aux prestations.";
    if (numero === 23) return "Le prestataire réalise une veille légale et réglementaire sur le champ de la formation professionnelle.";
    if (numero === 24) return "Le prestataire réalise une veille sur les évolutions des compétences, des métiers et des emplois.";
    if (numero === 25) return "Le prestataire réalise une veille sur les innovations pédagogiques et technologiques.";
    if (numero === 26) return "Le prestataire mobilise les expertises nécessaires pour accueillir les publics en situation de handicap.";
    if (numero === 30) return "Le prestataire recueille les appréciations des parties prenantes.";
    if (numero === 31) return "Le prestataire traite les difficultés et les réclamations exprimées par les parties prenantes.";
    if (numero === 32) return "Le prestataire met en œuvre des mesures d'amélioration continue et une analyse des risques.";
    if (numero === 33) return "Le prestataire évalue les contenus par les apprentis, distinctement de la satisfaction.";
    return `Le prestataire tient le point numéro ${numero} du référentiel qualité.`;
  };
  return ["V.10 – Novembre 2026", ...Array.from({ length: 33 }, (_, index) => `${index + 1}. ${phrase(index + 1)}`), "Glossaire"].join("\n");
}

function guideFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("travail-emploi.gouv.fr") && url.toLowerCase().includes(".pdf")) {
    return Promise.resolve(new Response(pdfGuide.slice(), { status: 200, headers: { "Content-Type": "application/pdf" } }));
  }
  if (url.includes("travail-emploi.gouv.fr")) {
    return Promise.resolve(
      new Response('<a href="https://travail-emploi.gouv.fr/files/guide-lecture-qualiopi.pdf">guide</a>', {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );
  }
  return fetchOriginal(input, init);
}

let baseSql: DatabaseSync | undefined;
let horloge = new Date("2026-11-03T18:00:00.000Z");
let selMotDePasse = "";
let hashMotDePasse = "";
let fichiers: MemoireFichiers;

function ouvrirBase(): void {
  baseSql?.close();
  baseSql = new DatabaseSync(":memory:");
  baseSql.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
  baseSql.exec(readFileSync(new URL("../migrations/0002_numero_tva.sql", import.meta.url), "utf8"));
  baseSql.exec(readFileSync(new URL("../migrations/0003_dossier_incomplet.sql", import.meta.url), "utf8"));
  baseSql.exec(readFileSync(new URL("../migrations/0004_documents_organisme.sql", import.meta.url), "utf8"));
  baseSql.exec(readFileSync(new URL("../migrations/0005_guide_releve.sql", import.meta.url), "utf8"));
  baseSql.exec(readFileSync(new URL("../migrations/0006_versions_organisme.sql", import.meta.url), "utf8"));
  baseSql.exec(readFileSync(new URL("../migrations/0007_version_tient.sql", import.meta.url), "utf8"));
  baseSql.exec(readFileSync(new URL("../migrations/0008_versions_publiees.sql", import.meta.url), "utf8"));
  baseSql
    .prepare(
      `UPDATE reglages
          SET nom = 'Atelier Test',
              mot_de_passe_algo = 'PBKDF2-SHA-256',
              mot_de_passe_iterations = 100000,
              mot_de_passe_sel = ?,
              mot_de_passe_hash = ?,
              mot_de_passe_defini_le = '2026-11-03T21:05:02.993Z'
        WHERE id = 1`,
    )
    .run(selMotDePasse, hashMotDePasse);
}

class MemoireFichiers {
  objets = new Map<string, Uint8Array>();

  async head(cle: string): Promise<{ size: number } | null> {
    const octets = this.objets.get(cle);
    return octets ? { size: octets.byteLength } : null;
  }

  async get(cle: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> {
    const octets = this.objets.get(cle);
    if (!octets) return null;
    const copie = octets.slice();
    return { async arrayBuffer() { return copie.buffer; } };
  }

  async put(cle: string, valeur: Uint8Array): Promise<void> {
    this.objets.set(cle, valeur);
  }
}

function dbCourante(): DatabaseSync {
  if (!baseSql) throw new Error("base absente");
  return baseSql;
}

function nombreDossiers(): number {
  const ligne = dbCourante().prepare("SELECT count(*) AS n FROM dossiers").get() as { n: number };
  return ligne.n;
}

async function deposerPdf(
  cookies: string,
  csrf: string,
  pdf: Uint8Array,
  chemin = "/dossiers",
  champ = "convention",
): Promise<Response> {
  const formulaire = new FormData();
  formulaire.set("csrf", csrf);
  formulaire.set(champ, new File([pdf], "document.pdf", { type: "application/pdf" }));
  return repondre(
    new Request(`${ORIGINE}${chemin}`, {
      method: "POST",
      headers: { Cookie: cookies, "CF-Connecting-IP": "203.0.113.8" },
      body: formulaire,
    }),
    env(),
  );
}

function pdfTexte(texte: string): Uint8Array {
  const lignes = texte.split("\n").map((ligne) => `(${ligne.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")}) '`);
  const flux = `BT /F1 11 Tf 40 800 Td 14 TL\n${lignes.join("\n")}\nET`;
  const objets = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${new TextEncoder().encode(flux).length} >>\nstream\n${flux}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, objet] of objets.entries()) {
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${objet}\nendobj\n`;
  }
  const xref = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

function instantCourant(): Date {
  return horloge;
}

function adapter(db: DatabaseSync): Preparer {
  return {
    prepare(requete: string) {
      return {
        bind(...valeurs: unknown[]) {
          const instruction: RequeteLiee = {
            async first<T>() {
              const ligne = db.prepare(requete).get(...(valeurs as Sql[]));
              return (ligne as T | undefined) ?? null;
            },
            async all<T>() {
              return { results: db.prepare(requete).all(...(valeurs as Sql[])) as T[] };
            },
            async run() {
              db.prepare(requete).run(...(valeurs as Sql[]));
            },
          };
          return instruction;
        },
      };
    },
    async batch(requetes: RequeteLiee[]) {
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const requete of requetes) await requete.run();
        db.exec("COMMIT");
      } catch (erreur) {
        db.exec("ROLLBACK");
        throw erreur;
      }
    },
  };
}

type Sql = string | number | null | bigint | Uint8Array;

async function jetonPage(reponse: Response): Promise<{ cookie: string; champ: string }> {
  const html = await reponse.text();
  const champ = champCsrf(html);
  const cookie =
    reponse.headers.getSetCookie().find((ligne) => ligne.startsWith(`${NOM_CSRF}=`))?.split(";")[0] ?? "";
  return { cookie, champ };
}

function champCsrf(html: string): string {
  return /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? "";
}

async function envoyer(
  jeton: { cookie: string; champ: string },
  phrase: string,
  userAgent = "",
): Promise<Response> {
  const headers = new Headers({
    "Content-Type": "application/x-www-form-urlencoded",
    Cookie: jeton.cookie,
    "CF-Connecting-IP": "203.0.113.8",
  });
  if (userAgent) headers.set("User-Agent", userAgent);
  return repondre(
    new Request(`${ORIGINE}/connexion`, {
      method: "POST",
      headers,
      body: new URLSearchParams({ csrf: jeton.champ, phrase }).toString(),
    }),
    env(),
  );
}

function cookieEntete(reponse: Response): string {
  return reponse.headers.getSetCookie()
    .map((ligne) => ligne.split(";")[0])
    .join("; ");
}

async function pageApres(reponse: Response, cookies: string): Promise<string> {
  expect(reponse.status).toBe(303);
  const cible = reponse.headers.get("Location") ?? "";
  expect(cible.startsWith("/dossiers/")).toBe(true);
  expect(cible).not.toContain("/courrier");
  const flash = reponse.headers.getSetCookie().find((ligne) => ligne.startsWith("__Host-info="))?.split(";")[0] ?? "";
  expect(flash).not.toBe("");
  const suite = await repondre(demande("GET", cible, `${cookies}; ${flash}`), env());
  expect(suite.status).toBe(200);
  expect(suite.headers.getSetCookie().some((ligne) => ligne.startsWith("__Host-info=") && ligne.includes("Max-Age=0"))).toBe(true);
  return suite.text();
}

function echecs(): number {
  const ligne = dbCourante().prepare("SELECT echecs FROM tentatives_globales WHERE id = 1").get() as { echecs: number };
  return ligne.echecs;
}

function sessions(): number {
  const ligne = dbCourante().prepare("SELECT count(*) AS n FROM sessions").get() as { n: number };
  return ligne.n;
}

function audits(): string {
  return JSON.stringify(dbCourante().prepare("SELECT action, detail FROM audit").all());
}

function agents(): string[] {
  return (
    dbCourante().prepare("SELECT user_agent FROM sessions").all() as { user_agent: string }[]
  ).map((ligne) => ligne.user_agent);
}

function assertCookie(cookie: string): void {
  expect(cookie).toMatch(/^__Host-/);
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("Secure");
  expect(cookie).toContain("SameSite=Strict");
  expect(cookie).toContain("Path=/");
  expect(cookie.toLowerCase()).not.toContain("domain=");
}

async function assertSansFormulaire(reponse: Response, corps: string): Promise<void> {
  const texte = await reponse.text();
  expect(texte).toBe(corps);
  expect(texte.toLowerCase()).not.toContain("<form");
  expect(texte.toLowerCase()).not.toContain("<input");
  expect(texte).not.toContain("<");
  expect(reponse.headers.get("Set-Cookie")).toBeNull();
  assertEntetes(reponse);
}

function assertEntetes(reponse: Response): void {
  expect(reponse.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
  assertSecurite(reponse);
}

function assertSecurite(reponse: Response): void {
  expect(reponse.headers.get("Content-Security-Policy")).toBe(CSP);
  expect(reponse.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(reponse.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(reponse.headers.get("Strict-Transport-Security")).toBe(HSTS);
  expect(reponse.headers.get("Strict-Transport-Security")).not.toContain("includeSubDomains");
}
