import { describe, expect, it } from "vitest";
import { canSendFreeText, isDueToReturn } from "./handoffReturn";

const at = (iso: string) => new Date(`2026-11-03T${iso}:00-03:00`);

describe("volta ao bot 12 h depois da resposta da clínica (C20)", () => {
  it("só 'Em atendimento', 12 h depois da última resposta da clínica", () => {
    const answered = { status: "in_progress" as const, lastAgentAt: at("08:00") };
    expect(isDueToReturn(answered, at("19:59"))).toBe(false);
    expect(isDueToReturn(answered, at("20:00"))).toBe(true);
    // Paciente esperando resposta: continua com a clínica.
    expect(isDueToReturn({ status: "waiting", lastAgentAt: at("08:00") }, at("23:00"))).toBe(false);
    expect(isDueToReturn({ status: "waiting", lastAgentAt: null }, at("23:00"))).toBe(false);
  });

  it("mensagem sem template só até 24 h depois da última mensagem do paciente", () => {
    const now = new Date("2026-11-04T10:00:00-03:00");
    expect(canSendFreeText(new Date("2026-11-03T10:00:01-03:00"), now)).toBe(true);
    expect(canSendFreeText(new Date("2026-11-03T10:00:00-03:00"), now)).toBe(false);
    expect(canSendFreeText(null, now)).toBe(false);
  });
});
