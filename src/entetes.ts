export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export const HSTS = "max-age=604800";

export function reponse(statut: number, corps: string): Response {
  return new Response(corps, {
    status: statut,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Strict-Transport-Security": HSTS,
    },
  });
}
