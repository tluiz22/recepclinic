import { describe, expect, it } from "vitest";
import { dayFree, freeText, occupancyCell, occupancyPercent, type OccupancyGap } from "./weekOccupancy";

const A = "agenda-a";
const at = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`);
const gap = (date: string, time: string, extra: Partial<OccupancyGap> = {}): OccupancyGap => ({
  agendaId: A,
  date,
  start: at(date, time),
  end: new Date(at(date, time).getTime() + 30 * 60_000),
  ...extra,
});
const base = { holds: [], appointments: [], holidays: new Set<string>(), today: "2026-11-11", now: at("2026-11-11", "10:00") };

describe("occupancyCell", () => {
  it("marcados de abertos, com os livres", () => {
    const cell = occupancyCell(A, "2026-11-12", {
      ...base,
      gaps: [gap("2026-11-12", "09:00"), gap("2026-11-12", "09:30")],
      appointments: [
        { agendaId: A, date: "2026-11-12", status: "confirmed" },
        { agendaId: A, date: "2026-11-12", status: "scheduled" },
        { agendaId: A, date: "2026-11-12", status: "canceled" },
        { agendaId: "outra", date: "2026-11-12", status: "confirmed" },
      ],
    });
    expect(cell).toEqual({ kind: "open", booked: 2, total: 4, free: 2, past: false });
    expect(occupancyPercent(cell)).toBe(50);
    expect(freeText(cell)).toBe("2 livres");
  });

  it("hoje: o horário que já passou fica no total e sai dos livres", () => {
    const cell = occupancyCell(A, "2026-11-11", { ...base, gaps: [gap("2026-11-11", "08:00"), gap("2026-11-11", "14:00")] });
    expect(cell).toEqual({ kind: "open", booked: 0, total: 2, free: 1, past: false });
    expect(freeText(cell)).toBe("1 livre");
  });

  it("reserva do portal não conta como livre", () => {
    const cell = occupancyCell(A, "2026-11-12", {
      ...base,
      gaps: [gap("2026-11-12", "09:00")],
      holds: [{ agendaId: A, start: at("2026-11-12", "09:00"), end: at("2026-11-12", "09:30") }],
    });
    expect(cell).toMatchObject({ total: 1, free: 0 });
    expect(freeText(cell)).toBe("0 livres");
  });

  it("tudo marcado: Cheio", () => {
    const cell = occupancyCell(A, "2026-11-12", { ...base, gaps: [], appointments: [{ agendaId: A, date: "2026-11-12", status: "confirmed" }] });
    expect(cell).toEqual({ kind: "open", booked: 1, total: 1, free: 0, past: false });
    expect(occupancyPercent(cell)).toBe(100);
    expect(freeText(cell)).toBe("Cheio");
  });

  it("dia que passou não mostra livres", () => {
    const cell = occupancyCell(A, "2026-11-10", { ...base, gaps: [gap("2026-11-10", "09:00")], appointments: [{ agendaId: A, date: "2026-11-10", status: "attended" }] });
    expect(cell).toMatchObject({ booked: 1, total: 2, past: true });
    expect(freeText(cell)).toBe("");
  });

  it("turma fica de fora; sem horário nem marcado: sem atendimento", () => {
    expect(occupancyCell(A, "2026-11-12", { ...base, gaps: [gap("2026-11-12", "09:00", { group: {} })] })).toEqual({ kind: "closed" });
  });

  it("feriado sem marcados: Feriado; com marcado, mostra a ocupação", () => {
    const holidays = new Set(["2026-11-15"]);
    expect(occupancyCell(A, "2026-11-15", { ...base, holidays, gaps: [] })).toEqual({ kind: "holiday" });
    expect(occupancyCell(A, "2026-11-15", { ...base, holidays, gaps: [], appointments: [{ agendaId: A, date: "2026-11-15", status: "confirmed" }] })).toMatchObject({
      kind: "open",
      booked: 1,
    });
  });
});

describe("dayFree", () => {
  it("soma os livres das agendas que atendem", () => {
    expect(
      dayFree([
        { kind: "open", booked: 1, total: 4, free: 3, past: false },
        { kind: "closed" },
        { kind: "open", booked: 0, total: 2, free: 2, past: false },
      ]),
    ).toEqual({ free: 5, holiday: false });
  });

  it("ninguém atende: null; feriado: holiday", () => {
    expect(dayFree([{ kind: "closed" }])).toBeNull();
    expect(dayFree([{ kind: "holiday" }, { kind: "closed" }])).toEqual({ free: 0, holiday: true });
  });
});
