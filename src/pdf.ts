import { extractText, getDocumentProxy } from "unpdf";

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
