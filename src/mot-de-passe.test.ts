import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { poserMotDePasse } from "./mot-de-passe-commande.ts";
import {
  comparerTempsConstant,
  deriver,
  phraseCorrespond,
  phraseDepuisEntree,
  validerPhrase,
} from "./mot-de-passe.ts";

const PHRASE = "une phrase assez longue";
const AUTRE = "une autre phrase longue";
const dossiers: string[] = [];

afterEach(() => {
  for (const dossier of dossiers.splice(0)) rmSync(dossier, { recursive: true, force: true });
});

describe("phrase", () => {
  it("ignore un seul saut de ligne final", () => {
    expect(phraseDepuisEntree("une phrase assez longue\n")).toBe(PHRASE);
    expect(phraseDepuisEntree("une phrase assez longue\r\n")).toBe(PHRASE);
  });

  it("refuse moins de 20 caractères", () => {
    expect(validerPhrase("trop courte ici")).toEqual({
      ok: false,
      raison: "La phrase doit contenir au moins 20 caractères.",
    });
  });

  it("compte les caractères, pas les octets", () => {
    expect(validerPhrase(`${"é".repeat(19)} `).ok).toBe(true);
    expect(validerPhrase("é".repeat(19)).ok).toBe(false);
  });

  it("refuse 20 caractères sans espace", () => {
    expect(validerPhrase("a".repeat(20))).toEqual({
      ok: false,
      raison: "La phrase doit contenir un espace.",
    });
  });

  it("accepte 20 caractères dont un espace", () => {
    expect(validerPhrase(`${"a".repeat(19)} `)).toEqual({ ok: true });
  });
});

describe("empreinte", () => {
  it("compare sans s'arrêter sur la longueur", () => {
    expect(comparerTempsConstant(Uint8Array.of(1, 2), Uint8Array.of(1, 2))).toBe(true);
    expect(comparerTempsConstant(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(false);
    expect(comparerTempsConstant(Uint8Array.of(1), Uint8Array.of(1, 0))).toBe(false);
  });

  it("produit un sel de 16 octets et une empreinte de 32", async () => {
    const empreinte = await deriver(PHRASE);
    expect(empreinte.algo).toBe("PBKDF2-SHA-256");
    expect(empreinte.iterations).toBe(100_000);
    expect(depuisBase64(empreinte.sel).length).toBe(16);
    expect(depuisBase64(empreinte.hash).length).toBe(32);
    expect(await phraseCorrespond(PHRASE, empreinte.sel, empreinte.hash)).toBe(true);
    expect(await phraseCorrespond(AUTRE, empreinte.sel, empreinte.hash)).toBe(false);
    expect(await phraseCorrespond(PHRASE, "%%%", empreinte.hash)).toBe(false);
  });

  it("change le sel à chaque appel", async () => {
    const une = await deriver(PHRASE);
    const deux = await deriver(PHRASE);
    expect(une.sel).not.toBe(deux.sel);
  });
});

describe("commande", () => {
  it("enregistre le hash et refuse un second passage", async () => {
    const base = baseVierge();
    const pose = await poserMotDePasse(base, PHRASE, false, new Date("2026-11-03T15:00:00.000Z"));
    expect(pose).toEqual({ ok: true, remplace: false });

    const ligne = lire(base);
    expect(ligne.mot_de_passe_algo).toBe("PBKDF2-SHA-256");
    expect(ligne.mot_de_passe_iterations).toBe(100_000);
    expect(ligne.mot_de_passe_defini_le).toBe("2026-11-03T15:00:00.000Z");
    expect(ligne.mot_de_passe_hash).not.toContain(PHRASE);
    expect(await phraseCorrespond(PHRASE, ligne.mot_de_passe_sel, ligne.mot_de_passe_hash)).toBe(true);
    expect(nombreAudits(base)).toBe(0);

    const refus = await poserMotDePasse(base, AUTRE, false);
    expect(refus).toEqual({
      ok: false,
      raison: "Un mot de passe est déjà posé. Relancer avec --remplacer.",
    });
    expect(lire(base).mot_de_passe_hash).toBe(ligne.mot_de_passe_hash);
  });

  it("n'écrit rien si la phrase est refusée", async () => {
    const base = baseVierge();
    const refus = await poserMotDePasse(base, "courte", false);
    expect(refus.ok).toBe(false);
    expect(lire(base).mot_de_passe_hash).toBeNull();
  });

  it("remplace seulement avec le drapeau, audit d'abord", async () => {
    const base = baseVierge();
    await poserMotDePasse(base, PHRASE, false, new Date("2026-11-03T15:00:00.000Z"));
    const avant = lire(base);

    const pose = await poserMotDePasse(base, AUTRE, true, new Date("2026-11-03T16:00:00.000Z"));
    expect(pose).toEqual({ ok: true, remplace: true });

    const apres = lire(base);
    expect(apres.mot_de_passe_hash).not.toBe(avant.mot_de_passe_hash);
    expect(apres.mot_de_passe_defini_le).toBe("2026-11-03T16:00:00.000Z");
    expect(await phraseCorrespond(AUTRE, apres.mot_de_passe_sel, apres.mot_de_passe_hash)).toBe(true);
    expect(await phraseCorrespond(PHRASE, apres.mot_de_passe_sel, apres.mot_de_passe_hash)).toBe(false);

    const audits = auditsDe(base);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe("mot_de_passe_remplace");
    expect(audits[0]?.at_utc).toBe("2026-11-03T16:00:00.000Z");
    expect(audits[0]?.detail).toBe(
      JSON.stringify({ defini_le_precedent: "2026-11-03T15:00:00.000Z" }),
    );
    expect(audits[0]?.detail).not.toContain(PHRASE);
    expect(audits[0]?.detail).not.toContain(AUTRE);
    expect(audits[0]?.detail).not.toContain(avant.mot_de_passe_hash);
  });

  it("annule l'audit si la mise à jour échoue", async () => {
    const base = baseVierge();
    await poserMotDePasse(base, PHRASE, false, new Date("2026-11-03T15:00:00.000Z"));
    const avant = lire(base);
    const db = new DatabaseSync(base);
    db.exec(
      `CREATE TRIGGER mot_de_passe_bloque_test
       BEFORE UPDATE OF mot_de_passe_hash ON reglages
       BEGIN
         SELECT RAISE(ABORT, 'bloque test');
       END`,
    );
    db.close();

    await expect(poserMotDePasse(base, AUTRE, true)).rejects.toThrow(/bloque test/);
    expect(lire(base).mot_de_passe_hash).toBe(avant.mot_de_passe_hash);
    expect(nombreAudits(base)).toBe(0);
  });

  it("passe par l'entrée standard sans réécrire la phrase", () => {
    const base = baseVierge();
    const resultat = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--disable-warning=ExperimentalWarning",
        fileURLToPath(new URL("./mot-de-passe-commande.ts", import.meta.url)),
        base,
      ],
      { input: `${PHRASE}\n`, encoding: "utf8" },
    );
    expect(resultat.status).toBe(0);
    expect(resultat.stdout).toBe("Mot de passe enregistré.\n");
    expect(resultat.stdout).not.toContain(PHRASE);
    expect(resultat.stderr).not.toContain(PHRASE);
    expect(lire(base).mot_de_passe_hash).not.toBeNull();
  });
});

function baseVierge(): string {
  const dossier = mkdtempSync(join(tmpdir(), "registre-mdp-"));
  dossiers.push(dossier);
  const base = join(dossier, "registre.sqlite");
  const db = new DatabaseSync(base);
  db.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
  db.close();
  return base;
}

type Ligne = {
  mot_de_passe_algo: string | null;
  mot_de_passe_iterations: number | null;
  mot_de_passe_sel: string;
  mot_de_passe_hash: string;
  mot_de_passe_defini_le: string | null;
};

function lire(base: string): Ligne {
  const db = new DatabaseSync(base);
  try {
    return db
      .prepare(
        `SELECT mot_de_passe_algo, mot_de_passe_iterations, mot_de_passe_sel,
                mot_de_passe_hash, mot_de_passe_defini_le
           FROM reglages WHERE id = 1`,
      )
      .get() as Ligne;
  } finally {
    db.close();
  }
}

function nombreAudits(base: string): number {
  return auditsDe(base).length;
}

function auditsDe(base: string): { action: string; at_utc: string; detail: string }[] {
  const db = new DatabaseSync(base);
  try {
    return db.prepare("SELECT action, at_utc, detail FROM audit").all() as {
      action: string;
      at_utc: string;
      detail: string;
    }[];
  } finally {
    db.close();
  }
}

function depuisBase64(texte: string): Uint8Array {
  const binaire = atob(texte);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return octets;
}
