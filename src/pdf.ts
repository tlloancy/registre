import { extractText } from "unpdf";

export async function textePdf(octets: Uint8Array): Promise<string> {
  const resultat = await extractText(octets, { mergePages: true });
  return typeof resultat.text === "string" ? resultat.text : resultat.text.join("\n");
}
