import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { type Empreinte, deriver, phraseDepuisEntree, validerPhrase } from "./mot-de-passe.ts";

export type ResultatPose = { ok: true; remplace: boolean } | { ok: false; raison: string };

type LigneMotDePasse = {
  mot_de_passe_hash: string | null;
  mot_de_passe_defini_le: string | null;
};

export async function poserMotDePasse(
  base: string,
  phrase: string,
  remplacer: boolean,
  maintenant = new Date(),
): Promise<ResultatPose> {
  const validation = validerPhrase(phrase);
  if (!validation.ok) return validation;
  if (!existsSync(base)) {
    return { ok: false, raison: "La base est introuvable. Appliquer la migration avant." };
  }

  const db = new DatabaseSync(base);
  try {
    let ligne: LigneMotDePasse | undefined;
    try {
      ligne = db
        .prepare(
          "SELECT mot_de_passe_hash, mot_de_passe_defini_le FROM reglages WHERE id = 1",
        )
        .get() as LigneMotDePasse | undefined;
    } catch (erreur) {
      if (messageDe(erreur).includes("no such table")) {
        return { ok: false, raison: "La migration n'est pas appliquée sur cette base." };
      }
      throw erreur;
    }
    if (!ligne) {
      return { ok: false, raison: "La table reglages n'a pas de ligne id = 1." };
    }
    const deja = ligne.mot_de_passe_hash !== null;
    if (deja && !remplacer) {
      return {
        ok: false,
        raison: "Un mot de passe est déjà posé. Relancer avec --remplacer.",
      };
    }

    const empreinte = await deriver(phrase);
    const definiLe = maintenant.toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      if (deja) {
        db.prepare(
          `INSERT INTO audit (at_utc, acteur, ip, action, cible_type, cible_id, detail)
           VALUES (?, 'commande', NULL, 'mot_de_passe_remplace', 'reglages', '1', ?)`,
        ).run(definiLe, JSON.stringify({ defini_le_precedent: ligne.mot_de_passe_defini_le }));
      }
      const ecrit = db
        .prepare(
          `UPDATE reglages
              SET mot_de_passe_algo = ?,
                  mot_de_passe_iterations = ?,
                  mot_de_passe_sel = ?,
                  mot_de_passe_hash = ?,
                  mot_de_passe_defini_le = ?
            WHERE id = 1`,
        )
        .run(empreinte.algo, empreinte.iterations, empreinte.sel, empreinte.hash, definiLe);
      if (ecrit.changes !== 1) {
        db.exec("ROLLBACK");
        return { ok: false, raison: "La mise à jour de reglages n'a pas eu lieu." };
      }
      db.exec("COMMIT");
    } catch (erreur) {
      db.exec("ROLLBACK");
      throw erreur;
    }
    return { ok: true, remplace: deja };
  } finally {
    db.close();
  }
}

export type Execution = { code: number; stdout: string; stderr: string };

const SELECT_DISTANT =
  "SELECT mot_de_passe_hash, mot_de_passe_defini_le FROM reglages WHERE id = 1";

export function sqlMiseAJour(
  empreinte: Empreinte,
  definiLe: string,
  audit: { defini_le_precedent: string | null } | null,
): string {
  const ligneAudit =
    audit === null
      ? ""
      : `INSERT INTO audit (at_utc, acteur, ip, action, cible_type, cible_id, detail)
VALUES (${texteSql(definiLe)}, 'commande', NULL, 'mot_de_passe_remplace', 'reglages', '1', ${texteSql(JSON.stringify(audit))});
`;
  return `BEGIN IMMEDIATE;
${ligneAudit}UPDATE reglages
   SET mot_de_passe_algo = ${texteSql(empreinte.algo)},
       mot_de_passe_iterations = ${empreinte.iterations},
       mot_de_passe_sel = ${texteSql(empreinte.sel)},
       mot_de_passe_hash = ${texteSql(empreinte.hash)},
       mot_de_passe_defini_le = ${texteSql(definiLe)}
 WHERE id = 1;
COMMIT;
`;
}

export function lireLigneDistante(sortie: string): LigneMotDePasse | null {
  const debut = sortie.indexOf("[");
  if (debut < 0) throw new Error("La réponse D1 n'est pas du JSON.");
  const data = JSON.parse(sortie.slice(debut)) as Array<{
    results?: LigneMotDePasse[];
  }>;
  return data[0]?.results?.[0] ?? null;
}

export async function poserMotDePasseDistant(
  phrase: string,
  remplacer: boolean,
  executer: (args: string[]) => Execution,
  maintenant = new Date(),
): Promise<ResultatPose> {
  const validation = validerPhrase(phrase);
  if (!validation.ok) return validation;

  const lecture = executer([
    "d1",
    "execute",
    "registre",
    "--remote",
    "--json",
    "--command",
    SELECT_DISTANT,
  ]);
  if (lecture.code !== 0) {
    return { ok: false, raison: "La lecture de la base distante a échoué." };
  }
  const ligne = lireLigneDistante(lecture.stdout);
  if (!ligne) return { ok: false, raison: "La table reglages n'a pas de ligne id = 1." };
  const deja = ligne.mot_de_passe_hash !== null && ligne.mot_de_passe_hash !== "";
  if (deja && !remplacer) {
    return {
      ok: false,
      raison: "Un mot de passe est déjà posé. Relancer avec --remplacer.",
    };
  }

  const empreinte = await deriver(phrase);
  const definiLe = maintenant.toISOString();
  const sql = sqlMiseAJour(
    empreinte,
    definiLe,
    deja ? { defini_le_precedent: ligne.mot_de_passe_defini_le } : null,
  );
  const ecriture = executer([
    "d1",
    "execute",
    "registre",
    "--remote",
    "--json",
    "--yes",
    "--command",
    sql,
  ]);
  if (ecriture.code !== 0) {
    return { ok: false, raison: "La base distante a refusé la mise à jour." };
  }
  return { ok: true, remplace: deja };
}

function texteSql(valeur: string): string {
  return `'${valeur.replaceAll("'", "''")}'`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let remplacer = false;
  let distant = false;
  const fichiers: string[] = [];
  for (const arg of args) {
    if (arg === "--remplacer") {
      remplacer = true;
      continue;
    }
    if (arg === "--distant") {
      distant = true;
      continue;
    }
    if (arg.startsWith("-")) {
      process.stderr.write(`Option inconnue : ${arg}\n`);
      process.stderr.write(usage());
      process.exitCode = 1;
      return;
    }
    fichiers.push(arg);
  }
  if ((distant && fichiers.length !== 0) || (!distant && fichiers.length !== 1)) {
    process.stderr.write(usage());
    process.exitCode = 1;
    return;
  }

  const phrase = phraseDepuisEntree(lireEntree());
  const resultat = distant
    ? await poserMotDePasseDistant(phrase, remplacer, executerWrangler)
    : await poserMotDePasse(fichiers[0], phrase, remplacer);
  if (!resultat.ok) {
    process.stderr.write(`${resultat.raison}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(resultat.remplace ? "Mot de passe remplacé.\n" : "Mot de passe enregistré.\n");
}

function lireEntree(): string {
  if (!process.stdin.isTTY) return readFileSync(0, "utf8");
  process.stderr.write("Phrase, puis Ctrl-D :\n");
  spawnSync("stty", ["-echo"], { stdio: "inherit" });
  try {
    return readFileSync(0, "utf8");
  } finally {
    spawnSync("stty", ["echo"], { stdio: "inherit" });
    process.stderr.write("\n");
  }
}

function executerWrangler(args: string[]): Execution {
  const resultat = spawnSync(cheminWrangler(), args, {
    encoding: "utf8",
    cwd: fileURLToPath(new URL("..", import.meta.url)),
  });
  return {
    code: resultat.status ?? 1,
    stdout: resultat.stdout ?? "",
    stderr: resultat.stderr ?? "",
  };
}

function cheminWrangler(): string {
  return fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url));
}

function usage(): string {
  return (
    "Usage : npm run mot-de-passe -- [--remplacer] <fichier.sqlite>\n" +
    "        npm run mot-de-passe -- [--remplacer] --distant\n"
  );
}

function messageDe(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur);
}

function lanceDirectement(): boolean {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return realpathSync(arg) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (lanceDirectement()) {
  void main().catch((erreur: unknown) => {
    process.stderr.write(`${messageDe(erreur)}\n`);
    process.exitCode = 1;
  });
}
