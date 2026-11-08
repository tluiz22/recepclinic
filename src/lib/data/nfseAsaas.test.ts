import { describe, expect, it } from "vitest";
import { invoiceDescription } from "./nfseAsaas";

describe("descrição da nota (N3b)", () => {
  it("segue o modelo aprovado pelo cliente (30/out)", () => {
    expect(invoiceDescription("Consulta", "Ana Souza", "2026-11-05")).toBe("Consulta. Paciente: Ana Souza. Atendimento em 05/11/2026.");
    expect(invoiceDescription("Consulta pediátrica.", " Ana ", "2026-01-31")).toBe("Consulta pediátrica. Paciente: Ana. Atendimento em 31/01/2026.");
  });
});
