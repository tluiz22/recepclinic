import { describe, expect, it } from "vitest";
import { nextFreeDays } from "./nextFree";

const at = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`);
const gap = (agendaId: string, date: string, time: string, places = ["clinic"], group?: unknown) => ({
  agendaId,
  date,
  time,
  start: at(date, time),
  end: new Date(at(date, time).getTime() + 30 * 60_000),
  places,
  group,
});

describe("nextFreeDays", () => {
  const gaps = [
    gap("a", "2026-11-11", "09:00"),
    gap("a", "2026-11-10", "14:00"),
    gap("a", "2026-11-10", "14:30"),
    gap("a", "2026-11-12", "08:00"),
    gap("b", "2026-11-11", "08:30", ["home_visit"]),
    gap("b", "2026-11-11", "07:00", ["clinic"], { serviceId: "t" }),
  ];

  it("traz os 2 primeiros dias com vaga, em ordem", () => {
    const [a] = nextFreeDays(["a"], gaps, []);
    expect(a.days).toEqual([
      { date: "2026-11-10", slots: [{ time: "14:00", held: false }, { time: "14:30", held: false }] },
      { date: "2026-11-11", slots: [{ time: "09:00", held: false }] },
    ]);
    expect(a.first).toEqual(at("2026-11-10", "14:00"));
  });

  it("horário em reserva aparece apagado; dia só com reserva não conta", () => {
    const holds = [
      { agendaId: "a", start: at("2026-11-10", "14:00"), end: at("2026-11-10", "14:30") },
      { agendaId: "a", start: at("2026-11-11", "09:00"), end: at("2026-11-11", "09:30") },
    ];
    const [a] = nextFreeDays(["a"], gaps, holds);
    expect(a.days.map((d) => d.date)).toEqual(["2026-11-10", "2026-11-12"]);
    expect(a.days[0].slots).toEqual([
      { time: "14:00", held: true },
      { time: "14:30", held: false },
    ]);
    expect(a.first).toEqual(at("2026-11-10", "14:30"));
  });

  it("filtra pelo local e deixa a turma de fora", () => {
    expect(nextFreeDays(["b"], gaps, [], { place: "clinic" })[0].days).toEqual([]);
    expect(nextFreeDays(["b"], gaps, [], { place: "home_visit" })[0].days).toEqual([{ date: "2026-11-11", slots: [{ time: "08:30", held: false }] }]);
  });
});
