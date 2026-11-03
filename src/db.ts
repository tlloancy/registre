export type RequeteLiee = {
  first<T>(): Promise<T | null>;
};

export type Preparer = {
  prepare(requete: string): {
    bind(...valeurs: unknown[]): RequeteLiee;
  };
};

export async function lireHashMotDePasse(db: Preparer): Promise<string | null> {
  const ligne = await db
    .prepare("SELECT mot_de_passe_hash FROM reglages WHERE id = ?")
    .bind(1)
    .first<{ mot_de_passe_hash: string | null }>();
  if (!ligne) return null;
  if (ligne.mot_de_passe_hash === null || ligne.mot_de_passe_hash === "") return null;
  return ligne.mot_de_passe_hash;
}
