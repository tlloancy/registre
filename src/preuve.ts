import { MOT_DE_PASSE_ALGO, MOT_DE_PASSE_ITERATIONS, deriver } from "./mot-de-passe.ts";

const PHRASE_PREUVE = "preuve du registre worker.";

export async function prouverPbkdf2(): Promise<void> {
  const empreinte = await deriver(PHRASE_PREUVE);
  if (empreinte.algo !== MOT_DE_PASSE_ALGO || empreinte.iterations !== MOT_DE_PASSE_ITERATIONS) {
    throw new Error("paramètres inattendus");
  }
}
