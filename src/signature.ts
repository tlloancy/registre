const SEUIL_SCAN = 40;

export function normaliserContenu(texte: string): string {
  return texte.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function estScan(texte: string): boolean {
  return normaliserContenu(texte).length < SEUIL_SCAN;
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
