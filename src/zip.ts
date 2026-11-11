const TABLE = crcTable();

export function archiveZip(fichiers: readonly { nom: string; octets: Uint8Array }[]): Uint8Array {
  const locaux: Uint8Array[] = [];
  const centraux: Uint8Array[] = [];
  let offset = 0;
  for (const fichier of fichiers) {
    const nom = new TextEncoder().encode(fichier.nom);
    const crc = crc32(fichier.octets);
    const taille = fichier.octets.length;
    const local = entete(0x04034b50, 30 + nom.length, (vue) => {
      vue.setUint16(4, 20, true);
      vue.setUint16(6, 0x0800, true);
      vue.setUint32(14, crc, true);
      vue.setUint32(18, taille, true);
      vue.setUint32(22, taille, true);
      vue.setUint16(26, nom.length, true);
    }, nom);
    const central = entete(0x02014b50, 46 + nom.length, (vue) => {
      vue.setUint16(4, 20, true);
      vue.setUint16(6, 20, true);
      vue.setUint16(8, 0x0800, true);
      vue.setUint32(16, crc, true);
      vue.setUint32(20, taille, true);
      vue.setUint32(24, taille, true);
      vue.setUint16(28, nom.length, true);
      vue.setUint32(42, offset, true);
    }, nom);
    offset += local.length + taille;
    locaux.push(local, fichier.octets);
    centraux.push(central);
  }
  const debut = offset;
  const tailleCentraux = centraux.reduce((somme, bloc) => somme + bloc.length, 0);
  const fin = entete(0x06054b50, 22, (vue) => {
    vue.setUint16(8, fichiers.length, true);
    vue.setUint16(10, fichiers.length, true);
    vue.setUint32(12, tailleCentraux, true);
    vue.setUint32(16, debut, true);
  });
  return concatener([...locaux, ...centraux, fin]);
}

function entete(signature: number, taille: number, remplir: (vue: DataView) => void, nom?: Uint8Array): Uint8Array {
  const bloc = new Uint8Array(taille);
  const vue = new DataView(bloc.buffer);
  vue.setUint32(0, signature, true);
  remplir(vue);
  if (nom) bloc.set(nom, taille - nom.length);
  return bloc;
}

function concatener(blocs: readonly Uint8Array[]): Uint8Array {
  const total = blocs.reduce((somme, bloc) => somme + bloc.length, 0);
  const sortie = new Uint8Array(total);
  let curseur = 0;
  for (const bloc of blocs) {
    sortie.set(bloc, curseur);
    curseur += bloc.length;
  }
  return sortie;
}

function crc32(octets: Uint8Array): number {
  let crc = 0xffffffff;
  for (const octet of octets) crc = (crc >>> 8) ^ (TABLE[(crc ^ octet) & 0xff] ?? 0);
  return (crc ^ 0xffffffff) >>> 0;
}

function crcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
