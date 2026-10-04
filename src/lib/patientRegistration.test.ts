import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canBeGuardianSelf, consultationAgeLimitWarning, isValidBirthdate } from "./patientRegistration";

// "Hoje" em Fortaleza: 04/10/2026 (07:00 UTC = 04h em Fortaleza).
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T07:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("isValidBirthdate", () => {
  it("aceita data no formato AAAA-MM-DD", () => {
    expect(isValidBirthdate("2015-03-20")).toBe(true);
  });

  it("aceita hoje, recusa amanhã", () => {
    expect(isValidBirthdate("2026-10-04")).toBe(true);
    expect(isValidBirthdate("2026-10-05")).toBe(false);
  });

  it("usa o dia de Fortaleza, não o UTC", () => {
    // 02:00 UTC de 05/10 ainda é 04/10 em Fortaleza.
    vi.setSystemTime(new Date("2026-10-05T02:00:00Z"));
    expect(isValidBirthdate("2026-10-05")).toBe(false);
    expect(isValidBirthdate("2026-10-04")).toBe(true);
  });

  it("aceita a partir de 01/01/1900", () => {
    expect(isValidBirthdate("1900-01-01")).toBe(true);
    expect(isValidBirthdate("1899-12-31")).toBe(false);
  });

  it.each([undefined, "", "20/03/2015", "2015-3-20", "2015-03-20T00:00", "abcd-ef-gh"])(
    "recusa ausente ou fora do formato: %s",
    (value) => {
      expect(isValidBirthdate(value)).toBe(false);
    },
  );

  it("só confere o formato e o intervalo, não se o dia existe no calendário", () => {
    expect(isValidBirthdate("2015-02-31")).toBe(true);
    expect(isValidBirthdate("2015-13-01")).toBe(true);
  });
});

describe("canBeGuardianSelf", () => {
  it("adulto (18+) pode ser o próprio responsável", () => {
    expect(canBeGuardianSelf("2008-10-04")).toBe(true);
  });

  it("menor de 18 precisa de outra pessoa como responsável", () => {
    expect(canBeGuardianSelf("2008-10-05")).toBe(false);
  });
});

describe("consultationAgeLimitWarning", () => {
  it("monta o aviso com o limite configurado", () => {
    expect(consultationAgeLimitWarning(14)).toBe(
      "Paciente com 14 anos ou mais: não pode marcar consulta, só exame.",
    );
  });
});
