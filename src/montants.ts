export function afficherEuros(centimes: number): string {
  const absolu = Math.abs(centimes);
  const entier = Math.trunc(absolu / 100);
  const decimale = String(absolu % 100).padStart(2, "0");
  const signe = centimes < 0 ? "-" : "";
  return `${signe}${entier.toLocaleString("fr-FR")},${decimale} €`;
}

export function afficherTaux(bp: number): string {
  const entier = Math.trunc(bp / 100);
  const decimale = bp % 100;
  if (decimale === 0) return `${entier} %`;
  const texte = String(decimale).padStart(2, "0").replace(/0$/, "");
  return `${entier},${texte} %`;
}

export function afficherJour(iso: string): string {
  const parties = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!parties) return iso;
  return `${parties[3]}/${parties[2]}/${parties[1]}`;
}

export function tvaCentimes(htCentimes: number, tauxBp: number): number {
  return Math.trunc((htCentimes * tauxBp + 5000) / 10000);
}

export function numeroDevis(annee: number, numero: number): string {
  return `D${String(annee).slice(2)}${String(numero).padStart(5, "0")}`;
}
