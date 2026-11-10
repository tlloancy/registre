const MARGE = 40;
const MARGE_BAS = 46;
const LARGEUR = 595;
const HAUTEUR = 842;
const CONTENU = LARGEUR - MARGE * 2;

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

const STYLE = `
    @page { size: A4; margin: 16mm; }
    html { font-family: Helvetica, Arial, sans-serif; color: #1c1c1c; }
    body { margin: 0; font-size: 10.5pt; line-height: 1.45; }
    h1 { font-size: 16pt; line-height: 1.2; margin: 0 0 6px; padding-bottom: 6px; border-bottom: 1px solid #c4c0b8; }
    h2 { font-size: 12pt; margin: 16px 0 6px; }
    p { margin: 0 0 8px; }
    .meta { color: #4d4a45; font-size: 9pt; margin: 8px 0 14px; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; }
    th, td { border: 1px solid #c4c0b8; padding: 5px 6px; vertical-align: top; text-align: left; }
    th { background: #efece6; font-size: 8pt; }
    td { font-size: 8pt; }
    tr:nth-child(even) td { background: #f7f6f3; }
`;

export function documentHtml(titre: string, meta: string, corps: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${echapper(titre)}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>${echapper(titre)}</h1>
${meta ? `<p class="meta">${echapper(meta)}</p>` : ""}
${corps}
</body>
</html>`;
}

export function sousTitre(texte: string): string {
  return `<h2>${echapper(texte)}</h2>`;
}

export function paragraphes(lignes: string[]): string {
  return lignes.filter((ligne) => ligne.trim() !== "").map((ligne) => `<p>${echapper(ligne)}</p>`).join("");
}

export function tableauHtml(
  lignes: Array<{ date: string; source: string; info: string; impact: string; action: string; statut: string }>,
): string {
  return tableauLibre(
    ["Date", "Source", "Information", "Impact", "Action", "Statut"],
    lignes.map((ligne) => [ligne.date, ligne.source, ligne.info, ligne.impact, ligne.action, ligne.statut]),
  );
}

export function tableauLibre(entetes: string[], lignes: string[][]): string {
  const tete = `<tr>${entetes.map((cellule) => `<th>${echapper(cellule)}</th>`).join("")}</tr>`;
  const corps = lignes
    .map((ligne) => `<tr>${ligne.map((cellule) => `<td>${echapper(cellule)}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead>${tete}</thead><tbody>${corps}</tbody></table>`;
}

export function normaliserHtml(brut: string): string {
  if (brut.includes("<style>")) return brut;
  const lignes = brut.split("\n");
  const titre = lignes[0]?.trim() || "Document";
  const blocs: string[] = [];
  let tampon: string[] = [];
  const vider = () => {
    if (tampon.length === 0) return;
    blocs.push(`<p>${echapper(tampon.join(" "))}</p>`);
    tampon = [];
  };
  for (const ligne of lignes.slice(1)) {
    const propre = ligne.trim();
    if (propre === "") {
      vider();
      continue;
    }
    if (propre.endsWith(":") && propre.length < 80) {
      vider();
      blocs.push(`<h2>${echapper(propre.slice(0, -1))}</h2>`);
      continue;
    }
    tampon.push(propre);
  }
  vider();
  return documentHtml(titre, "", blocs.join(""));
}

type Bloc =
  | { type: "h1" | "h2" | "p" | "meta"; texte: string }
  | { type: "table"; lignes: string[][] };

type Page = { commandes: string[] };

const MARINE = "0.11 0.22 0.36";
const BLEU = "0.12 0.35 0.62";
const DEPART = HAUTEUR - 58;

type Teinte = "encre" | "gris" | "blanc" | "bleu" | "marine";

export function htmlVersPdf(html: string): Uint8Array {
  const blocs = lireBlocs(html);
  const titre = blocs.find((bloc) => bloc.type === "h1" && bloc.texte)?.texte ?? "Document";
  const pages: Page[] = [{ commandes: [] }];
  let y = DEPART;
  const page = () => pages[pages.length - 1] ?? { commandes: [] };
  const commande = (valeur: string) => {
    page().commandes.push(valeur);
  };
  const saut = () => {
    pages.push({ commandes: [] });
    y = DEPART;
  };
  const montrer = (x: number, base: number, taille: number, gras: boolean, valeur: string, teinte: Teinte) => {
    if (!valeur) return;
    const couleur =
      teinte === "gris"
        ? "0.30 0.29 0.27 rg\n"
        : teinte === "blanc"
          ? "1 1 1 rg\n"
          : teinte === "bleu"
            ? `${BLEU} rg\n`
            : teinte === "marine"
              ? `${MARINE} rg\n`
              : "";
    const retour = teinte === "encre" ? "" : "0 0 0 rg\n";
    commande(
      `${couleur}BT /${gras ? "F2" : "F1"} ${taille} Tf 1 0 0 1 ${fixe(x)} ${fixe(base)} Tm (${chaine(valeur)}) Tj ET\n${retour}`,
    );
  };
  for (const bloc of blocs) {
    if (bloc.type === "h1") {
      const lignes = couper(bloc.texte, 16, CONTENU);
      for (const ligne of lignes) {
        if (y - 22 < MARGE_BAS) saut();
        y -= 20;
        montrer(MARGE, y, 16, true, ligne, "marine");
      }
      y -= 6;
      commande(`${MARINE} RG\n1.4 w\n${fixe(MARGE)} ${fixe(y)} m ${fixe(MARGE + CONTENU)} ${fixe(y)} l S\n0 0 0 RG\n`);
      y -= 14;
      continue;
    }
    if (bloc.type === "meta") {
      for (const ligne of couper(bloc.texte, 9, CONTENU)) {
        if (y - 14 < MARGE_BAS) saut();
        y -= 12;
        montrer(MARGE, y, 9, false, ligne, "gris");
      }
      y -= 8;
      continue;
    }
    if (bloc.type === "h2") {
      if (y - 28 < MARGE_BAS) saut();
      y -= 18;
      commande(`${BLEU} rg\n${fixe(MARGE)} ${fixe(y - 2)} 3 14 re f\n0 0 0 rg\n`);
      montrer(MARGE + 10, y, 12, true, bloc.texte, "bleu");
      y -= 8;
      continue;
    }
    if (bloc.type === "p") {
      for (const ligne of couper(bloc.texte, 10.5, CONTENU)) {
        if (y - 15 < MARGE_BAS) saut();
        y -= 14;
        montrer(MARGE, y, 10.5, false, ligne, "encre");
      }
      y -= 4;
      continue;
    }
    dessinerTableau(bloc.lignes, () => y, (valeur) => {
      y = valeur;
    }, saut, commande, montrer);
  }
  if (pages.length > 20) pages.length = 20;
  pages.forEach((feuille, index) => {
    const pied = `${raccourci(titre, 70)}  ·  ${index + 1} / ${pages.length}`;
    feuille.commandes.unshift(
      `${MARINE} rg\n0 ${fixe(HAUTEUR - 26)} ${LARGEUR} 26 re f\n1 1 1 rg\nBT /F2 9 Tf 1 0 0 1 ${fixe(MARGE)} ${fixe(HAUTEUR - 17)} Tm (deter-mi.net) Tj ET\n0 0 0 rg\n`,
    );
    feuille.commandes.push(
      `0.30 0.29 0.27 rg\nBT /F1 8 Tf 1 0 0 1 ${fixe(MARGE)} 26 Tm (${chaine(pied)}) Tj ET\n0 0 0 rg\n`,
    );
  });
  return assembler(pages.map((feuille) => feuille.commandes.join("")));
}

function dessinerTableau(
  lignes: string[][],
  lireY: () => number,
  ecrireY: (valeur: number) => void,
  saut: () => void,
  commande: (valeur: string) => void,
  montrer: (x: number, base: number, taille: number, gras: boolean, valeur: string, teinte: Teinte) => void,
): void {
  const entete = lignes[0] ?? [];
  const corps = lignes.slice(1);
  const colonnes = largeurs(Math.max(entete.length, ...corps.map((ligne) => ligne.length), 1), entete);
  const mesure = (cellules: string[]) => {
    const prepares = cellules.map((cellule, index) => couper(cellule, 8, Math.max((colonnes[index] ?? 40) - 8, 12)));
    return { prepares, hauteur: Math.max(...prepares.map((liste) => liste.length), 1) * 10 + 8 };
  };
  const dessiner = (cellules: string[], fond: boolean, zebra: boolean) => {
    const { prepares, hauteur } = mesure(cellules);
    const y = lireY();
    let x = MARGE;
    if (fond) commande(`${MARINE} rg\n${fixe(x)} ${fixe(y - hauteur)} ${fixe(CONTENU)} ${fixe(hauteur)} re f\n0 0 0 rg\n`);
    else if (zebra) commande(`0.95 0.96 0.97 rg\n${fixe(x)} ${fixe(y - hauteur)} ${fixe(CONTENU)} ${fixe(hauteur)} re f\n0 0 0 rg\n`);
    for (const [index, liste] of prepares.entries()) {
      const largeur = colonnes[index] ?? 40;
      commande(`0.76 0.80 0.84 RG\n0.6 w\n${fixe(x)} ${fixe(y - hauteur)} ${fixe(largeur)} ${fixe(hauteur)} re S\n0 0 0 RG\n`);
      liste.forEach((ligne, ligneIndex) => {
        montrer(x + 4, y - 11 - ligneIndex * 10, 8, fond, ligne, fond ? "blanc" : "encre");
      });
      x += largeur;
    }
    ecrireY(y - hauteur);
  };
  const place = (hauteur: number) => lireY() - hauteur >= MARGE_BAS;
  if (entete.length > 0) {
    if (!place(mesure(entete).hauteur)) saut();
    dessiner(entete, true, false);
  }
  corps.forEach((ligne, index) => {
    if (!place(mesure(ligne).hauteur)) {
      saut();
      if (entete.length > 0) dessiner(entete, true, false);
    }
    dessiner(ligne, false, index % 2 === 1);
  });
}

function largeurs(nombre: number, entete: string[]): number[] {
  if (nombre === 6) return [62, 86, 110, 94, 109, 54];
  if (nombre === 5) {
    const fixe = 78;
    return [CONTENU - fixe * 4, fixe, fixe, fixe, fixe];
  }
  if (nombre === 4 && entete[0] === "N°") return [28, 220, 70, CONTENU - 318];
  if (nombre === 4) {
    const module = Math.round(CONTENU * 0.4);
    const part = Math.floor((CONTENU - module) / 3);
    return [module, part, part, CONTENU - module - part * 2];
  }
  if (nombre === 2) {
    const gauche = Math.round(CONTENU * 0.36);
    return [gauche, CONTENU - gauche];
  }
  const part = Math.floor(CONTENU / nombre);
  return Array.from({ length: nombre }, (_, index) => (index === nombre - 1 ? CONTENU - part * (nombre - 1) : part));
}

function lireBlocs(html: string): Bloc[] {
  const corps = html.split(/<body>/i)[1]?.split(/<\/body>/i)[0] ?? html;
  const blocs: Bloc[] = [];
  const motif =
    /<h1>([\s\S]*?)<\/h1>|<h2>([\s\S]*?)<\/h2>|<p class="meta">([\s\S]*?)<\/p>|<p>([\s\S]*?)<\/p>|<table>([\s\S]*?)<\/table>/gi;
  for (const trouve of corps.matchAll(motif)) {
    if (trouve[1] !== undefined) blocs.push({ type: "h1", texte: textePlat(trouve[1]) });
    else if (trouve[2] !== undefined) blocs.push({ type: "h2", texte: textePlat(trouve[2]) });
    else if (trouve[3] !== undefined) blocs.push({ type: "meta", texte: textePlat(trouve[3]) });
    else if (trouve[4] !== undefined) blocs.push({ type: "p", texte: textePlat(trouve[4]) });
    else if (trouve[5] !== undefined) blocs.push({ type: "table", lignes: lireTableau(trouve[5]) });
  }
  return blocs;
}

function lireTableau(html: string): string[][] {
  const lignes: string[][] = [];
  for (const ligne of html.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
    const cellules = [...(ligne[1] ?? "").matchAll(/<t[hd]>([\s\S]*?)<\/t[hd]>/gi)].map((cellule) => textePlat(cellule[1] ?? ""));
    if (cellules.length > 0) lignes.push(cellules);
  }
  return lignes;
}

function textePlat(fragment: string): string {
  return fragment
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function echapper(valeur: string): string {
  return valeur.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function couper(texte: string, taille: number, max: number): string[] {
  const mots = texte.split(" ").filter((mot) => mot !== "");
  if (mots.length === 0) return [""];
  const lignes: string[] = [];
  let courante = "";
  const poser = (mot: string) => {
    if (largeur(mot, taille) <= max) return [mot];
    const parts: string[] = [];
    let buf = "";
    for (const caractere of mot) {
      const essai = buf + caractere;
      if (largeur(essai, taille) <= max) buf = essai;
      else {
        if (buf) parts.push(buf);
        buf = caractere;
      }
    }
    if (buf) parts.push(buf);
    return parts;
  };
  for (const mot of mots) {
    for (const morceau of poser(mot)) {
      const essai = courante ? `${courante} ${morceau}` : morceau;
      if (!courante || largeur(essai, taille) <= max) courante = essai;
      else {
        lignes.push(courante);
        courante = morceau;
      }
    }
  }
  if (courante) lignes.push(courante);
  return lignes;
}

function largeur(texte: string, taille: number): number {
  let total = 0;
  for (const caractere of texte) total += taille * (caractere === " " ? 0.28 : 0.5);
  return total;
}

function raccourci(texte: string, max: number): string {
  const points = [...texte];
  return points.length > max ? `${points.slice(0, max - 1).join("")}…` : texte;
}

function chaine(valeur: string): string {
  let sortie = "";
  for (const caractere of valeur) {
    const octet = octetDe(caractere);
    if (octet === null) continue;
    if (octet === 0x28 || octet === 0x29 || octet === 0x5c) sortie += `\\${String.fromCharCode(octet)}`;
    else if (octet < 0x20 || octet > 0x7e) sortie += `\\${octet.toString(8).padStart(3, "0")}`;
    else sortie += String.fromCharCode(octet);
  }
  return sortie;
}

function octetDe(caractere: string): number | null {
  const special = OCTETS[caractere];
  if (special !== undefined) return special;
  const code = caractere.codePointAt(0) ?? 0;
  if (code >= 0x20 && code <= 0x7e) return code;
  if (code >= 0xa0 && code <= 0xff) return code;
  return null;
}

function fixe(valeur: number): string {
  return valeur.toFixed(1);
}

function assembler(flux: string[]): Uint8Array {
  const pages = flux.length > 0 ? flux : [""];
  const police = 3 + pages.length * 2;
  const gras = police + 1;
  const objets = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  ];
  for (const [index, contenu] of pages.entries()) {
    const corps = contenu || "BT ET\n";
    objets.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${4 + index * 2} 0 R /Resources << /Font << /F1 ${police} 0 R /F2 ${gras} 0 R >> >> >>`,
    );
    objets.push(`<< /Length ${utf8(corps).length} >>\nstream\n${corps}\nendstream`);
  }
  objets.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objets.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  return assemblerPdf(objets);
}

function assemblerPdf(objets: string[]): Uint8Array {
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
