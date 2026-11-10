export type CourrierSortant = {
  expediteur: { nom: string; email: string };
  destinataire: { nom: string; email: string };
  copie: { nom: string; email: string } | null;
  sujet: string;
  texte: string;
  pieces: { nom: string; octets: Uint8Array }[];
};

export async function envoyerBrevo(cle: string, courrier: CourrierSortant): Promise<boolean> {
  const corps: Record<string, unknown> = {
    sender: { name: courrier.expediteur.nom, email: courrier.expediteur.email },
    to: [{ email: courrier.destinataire.email, name: courrier.destinataire.nom }],
    subject: courrier.sujet,
    textContent: courrier.texte,
    attachment: courrier.pieces.map((piece) => ({ name: piece.nom, content: base64(piece.octets) })),
  };
  if (courrier.copie) corps.cc = [{ email: courrier.copie.email, name: courrier.copie.nom }];
  try {
    const reponse = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": cle,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(corps),
    });
    return reponse.ok;
  } catch {
    return false;
  }
}

function base64(octets: Uint8Array): string {
  let binaire = "";
  const pas = 0x8000;
  for (let index = 0; index < octets.length; index += pas) {
    binaire += String.fromCharCode(...octets.subarray(index, index + pas));
  }
  return btoa(binaire);
}
