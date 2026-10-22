import { describe, expect, it } from "vitest";
import {
  buckets,
  compareCounts,
  compareRates,
  comparisonRange,
  daysIn,
  defaultGrouping,
  describeComparison,
  formatRate,
  formatRatio,
  ratio,
  sumByBucket,
} from "./metricsRules";

describe("taxa com base mínima (decisão 9)", () => {
  it("base zero: sem taxa, nunca 0%", () => {
    expect(ratio(0, 0)).toEqual({ n: 0, base: 0, rate: null, enough: false });
    expect(formatRatio(ratio(0, 0))).toBe("—");
  });
  it("abaixo de 20: X de Y", () => {
    expect(formatRatio(ratio(11, 12))).toBe("11 de 12");
  });
  it("20 ou mais: porcentagem", () => {
    expect(formatRatio(ratio(412, 468))).toBe("88%");
    expect(formatRate(41 / 540)).toBe("7,6%");
    expect(formatRate(0)).toBe("0%");
  });
});

describe("comparação com o mesmo período do mês anterior (decisão 8)", () => {
  it("1 a 22/out → 1 a 22/set", () => {
    expect(comparisonRange({ from: "2026-10-01", to: "2026-10-22" })).toEqual({ from: "2026-09-01", to: "2026-09-22" });
    expect(describeComparison({ from: "2026-09-01", to: "2026-09-22" })).toBe("1 a 22/set (mesmos 22 dias)");
  });
  it("dia que não existe no mês anterior: o último dele, com a mesma quantidade de dias", () => {
    const prev = comparisonRange({ from: "2026-03-31", to: "2026-03-31" });
    expect(prev).toEqual({ from: "2026-02-28", to: "2026-02-28" });
    expect(describeComparison(prev)).toBe("28/fev (mesmo dia)");
    expect(daysIn(comparisonRange({ from: "2026-10-01", to: "2026-10-31" }))).toBe(31);
  });
  it("virada do ano", () => {
    expect(comparisonRange({ from: "2027-01-01", to: "2027-01-07" })).toEqual({ from: "2026-12-01", to: "2026-12-07" });
  });
  it("quantidades: % só com as duas bases ≥ 20", () => {
    expect(compareCounts(312, 289)).toMatchObject({ diff: 23, direction: "up" });
    expect(compareCounts(312, 289).pct).toBeCloseTo(0.0796, 3);
    expect(compareCounts(4, 2)).toEqual({ previous: 2, diff: 2, pct: null, direction: "up" });
    expect(compareCounts(5, 5).direction).toBe("flat");
  });
  it("taxas: pontos só com as duas bases ≥ 20", () => {
    expect(compareRates(ratio(298, 405), ratio(69, 100)).points).toBeCloseTo(4.58, 1);
    expect(compareRates(ratio(9, 10), ratio(69, 100))).toMatchObject({ points: null, direction: "flat" });
    expect(compareRates(ratio(88, 100), ratio(87.5, 100)).direction).toBe("flat");
  });
});

describe("dias e semanas", () => {
  it("até 14 dias, por dia; acima, por semana", () => {
    expect(defaultGrouping({ from: "2026-10-01", to: "2026-10-14" })).toBe("day");
    expect(defaultGrouping({ from: "2026-10-01", to: "2026-10-15" })).toBe("week");
  });
  it("semanas de segunda a domingo, cortadas no período, com a semana em curso", () => {
    // 01/10/2026 é quinta.
    const list = buckets({ from: "2026-10-01", to: "2026-10-22" }, "week", "2026-10-22");
    expect(list.map((b) => [b.from, b.to, b.label, b.partial])).toEqual([
      ["2026-10-01", "2026-10-04", "1 a 04/10", false],
      ["2026-10-05", "2026-10-11", "5 a 11/10", false],
      ["2026-10-12", "2026-10-18", "12 a 18/10", false],
      ["2026-10-19", "2026-10-22", "19 a 22/10", true],
    ]);
  });
  it("soma as linhas diárias em cada faixa", () => {
    const list = buckets({ from: "2026-10-01", to: "2026-10-03" }, "day", "2026-10-22");
    const rows = [
      { day: "2026-10-01", a: 2 },
      { day: "2026-10-03", a: 5 },
      { day: "2026-10-03", a: 1 },
    ];
    expect(sumByBucket(rows, list, ["a"])).toEqual([{ a: 2 }, { a: 0 }, { a: 6 }]);
  });
});
