import { describe, expect, it } from "vitest";
import { archiveZip } from "./zip.ts";

describe("archive zip", () => {
  it("range le fichier sans le compresser", () => {
    const contenu = new TextEncoder().encode("Veille du 4 novembre");
    const archive = archiveZip([{ nom: "Veille légale.pdf", octets: contenu }]);
    expect(archive[0]).toBe(0x50);
    expect(archive[1]).toBe(0x4b);
    expect(new TextDecoder().decode(archive)).toContain("Veille légale.pdf");
    expect(new TextDecoder().decode(archive)).toContain("Veille du 4 novembre");
  });
});
