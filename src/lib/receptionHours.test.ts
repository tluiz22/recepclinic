import { describe, expect, it } from "vitest";
import {
  describeReceptionHours,
  isReceptionOpen,
  nextReceptionOpening,
  suggestReceptionHours,
  validateReceptionHours,
  type ReceptionHours,
} from "./receptionHours";

const TZ = "America/Fortaleza";
const at = (iso: string) => new Date(`${iso}-03:00`);
const weekday = { open: "08:00", close: "18:00" };
// Seg a sex 8h–18h, sábado 8h–12h, domingo fechado.
const hours: ReceptionHours = [null, weekday, weekday, weekday, weekday, weekday, { open: "08:00", close: "12:00" }];
const none = new Set<string>();

describe("horário da recepção (F8.5b)", () => {
  it("sugestão pelas agendas: o primeiro e o último horário de cada dia", () => {
    const suggested = suggestReceptionHours([
      { weekday: 1, startTime: "08:00:00", endTime: "12:00:00" },
      { weekday: 1, startTime: "14:00:00", endTime: "18:30:00" },
      { weekday: 1, startTime: "07:30:00", endTime: "09:00:00" },
      { weekday: 3, startTime: "13:00:00", endTime: "17:00:00" },
    ]);
    expect(suggested).toEqual([null, { open: "07:30", close: "18:30" }, null, { open: "13:00", close: "17:00" }, null, null, null]);
  });

  it("validação por dia", () => {
    expect(validateReceptionHours(hours)).toEqual({});
    expect(validateReceptionHours([null, { open: "18:00", close: "08:00" }, { open: "", close: "12:00" }, null, null, null, null])).toEqual({
      1: "Segunda: o fechamento precisa ser depois da abertura.",
      2: "Terça: informe a abertura e o fechamento.",
    });
  });

  it("aberta: dentro do intervalo do dia; fecha na hora do fechamento", () => {
    // 2026-10-27 é terça.
    expect(isReceptionOpen(hours, at("2026-10-27T08:00:00"), TZ, none)).toBe(true);
    expect(isReceptionOpen(hours, at("2026-10-27T17:59:00"), TZ, none)).toBe(true);
    expect(isReceptionOpen(hours, at("2026-10-27T18:00:00"), TZ, none)).toBe(false);
    expect(isReceptionOpen(hours, at("2026-10-27T07:59:00"), TZ, none)).toBe(false);
    expect(isReceptionOpen(hours, at("2026-11-01T10:00:00"), TZ, none)).toBe(false);
  });

  it("feriado nacional e da clínica: fechada", () => {
    expect(isReceptionOpen(hours, at("2026-11-02T10:00:00"), TZ, none)).toBe(false);
    expect(isReceptionOpen(hours, at("2026-10-28T10:00:00"), TZ, new Set(["2026-10-28"]))).toBe(false);
  });

  it("próxima abertura: agora se aberta; senão o próximo dia de atendimento, pulando feriados", () => {
    expect(nextReceptionOpening(hours, at("2026-10-27T10:00:00"), TZ, none)).toEqual(at("2026-10-27T10:00:00"));
    expect(nextReceptionOpening(hours, at("2026-10-27T06:00:00"), TZ, none)).toEqual(at("2026-10-27T08:00:00"));
    expect(nextReceptionOpening(hours, at("2026-10-27T19:00:00"), TZ, none)).toEqual(at("2026-10-28T08:00:00"));
    // Sábado 13h → segunda 2/11 é Finados → terça 3/11.
    expect(nextReceptionOpening(hours, at("2026-10-31T13:00:00"), TZ, none)).toEqual(at("2026-11-03T08:00:00"));
    expect(nextReceptionOpening([null, null, null, null, null, null, null], at("2026-10-27T10:00:00"), TZ, none)).toBeNull();
  });

  it("resumo junta os dias seguidos iguais", () => {
    expect(describeReceptionHours(hours)).toBe("Seg a Sex 08:00–18:00 · Sáb 08:00–12:00");
    expect(describeReceptionHours([weekday, weekday, null, null, null, null, null])).toBe("Seg 08:00–18:00 · Dom 08:00–18:00");
    expect(describeReceptionHours([null, null, null, null, null, null, null])).toBe("Fechada todos os dias");
  });
});
