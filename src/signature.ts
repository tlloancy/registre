import type { Glyphe } from "./pdf.ts";

const SEUIL_SCAN = 40;
const ECART_PLACE = 1;

export function normaliserContenu(texte: string): string {
  return texte.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function estScan(texte: string): boolean {
  return normaliserContenu(texte).length < SEUIL_SCAN;
}

export function couvreDocument(origine: readonly (readonly Glyphe[])[], depot: readonly (readonly Glyphe[])[]): boolean {
  if (origine.length === 0 || origine.length !== depot.length) return false;
  let nombre = 0;
  for (let page = 0; page < origine.length; page += 1) {
    const cible = depot[page] ?? [];
    for (const glyphe of origine[page] ?? []) {
      if (glyphe.texte.trim() === "") continue;
      nombre += 1;
      const trouve = cible.some(
        (autre) =>
          autre.texte === glyphe.texte &&
          Math.abs(autre.x - glyphe.x) <= ECART_PLACE &&
          Math.abs(autre.y - glyphe.y) <= ECART_PLACE,
      );
      if (!trouve) return false;
    }
  }
  return nombre > 0;
}

export function estSignature(
  texte: string,
  empreinte: string,
  versions: readonly { texte: string; empreinte: string }[],
): boolean {
  if (estScan(texte)) return true;
  const contenu = normaliserContenu(texte);
  return versions.some((version) => version.empreinte !== empreinte && normaliserContenu(version.texte) === contenu);
}
