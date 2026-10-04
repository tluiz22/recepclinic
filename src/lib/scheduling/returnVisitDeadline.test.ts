import { describe, expect, it } from "vitest";
import { computeReturnVisitLastDate } from "./returnVisitDeadline";

describe("computeReturnVisitLastDate", () => {
  it("soma o prazo ao dia da consulta de origem", () => {
    expect(computeReturnVisitLastDate("2026-10-14T13:00:00Z", 30)).toBe("2026-11-13");
  });

  it("usa o dia de Fortaleza: 23h de 14/10 em Fortaleza ainda é dia 14", () => {
    expect(computeReturnVisitLastDate("2026-10-15T02:00:00Z", 30)).toBe("2026-11-13");
  });

  it("atravessa a virada do ano", () => {
    expect(computeReturnVisitLastDate("2026-12-10T13:00:00Z", 30)).toBe("2027-01-09");
  });

  it("prazo zero é o próprio dia da consulta", () => {
    expect(computeReturnVisitLastDate("2026-10-14T13:00:00Z", 0)).toBe("2026-10-14");
  });
});
