import { comparerTempsConstant } from "./mot-de-passe.ts";

export const NOM_SESSION = "__Host-registre";
export const NOM_CSRF = "__Host-csrf";

export function nouveauJeton(): string {
  const octets = new Uint8Array(32);
  crypto.getRandomValues(octets);
  return versBase64Url(octets);
}

export async function empreinteJeton(jeton: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(jeton));
  return versBase64Url(new Uint8Array(digest));
}

export function lireCookie(entete: string | null, nom: string): string | null {
  if (!entete) return null;
  for (const part of entete.split(";")) {
    const coupe = part.indexOf("=");
    if (coupe === -1) continue;
    if (part.slice(0, coupe).trim() === nom) return part.slice(coupe + 1).trim();
  }
  return null;
}

export function cookieHote(nom: string, valeur: string, maxAge: number): string {
  return `${nom}=${valeur}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export function effacerCookie(nom: string): string {
  return cookieHote(nom, "", 0);
}

export function memesJetons(a: string, b: string): boolean {
  return comparerTempsConstant(new TextEncoder().encode(a), new TextEncoder().encode(b));
}

export function adresseIp(requete: Request): string {
  return (requete.headers.get("CF-Connecting-IP") ?? "").trim().slice(0, 128);
}

export function agent(requete: Request): string {
  return [...(requete.headers.get("User-Agent") ?? "")].slice(0, 512).join("");
}

function versBase64Url(octets: Uint8Array): string {
  let binaire = "";
  for (const octet of octets) binaire += String.fromCharCode(octet);
  return btoa(binaire).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
