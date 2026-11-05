import { describe, expect, it } from "vitest";
import { isDueToReturn } from "./handoffReturn";

const at = (iso: string) => new Date(`2026-11-03T${iso}:00-03:00`);

describe("encerramento automático em 12 h (CA, cliente, 04/nov/2026)", () => {
  it("\"Em atendimento\": 12 h depois da última mensagem", () => {
    const item = { status: "in_progress" as const, lastActivityAt: at("08:00") };
    expect(isDueToReturn(item, at("19:59"))).toBe(false);
    expect(isDueToReturn(item, at("20:00"))).toBe(true);
  });

  it("\"Aguardando a clínica\" (o paciente espera resposta) nunca volta sozinha", () => {
    expect(isDueToReturn({ status: "waiting", lastActivityAt: at("08:00") }, new Date("2026-11-10T08:00:00-03:00"))).toBe(false);
  });
});
