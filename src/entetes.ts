export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export const HSTS = "max-age=604800";

export function entetes(type: string): Headers {
  return new Headers({
    "Content-Type": type,
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": HSTS,
    "Cache-Control": "no-store",
  });
}

export function reponse(statut: number, corps: string, cookies: readonly string[] = []): Response {
  return avecCookies(new Response(corps, { status: statut, headers: entetes("text/plain; charset=utf-8") }), cookies);
}

export function reponseHtml(statut: number, corps: string, cookies: readonly string[] = []): Response {
  return avecCookies(new Response(corps, { status: statut, headers: entetes("text/html; charset=utf-8") }), cookies);
}

export function reponseOctets(
  corps: Uint8Array,
  type: string,
  nom: string,
  disposition: "inline" | "attachment" = "attachment",
): Response {
  const headers = entetes(type);
  headers.set("Content-Disposition", `${disposition}; filename="${nom}"`);
  return new Response(corps, { status: 200, headers });
}

export function redirection(cible: string, cookies: readonly string[] = []): Response {
  const headers = entetes("text/plain; charset=utf-8");
  headers.set("Location", cible);
  return avecCookies(new Response(null, { status: 303, headers }), cookies);
}

function avecCookies(reponse: Response, cookies: readonly string[]): Response {
  for (const cookie of cookies) reponse.headers.append("Set-Cookie", cookie);
  return reponse;
}
