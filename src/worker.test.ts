import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
  });

  beforeEach(() => {
    horloge = new Date("2026-11-03T18:00:00.000Z");
    fichiers = new MemoireFichiers();
    ouvrirBase();
  });

  afterAll(() => baseSql?.close());

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
    expect(html).not.toContain(PHRASE);
    expect(audits()).not.toContain(PHRASE);
    const longue = await envoyer(await jetonPage(await repondre(demande("GET", "/"), env())), PHRASE, "B".repeat(600));
    expect(agents()).toContain("B".repeat(512));
    expect(longue.status).toBe(303);
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
    const id = /href="\/dossiers\/([^"]+)"/.exec(accueil)?.[1] ?? "";
    const page = await repondre(demande("GET", `/dossiers/${id}`, cookies), env());
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain("Programme");
    expect(html).toContain("Devis D2600007");
    expect(html).toContain("720,00 €");
    expect(html).toContain("Télécharger");
    const devis = await repondre(demande("GET", `/dossiers/${id}/devis`, cookies), env());
    expect(devis.status).toBe(200);
    expect(devis.headers.get("Content-Type")).toBe("application/pdf");
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

async function deposerPdf(cookies: string, csrf: string, pdf: Uint8Array): Promise<Response> {
  const formulaire = new FormData();
  formulaire.set("csrf", csrf);
  formulaire.set("convention", new File([pdf], "convention.pdf", { type: "application/pdf" }));
  return repondre(
    new Request(`${ORIGINE}/dossiers`, {
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
