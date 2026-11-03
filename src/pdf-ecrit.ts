const LIGNES_PAR_PAGE = 52;
const CARACTERES = 90;

const OCTETS: Record<string, number> = {
  "€": 0x80,
  "Œ": 0x8c,
  "œ": 0x9c,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "–": 0x96,
  "—": 0x97,
};

export function ecrirePdf(texte: string): Uint8Array {
  const lignes = replier(texte).slice(0, LIGNES_PAR_PAGE * 20);
  const pages: string[][] = [];
  for (let index = 0; index < Math.max(lignes.length, 1); index += LIGNES_PAR_PAGE) {
    pages.push(lignes.slice(index, index + LIGNES_PAR_PAGE));
  }
  const police = 3 + pages.length * 2;
  const objets = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  ];
  for (const [index, page] of pages.entries()) {
    const flux = contenu(page);
    objets.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${4 + index * 2} 0 R /Resources << /Font << /F1 ${police} 0 R >> >> >>`,
    );
    objets.push(`<< /Length ${utf8(flux).length} >>\nstream\n${flux}\nendstream`);
  }
  objets.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  return assembler(objets);
}

function contenu(lignes: string[]): string {
  const shows = (lignes.length > 0 ? lignes : [""])
    .map((ligne, index) => `${index === 0 ? "" : "T*\n"}(${chaine(ligne)}) Tj`)
    .join("\n");
  return `BT\n/F1 11 Tf\n48 800 Td\n14 TL\n${shows}\nET`;
}

function replier(texte: string): string[] {
  const sortie: string[] = [];
  for (const brute of texte.split(/\n/)) {
    const ligne = brute.replace(/[ \t]+/g, " ").trim();
    if (ligne === "") {
      sortie.push("");
      continue;
    }
    let reste = ligne;
    while ([...reste].length > CARACTERES) {
      const caracteres = [...reste];
      let coupe = caracteres.slice(0, CARACTERES).lastIndexOf(" ");
      if (coupe < 20) coupe = CARACTERES;
      sortie.push(caracteres.slice(0, coupe).join("").trimEnd());
      reste = caracteres.slice(coupe).join("").trimStart();
    }
    sortie.push(reste);
  }
  return sortie;
}

function chaine(valeur: string): string {
  let sortie = "";
  for (const caractere of valeur) {
    const octet = octetDe(caractere);
    if (octet === null) continue;
    if (octet === 0x28 || octet === 0x29 || octet === 0x5c) {
      sortie += `\\${String.fromCharCode(octet)}`;
    } else if (octet < 0x20 || octet > 0x7e) {
      sortie += `\\${octet.toString(8).padStart(3, "0")}`;
    } else {
      sortie += String.fromCharCode(octet);
    }
  }
  return sortie;
}

function octetDe(caractere: string): number | null {
  const special = OCTETS[caractere];
  if (special !== undefined) return special;
  const code = caractere.codePointAt(0) ?? 0;
  if (code >= 0x20 && code <= 0x7e) return code;
  if (code >= 0xa0 && code <= 0xff) return code;
  if (caractere === "\u00a0") return 0x20;
  return null;
}

function assembler(objets: string[]): Uint8Array {
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, objet] of objets.entries()) {
    offsets.push(utf8(pdf).length);
    pdf += `${index + 1} 0 obj\n${objet}\nendobj\n`;
  }
  const xref = utf8(pdf).length;
  pdf += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return utf8(pdf);
}

function utf8(valeur: string): Uint8Array {
  return new TextEncoder().encode(valeur);
}
