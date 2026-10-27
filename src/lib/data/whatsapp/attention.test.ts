import { describe, expect, it } from "vitest";
import { classifyAttention, handoffReasonLabel } from "./attention";

const at = (hhmm: string) => new Date(`2026-10-27T${hhmm}:00Z`);

describe("atendimento humano (F8.5a)", () => {
  it("sem resposta da clínica: aguardando desde o início da pausa", () => {
    expect(classifyAttention(at("14:00"), [at("13:59")], [])).toEqual({ status: "waiting", waitingSince: at("14:00"), lastAgentAt: null });
  });

  it("a clínica respondeu e o paciente não escreveu depois: em atendimento", () => {
    expect(classifyAttention(at("14:00"), [at("13:59")], [at("14:05")])).toEqual({ status: "in_progress", waitingSince: null, lastAgentAt: at("14:05") });
  });

  it("o paciente escreveu depois da resposta: aguardando desde a primeira mensagem sem resposta", () => {
    expect(classifyAttention(at("14:00"), [at("14:10"), at("14:20")], [at("14:05")])).toEqual({
      status: "waiting",
      waitingSince: at("14:10"),
      lastAgentAt: at("14:05"),
    });
  });

  it("resposta da clínica antes da pausa atual não conta", () => {
    expect(classifyAttention(at("14:00"), [], [at("10:00")]).status).toBe("waiting");
  });

  it("a recepção assumiu pelo app: começa em atendimento", () => {
    expect(classifyAttention(at("14:00"), [at("13:58")], [at("14:00")]).status).toBe("in_progress");
  });

  it("motivo na tela, com o de pausas antigas sem motivo", () => {
    expect(handoffReasonLabel("requested")).toBe("Pediu para falar com a clínica");
    expect(handoffReasonLabel("no_availability")).toBe("O bot não encontrou horário livre");
    expect(handoffReasonLabel(null)).toBe("Atendimento pela clínica");
  });
});
