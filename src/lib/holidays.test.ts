import { describe, expect, it } from "vitest";
import { isNationalHoliday } from "./holidays";

describe("isNationalHoliday", () => {
  it.each([
    ["2026-01-01", "Confraternização Universal"],
    ["2026-04-21", "Tiradentes"],
    ["2026-05-01", "Dia do Trabalho"],
    ["2026-09-07", "Independência"],
    ["2026-10-12", "Nossa Senhora Aparecida"],
    ["2026-11-02", "Finados"],
    ["2026-11-15", "Proclamação da República"],
    ["2026-11-20", "Consciência Negra"],
    ["2026-12-25", "Natal"],
  ])("feriado fixo: %s (%s)", (date) => {
    expect(isNationalHoliday(date)).toBe(true);
  });

  // Páscoa: 20/04/2025, 05/04/2026, 28/03/2027.
  it.each([
    ["2025-03-03", "2025-03-04", "2025-03-05", "2025-04-18", "2025-06-19"],
    ["2026-02-16", "2026-02-17", "2026-02-18", "2026-04-03", "2026-06-04"],
    ["2027-02-08", "2027-02-09", "2027-02-10", "2027-03-26", "2027-05-27"],
  ])(
    "feriados móveis (Carnaval seg/ter, Cinzas, Sexta-feira Santa, Corpus Christi): %s…",
    (...dates) => {
      for (const date of dates) expect(isNationalHoliday(date), date).toBe(true);
    },
  );

  it("o Domingo de Páscoa em si não está na lista", () => {
    expect(isNationalHoliday("2026-04-05")).toBe(false);
  });

  it.each(["2026-02-15", "2026-02-19", "2026-04-02", "2026-06-05", "2026-10-14", "2026-12-24", "2026-12-31"])(
    "dia comum: %s",
    (date) => {
      expect(isNationalHoliday(date)).toBe(false);
    },
  );
});
