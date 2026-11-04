import { pdfReconnu } from "./convention.ts";
import { REGLEMENT_URL } from "./modeles.ts";
import { ecrirePdf } from "./pdf-ecrit.ts";

export const DOCUMENTS_ORGANISME = [
  {
    code: "certificat",
    libelle: "Certificat Qualiopi",
    url: "https://deter-mi.net/wp-content/uploads/2026/04/22618172-LLOANCY-THOMAS-Qualiopi.pdf",
  },
  {
    code: "catalogue",
    libelle: "Catalogue des formations",
    url: "https://deter-mi.net/wp-content/uploads/2026/04/cataloguedeformation.pdf",
  },
  {
    code: "reglement",
    libelle: "Règlement intérieur",
    url: REGLEMENT_URL,
  },
  {
    code: "cgv",
    libelle: "Conditions générales de vente",
    url: "https://formation.deter-mi.net/cgv.php",
  },
] as const;

export type CodeOrganisme = (typeof DOCUMENTS_ORGANISME)[number]["code"];

const TAILLE_MAX = 8_000_000;

export function documentOrganisme(code: string): (typeof DOCUMENTS_ORGANISME)[number] | null {
  return DOCUMENTS_ORGANISME.find((document) => document.code === code) ?? null;
}

export function texteHtml(html: string): string {
  const sansScript = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  const lignes = sansScript
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h1|h2|h3|li|div|ul)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "");
  return decoder(lignes)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function chargerDocumentOrganisme(code: string): Promise<Uint8Array | null> {
  const document = documentOrganisme(code);
  if (!document) return null;
  try {
    const reponse = await fetch(document.url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(15000),
    });
    if (!reponse.ok) return null;
    if (document.code === "cgv") {
      const texte = texteHtml(await reponse.text());
      if (texte.length < 200 || !texte.includes("Conditions Générales de Vente")) return null;
      return ecrirePdf(texte);
    }
    const octets = new Uint8Array(await reponse.arrayBuffer());
    if (!pdfReconnu(octets) || octets.byteLength === 0 || octets.byteLength > TAILLE_MAX) return null;
    return octets;
  } catch {
    return null;
  }
}

function decoder(valeur: string): string {
  return valeur
    .replace(/&#(\d+);/g, (_, nombre: string) => String.fromCodePoint(Number(nombre)))
    .replace(/&#x([0-9a-f]+);/gi, (_, nombre: string) => String.fromCodePoint(Number.parseInt(nombre, 16)))
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}
