import { extractText, getDocumentProxy } from "unpdf";

export type Glyphe = { texte: string; x: number; y: number };

export async function glyphesPdf(octets: Uint8Array): Promise<Glyphe[][]> {
  const pdf = await getDocumentProxy(new Uint8Array(octets));
  try {
    const pages: Glyphe[][] = [];
    for (let page = 1; page <= pdf.numPages; page += 1) {
      const contenu = await (await pdf.getPage(page)).getTextContent();
      pages.push(
        contenu.items.flatMap((item) => {
          if (!("str" in item) || typeof item.str !== "string" || item.str.trim() === "" || !("transform" in item)) return [];
          return [{ texte: item.str, x: item.transform[4] ?? 0, y: item.transform[5] ?? 0 }];
        }),
      );
    }
    return pages;
  } finally {
    await pdf.loadingTask?.destroy();
  }
}

export async function textePdf(octets: Uint8Array): Promise<string> {
  const resultat = await extractText(octets, { mergePages: true });
  return typeof resultat.text === "string" ? resultat.text : resultat.text.join("\n");
}

export async function textePremieresPages(octets: Uint8Array, maxPages: number): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(octets));
  try {
    const textes: string[] = [];
    const nombre = Math.min(pdf.numPages, maxPages);
    for (let page = 1; page <= nombre; page += 1) {
      const contenu = await (await pdf.getPage(page)).getTextContent();
      const texte = contenu.items
        .map((item) => ("str" in item && typeof item.str === "string" ? `${item.str}${item.hasEOL ? "\n" : " "}` : ""))
        .join("");
      textes.push(texte);
    }
    return textes.join("\n");
  } finally {
    await pdf.loadingTask?.destroy();
  }
}
