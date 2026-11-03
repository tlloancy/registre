import { repondre, type Env } from "./worker.ts";

export default {
  fetch(requete: Request, env: Env): Promise<Response> {
    return repondre(requete, env);
  },
};
