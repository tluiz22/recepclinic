import { describe, expect, it } from "vitest";
import { defaultTemplate, fillTemplate, templatesInUse } from "./data/whatsapp/templates";
import { describeSendFailure } from "./whatsappErrors";

describe("motivo do envio que falhou (IS2, 03/nov/2026)", () => {
  it("131042: pagamento na Meta, com o guia", () => {
    const info = describeSendFailure(131042, "Business eligibility payment issue");
    expect(info.title).toMatch(/^Problema de pagamento na Meta/);
    expect(info.guide).toBe("/guia/pagamento-meta");
  });

  it("código desconhecido: o texto da Meta e o código", () => {
    expect(describeSendFailure(999, "Algo deu errado").title).toBe('A mensagem não saiu. A Meta respondeu: "Algo deu errado" (código 999).');
    expect(describeSendFailure(null, null).title).toBe("A mensagem não saiu.");
  });
});

describe("modelo da mensagem de teste", () => {
  it("texto aprovado pelo cliente, em toda clínica", () => {
    const test = defaultTemplate("connection_test")!;
    expect(test.name).toBe("rc_teste_envio_v1");
    expect(fillTemplate(test.body, test.examples)).toBe(
      "Olá, Ana! Aqui é da Clínica Sorriso.\nOs avisos de agendamento (lembretes, confirmações e remarcações) da clínica pelo WhatsApp estão ativos neste número.\n\nEsta é uma mensagem automática do RecepClinic. Não é preciso responder.",
    );
    expect(templatesInUse([]).map((t) => t.key)).toContain("connection_test");
  });
});
