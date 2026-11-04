import { describe, expect, it } from "vitest";
import { texteHtml } from "./organisme.ts";

describe("texte des CGV", () => {
  it("garde les articles et retire les scripts", () => {
    const html = `<style>secret {}</style><h1>Conditions Générales de Vente (CGV)</h1><script>secret()</script><p>Article 7 : Accessibilité et Handicap</p>`;
    const texte = texteHtml(html);
    expect(texte).toContain("Conditions Générales de Vente");
    expect(texte).toContain("Accessibilité et Handicap");
    expect(texte).not.toContain("secret");
  });
});
