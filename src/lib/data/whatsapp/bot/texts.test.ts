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

  it("boas-vindas com e sem o nome, exame e recepção", () => {
    const full = t.leanWelcome("Ana", "da Clínica X");
    expect(full.startsWith("Olá, Ana! 👋\n\nEste é o contato oficial para agendamento da Clínica X.\n\n")).toBe(true);
    expect(full).toContain("consultas e exames.");
    expect(full).toContain("Falar diretamente com a recepção");
    expect(full.endsWith("\n\nEscolha uma das opções abaixo.")).toBe(true);
    expect(t.leanWelcome(null, "da Clínica X").startsWith("Olá! 👋")).toBe(true);
    const lean = t.leanWelcome(null, "da Clínica X", { exams: false, reception: false });
    expect(lean).toContain("consultas.");
    expect(lean).not.toContain("exames");
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
