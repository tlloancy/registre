/** PBKDF2-SHA-256, 100000 itérations, sel de 16 octets, empreinte de 256 bits. */

export const MOT_DE_PASSE_ALGO = "PBKDF2-SHA-256";
export const MOT_DE_PASSE_ITERATIONS = 100_000;
export const MOT_DE_PASSE_SEL_OCTETS = 16;
export const MOT_DE_PASSE_HASH_BITS = 256;

const PHRASE_MIN = 20;

export type Empreinte = {
  algo: typeof MOT_DE_PASSE_ALGO;
  iterations: typeof MOT_DE_PASSE_ITERATIONS;
  sel: string;
  hash: string;
};

export function phraseDepuisEntree(brut: string): string {
  let phrase = brut;
  if (phrase.endsWith("\n")) phrase = phrase.slice(0, -1);
  if (phrase.endsWith("\r")) phrase = phrase.slice(0, -1);
  return phrase;
}

export function validerPhrase(phrase: string): { ok: true } | { ok: false; raison: string } {
  if ([...phrase].length < PHRASE_MIN) {
    return { ok: false, raison: "La phrase doit contenir au moins 20 caractères." };
  }
  return { ok: true };
}

export function comparerTempsConstant(a: Uint8Array, b: Uint8Array): boolean {
  const taille = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < taille; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

export async function deriver(phrase: string): Promise<Empreinte> {
  const validation = validerPhrase(phrase);
  if (!validation.ok) throw new Error(validation.raison);
  const sel = new Uint8Array(MOT_DE_PASSE_SEL_OCTETS);
  crypto.getRandomValues(sel);
  const hash = await calculer(phrase, sel);
  return {
    algo: MOT_DE_PASSE_ALGO,
    iterations: MOT_DE_PASSE_ITERATIONS,
    sel: versBase64(sel),
    hash: versBase64(hash),
  };
}

export async function phraseCorrespond(phrase: string, sel: string, hash: string): Promise<boolean> {
  let selOctets: Uint8Array;
  let attendu: Uint8Array;
  try {
    selOctets = depuisBase64(sel);
    attendu = depuisBase64(hash);
  } catch {
    return false;
  }
  if (selOctets.length !== MOT_DE_PASSE_SEL_OCTETS || attendu.length !== MOT_DE_PASSE_HASH_BITS / 8) {
    return false;
  }
  const obtenu = await calculer(phrase, selOctets);
  return comparerTempsConstant(obtenu, attendu);
}

async function calculer(phrase: string, sel: Uint8Array): Promise<Uint8Array> {
  const cle = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(phrase),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: sel,
      iterations: MOT_DE_PASSE_ITERATIONS,
    },
    cle,
    MOT_DE_PASSE_HASH_BITS,
  );
  return new Uint8Array(bits);
}

function versBase64(octets: Uint8Array): string {
  let binaire = "";
  for (const octet of octets) binaire += String.fromCharCode(octet);
  return btoa(binaire);
}

function depuisBase64(texte: string): Uint8Array {
  const binaire = atob(texte);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return octets;
}
