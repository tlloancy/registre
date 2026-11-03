import { lireHashMotDePasse, type Preparer } from "./db.ts";
import { reponse } from "./entetes.ts";
import { prouverPbkdf2 } from "./preuve.ts";

export type Env = {
  DB: Preparer;
  FICHIERS?: unknown;
  PREUVE?: string;
};

export async function repondre(requete: Request, env: Env): Promise<Response> {
  const url = new URL(requete.url);
  if (requete.method === "GET" && url.pathname === "/preuve-pbkdf2" && env.PREUVE === "1") {
    try {
      await prouverPbkdf2();
      return reponse(200, "pbkdf2 ok\n");
    } catch (erreur) {
      return reponse(500, `${messageDe(erreur)}\n`);
    }
  }

  let hash: string | null;
  try {
    hash = await lireHashMotDePasse(env.DB);
  } catch {
    return reponse(503, "La base ne répond pas.\n");
  }
  if (hash === null) return reponse(503, "Le mot de passe n'est pas posé.\n");
  return reponse(401, "L'accès n'est pas ouvert.\n");
}

function messageDe(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur);
}
