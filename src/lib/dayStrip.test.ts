import { describe, expect, it } from "vitest";
import { buildDayStrip, periodOf } from "./dayStrip";

const dates = ["2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-11-03"];

describe("buildDayStrip", () => {
  it("sem dia pedido, começa no primeiro dia livre", () => {
    const strip = buildDayStrip(dates, null, null);
    expect(strip.selected).toBe("2026-10-16");
    expect(strip.days).toEqual(dates.slice(0, 7));
    expect(strip.unavailable).toBeNull();
    expect(strip.prevStart).toBeNull();
    expect(strip.nextStart).toBe("2026-10-27");
  });

  it("vindo de um dia da Agenda com vaga, começa nele (U-09)", () => {
    const strip = buildDayStrip(dates, "2026-10-23", null);
    expect(strip.selected).toBe("2026-10-23");
    expect(strip.days[0]).toBe("2026-10-23");
    expect(strip.unavailable).toBeNull();
    expect(strip.prevStart).toBe("2026-10-16");
    expect(strip.nextStart).toBeNull();
  });

  it("dia pedido sem vaga: avisa e escolhe o primeiro dia livre depois dele", () => {
    const strip = buildDayStrip(dates, "2026-10-24", null);
    expect(strip.unavailable).toBe("2026-10-24");
    expect(strip.selected).toBe("2026-10-26");
    expect(strip.days[0]).toBe("2026-10-26");
  });

  it("sem dia livre depois do pedido: nada escolhido", () => {
    const strip = buildDayStrip(dates, "2026-11-10", null);
    expect(strip).toEqual({ days: [], selected: "", unavailable: "2026-11-10", prevStart: null, nextStart: null });
  });

  it("um dia da faixa mantém o começo da faixa", () => {
    const strip = buildDayStrip(dates, "2026-10-21", "2026-10-16");
    expect(strip.selected).toBe("2026-10-21");
    expect(strip.days[0]).toBe("2026-10-16");
  });

  it("o escolhido fora da faixa pedida volta a ficar à vista", () => {
    const strip = buildDayStrip(dates, "2026-11-03", "2026-10-16");
    expect(strip.days[0]).toBe("2026-11-03");
  });

  it("sem dias livres, faixa vazia", () => {
    expect(buildDayStrip([], null, null).days).toEqual([]);
  });
});

describe("periodOf", () => {
  it("separa manhã, tarde e noite", () => {
    expect(["07:30", "11:59", "12:00", "17:40", "18:00"].map(periodOf)).toEqual(["Manhã", "Manhã", "Tarde", "Tarde", "Noite"]);
  });
});
