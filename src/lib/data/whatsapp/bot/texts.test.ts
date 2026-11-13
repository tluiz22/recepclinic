import { describe, expect, it } from "vitest";
import { describeReceptionHoursForPatient } from "../../../receptionHours";
import * as t from "./texts";

// Bot enxuto (F3f, seção 15.6; canvas aprovado pelo cliente em 11/nov/2026).
describe("menu enxuto (BE-2)", () => {
  it("as quatro opções com emoji, nos limites da Meta (título até 24, descrição até 72)", () => {
    expect(t.LEAN_MENU.map((item) => item.label)).toEqual(["📅 Agendar", "🗓 Minhas consultas", "👥 Profissionais", "🎧 Falar com a recepção"]);
    for (const item of t.LEAN_MENU) {
      expect([...item.label].length).toBeLessThanOrEqual(24);
      expect(item.description.length).toBeLessThanOrEqual(72);
    }
    expect(t.LIST_BUTTON).toBe("Ver opções");
  });

  it("boas-vindas (cliente, 13/nov/2026): saudação, pergunta e as opções; exame e recepção conforme a clínica", () => {
    expect(t.leanWelcome("Ana")).toBe(
      [
        "Olá, Ana! 👋 Seja bem-vindo(a)!",
        "Como podemos ajudar você hoje?",
        "📅 Agendar — Consulta, retorno ou exame",
        "🗓 Minhas consultas — Consultar, remarcar ou cancelar",
        "👥 Profissionais — Especialidades, valores e convênios",
        "🎧 Falar com a recepção — Atendimento com nossa equipe",
      ].join("\n\n"),
    );
    expect(t.leanWelcome(null).startsWith("Olá! 👋 Seja bem-vindo(a)!\n\n")).toBe(true);
    const lean = t.leanWelcome(null, { exams: false, reception: false });
    expect(lean).toContain("📅 Agendar — Consulta ou retorno");
    expect(lean).not.toContain("exame");
    expect(lean).not.toContain("recepção");
  });
});

describe("links (BE-3) e recepção (BE-4)", () => {
  it("botões do link até 20 caracteres", () => {
    for (const link of Object.values(t.LEAN_LINKS)) expect(link.button.length).toBeLessThanOrEqual(20);
    expect(t.REMINDER_RESCHEDULE_BUTTON.length).toBeLessThanOrEqual(20);
    expect(t.REMINDER_CANCEL_BUTTON.length).toBeLessThanOrEqual(20);
  });

  it("horário da recepção para o paciente: dias seguidos juntos, horas sem os zeros", () => {
    const day = { open: "08:00", close: "18:00" };
    expect(describeReceptionHoursForPatient([null, day, day, day, day, day, null])).toBe("seg. a sex., 8h às 18h");
    expect(describeReceptionHoursForPatient([null, day, day, day, day, day, { open: "08:00", close: "12:30" }])).toBe("seg. a sex., 8h às 18h; sáb., 8h às 12h30");
    expect(describeReceptionHoursForPatient([null, null, null, null, null, null, null])).toBe("");
    expect(t.leanOutsideHours("seg. a sex., 8h às 18h")).toBe("A recepção atende de seg. a sex., 8h às 18h, e responde assim que abrir.");
  });
});
