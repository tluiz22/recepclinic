import { describe, expect, it } from "vitest";
import { parseResendOutcome, reminderCutoff } from "./reminderResend";
import { parsePreparationResendOutcome } from "./preparationResend";

describe("reminderCutoff", () => {
  it("é a hora do lembrete na véspera do atendimento, em Fortaleza", () => {
    // Atendimento 15/10 às 10h, lembrete às 9h → 14/10 às 9h de Fortaleza.
    expect(reminderCutoff(new Date("2026-10-15T13:00:00Z"), 9).toISOString()).toBe("2026-10-14T12:00:00.000Z");
  });

  it("atendimento às 23h de Fortaleza usa o dia de Fortaleza, não o UTC", () => {
    expect(reminderCutoff(new Date("2026-10-15T02:00:00Z"), 9).toISOString()).toBe("2026-10-13T12:00:00.000Z");
  });

  it("atendimento no dia 1º: véspera no mês anterior", () => {
    expect(reminderCutoff(new Date("2026-11-01T13:00:00Z"), 18).toISOString()).toBe("2026-10-31T21:00:00.000Z");
  });
});

describe("parseResendOutcome e parsePreparationResendOutcome", () => {
  it.each(["sent", "failed", "no_template", "no_phone", "not_eligible"])("aceita o código conhecido %s", (code) => {
    expect(parseResendOutcome(code)).toBe(code);
    expect(parsePreparationResendOutcome(code)).toBe(code);
  });

  it.each([null, "", "enviado", "SENT"])("recusa ausente ou desconhecido: %s", (value) => {
    expect(parseResendOutcome(value)).toBeNull();
    expect(parsePreparationResendOutcome(value)).toBeNull();
  });

  // Achado 4 da F1, corrigido na F3.9b: nomes herdados de Object não são códigos.
  it.each(["toString", "constructor", "__proto__", "hasOwnProperty"])("recusa o nome herdado %s", (value) => {
    expect(parseResendOutcome(value)).toBeNull();
    expect(parsePreparationResendOutcome(value)).toBeNull();
  });
});
