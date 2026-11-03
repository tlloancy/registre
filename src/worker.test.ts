import { describe, expect, it } from "vitest";
import { CSP, HSTS } from "./entetes.ts";
import { repondre, type Env } from "./worker.ts";

const HASH = "empreinte-de-test";

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

  it("répond 401 sans formulaire quand le hash est posé", async () => {
    const reponse = await repondre(demande("GET", "/"), base(HASH));
    expect(reponse.status).toBe(401);
    await assertSansFormulaire(reponse, "L'accès n'est pas ouvert.\n");
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

function demande(method: string, pathname: string): Request {
  return new Request(`https://registre.formation.deter-mi.net${pathname}`, { method });
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
            };
          },
        };
      },
    },
  };
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
  expect(reponse.headers.get("Content-Security-Policy")).toBe(CSP);
  expect(reponse.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(reponse.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(reponse.headers.get("Strict-Transport-Security")).toBe(HSTS);
  expect(reponse.headers.get("Strict-Transport-Security")).not.toContain("includeSubDomains");
}
