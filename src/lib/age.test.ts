import { describe, expect, it } from "vitest";
import { ADULT_AGE_YEARS, ageInYears, formatAge, isAdult, isOverConsultationAgeLimit } from "./age";

describe("ageInYears", () => {
  it("conta anos completos", () => {
    expect(ageInYears("2010-06-15", "2026-10-04")).toBe(16);
  });

  it("no dia do aniversário já conta o ano novo", () => {
    expect(ageInYears("2010-10-04", "2026-10-04")).toBe(16);
  });

  it("na véspera do aniversário ainda não conta", () => {
    expect(ageInYears("2010-10-05", "2026-10-04")).toBe(15);
  });

  it("mês do aniversário ainda não chegou", () => {
    expect(ageInYears("2010-12-01", "2026-10-04")).toBe(15);
  });

  it("nascido em 29/02: em ano não bissexto, faz aniversário em 01/03", () => {
    expect(ageInYears("2008-02-29", "2026-02-28")).toBe(17);
    expect(ageInYears("2008-02-29", "2026-03-01")).toBe(18);
  });

  it("nascido hoje tem 0 anos", () => {
    expect(ageInYears("2026-10-04", "2026-10-04")).toBe(0);
  });
});

describe("isAdult", () => {
  it("maioridade é 18 anos", () => {
    expect(ADULT_AGE_YEARS).toBe(18);
  });

  it("vira adulto no dia em que faz 18", () => {
    expect(isAdult("2008-10-04", "2026-10-04")).toBe(true);
    expect(isAdult("2008-10-05", "2026-10-04")).toBe(false);
  });
});

describe("isOverConsultationAgeLimit", () => {
  it("com limite 14, 13 anos e 11 meses ainda pode marcar consulta", () => {
    expect(isOverConsultationAgeLimit("2012-11-04", "2026-10-04", 14)).toBe(false);
  });

  it("no dia em que faz 14 não pode mais", () => {
    expect(isOverConsultationAgeLimit("2012-10-04", "2026-10-04", 14)).toBe(true);
  });

  it("acima do limite não pode", () => {
    expect(isOverConsultationAgeLimit("2000-01-01", "2026-10-04", 14)).toBe(true);
  });

  it("respeita o limite configurado", () => {
    expect(isOverConsultationAgeLimit("2012-10-04", "2026-10-04", 18)).toBe(false);
  });
});

describe("formatAge", () => {
  it.each([
    ["2026-10-04", "0 dias"],
    ["2026-10-03", "1 dia"],
    ["2026-09-20", "14 dias"],
    ["2026-09-04", "1 mês"],
    ["2026-01-04", "9 meses"],
    ["2025-10-05", "11 meses"],
    ["2025-10-04", "1 ano"],
    ["2025-09-04", "1 ano e 1 mês"],
    ["2024-04-04", "2 anos e 6 meses"],
    ["2023-10-05", "2 anos e 11 meses"],
    ["2023-10-04", "3 anos"],
    ["2020-01-04", "6 anos"],
    ["1980-05-20", "46 anos"],
  ])("nascido em %s, em 04/10/2026: %s", (birthdate, expected) => {
    expect(formatAge(birthdate, "2026-10-04")).toBe(expected);
  });

  it("conta os dias corridos na virada de mês", () => {
    expect(formatAge("2026-01-31", "2026-02-28")).toBe("28 dias");
  });

  it("conta os dias corridos na virada de ano", () => {
    expect(formatAge("2025-12-25", "2026-01-04")).toBe("10 dias");
  });

  // Achado 3 da F1, corrigido na F3.5 (decisão do cliente): o banco recusa
  // nascimento futuro, mas um dado errado aparece como tal, não como idade.
  it("data de nascimento futura: \"nascimento inválido\"", () => {
    expect(formatAge("2026-10-10", "2026-10-04")).toBe("nascimento inválido");
    expect(formatAge("2026-10-05", "2026-10-04")).toBe("nascimento inválido");
    expect(formatAge("2026-10-04", "2026-10-04")).toBe("0 dias");
  });
});
