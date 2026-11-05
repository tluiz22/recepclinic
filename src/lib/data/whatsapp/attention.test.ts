import { describe, expect, it } from "vitest";
import { handoffReasonLabel } from "./attention";

// A situação (Aguardando a clínica, Em atendimento) fica guardada na conversa desde o CA
// (cliente, 04/nov/2026): as transições estão em tests/db/ciclo-atendimento-humano.test.ts.

describe("atendimento humano (F8.5a)", () => {
  it("motivo na tela, com o de pausas antigas sem motivo", () => {
    expect(handoffReasonLabel("requested")).toBe("Pediu para falar com a clínica");
    expect(handoffReasonLabel("no_availability")).toBe("O bot não encontrou horário livre");
    expect(handoffReasonLabel(null)).toBe("Atendimento pela clínica");
  });
});
