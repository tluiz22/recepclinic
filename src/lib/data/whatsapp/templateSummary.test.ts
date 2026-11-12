import { describe, expect, it } from "vitest";
import { supportSummary } from "./templateSummary";

describe("mensagem do Suporte sobre os templates", () => {
  it("só os pendentes, os não enviados primeiro, com o motivo da Meta; os aprovados só contados", () => {
    const text = supportSummary("Templates enviados à Meta", [
      { key: "reminder", name: "rc_lembrete_v1", status: "approved", problem: null },
      { key: "confirmation", name: "rc_confirmacao_v1", status: "pending", problem: null },
      { key: "portal_code", name: "rc_codigo_portal_v1", status: null, problem: "Parâmetro inválido" },
    ] as never);
    expect(text).toBe(
      "Templates enviados à Meta. Pendentes: rc_codigo_portal_v1: não enviado (a Meta respondeu: Parâmetro inválido) · rc_confirmacao_v1: em análise. O outro está aprovado.",
    );
  });

  it("todos aprovados e lista vazia", () => {
    expect(supportSummary("Situação atualizada", [{ key: "reminder", name: "rc_lembrete_v1", status: "approved", problem: null }] as never)).toBe("Situação atualizada. Todos aprovados (1).");
    expect(supportSummary("Situação atualizada", [])).toBe('Nenhum template cadastrado ainda: use "Criar na Meta".');
  });
});
