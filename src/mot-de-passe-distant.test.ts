import { describe, expect, it } from "vitest";
import {
  type Execution,
  lireLigneDistante,
  poserMotDePasseDistant,
  sqlMiseAJour,
} from "./mot-de-passe-commande.ts";

const PHRASE = "une phrase assez longue";
const HASH = "a".repeat(44);
const SEL = "b".repeat(24);

describe("sql distant", () => {
  it("écrit la mise à jour sans transaction SQL et sans la phrase", () => {
    const sql = sqlMiseAJour(empreinte(), "2026-11-03T15:00:00.000Z", null);
    expect(sql.startsWith("UPDATE reglages")).toBe(true);
    expect(sql).not.toContain("BEGIN");
    expect(sql).not.toContain("COMMIT");
    expect(sql).toContain("100000");
    expect(sql).toContain(HASH);
    expect(sql).not.toContain("INSERT INTO audit");
    expect(sql).not.toContain(PHRASE);
    expect(sql).not.toContain("\r");
  });

  it("écrit l'audit avant la mise à jour quand un hash existe", () => {
    const sql = sqlMiseAJour(empreinte(), "2026-11-03T16:00:00.000Z", {
      defini_le_precedent: "2026-11-03T15:00:00.000Z",
    });
    expect(sql.indexOf("INSERT INTO audit")).toBeLessThan(sql.indexOf("UPDATE reglages"));
    expect(sql).toContain("mot_de_passe_remplace");
    expect(sql).toContain("2026-11-03T15:00:00.000Z");
  });

  it("lit la ligne JSON de wrangler", () => {
    const ligne = lireLigneDistante(
      `avertissement\n[{"results":[{"mot_de_passe_hash":null,"mot_de_passe_defini_le":null}],"success":true}]`,
    );
    expect(ligne).toEqual({ mot_de_passe_hash: null, mot_de_passe_defini_le: null });
  });
});

describe("pose distante", () => {
  it("refuse de remplacer sans drapeau et n'envoie pas d'écriture", async () => {
    const appels: string[][] = [];
    const resultat = await poserMotDePasseDistant(PHRASE, false, (args) => {
      appels.push(args);
      return lecture("deja-pose", "2026-11-03T15:00:00.000Z");
    });
    expect(resultat.ok).toBe(false);
    expect(appels).toHaveLength(1);
    expect(appels[0]).toContain("--remote");
  });

  it("envoie le hash, pas la phrase", async () => {
    const appels: string[][] = [];
    const resultat = await poserMotDePasseDistant(
      PHRASE,
      false,
      (args) => {
        appels.push(args);
        if (args.includes("SELECT mot_de_passe_hash, mot_de_passe_defini_le FROM reglages WHERE id = 1")) {
          return lecture(null, null);
        }
        const sql = args.at(-1) ?? "";
        expect(sql).not.toContain(PHRASE);
        expect(sql).not.toContain("BEGIN");
        expect(sql.startsWith("UPDATE reglages")).toBe(true);
        expect(sql).toContain("PBKDF2-SHA-256");
        return { code: 0, stdout: "[]", stderr: "" };
      },
      new Date("2026-11-03T15:00:00.000Z"),
    );
    expect(resultat).toEqual({ ok: true, remplace: false });
    expect(appels).toHaveLength(2);
  });
});

function empreinte() {
  return {
    algo: "PBKDF2-SHA-256" as const,
    iterations: 100_000 as const,
    sel: SEL,
    hash: HASH,
  };
}

function lecture(hash: string | null, definiLe: string | null): Execution {
  return {
    code: 0,
    stdout: JSON.stringify([
      { results: [{ mot_de_passe_hash: hash, mot_de_passe_defini_le: definiLe }], success: true },
    ]),
    stderr: "",
  };
}
