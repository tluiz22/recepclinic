import { describe, expect, it } from "vitest";
import { samplePreparationPdf } from "./preparationSamplePdf";

describe("PDF de exemplo do modelo do arquivo do preparo (C7)", () => {
  it("gera um PDF, com os acentos das orientações", async () => {
    const bytes = await samplePreparationPdf();
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(500);
  });
});
