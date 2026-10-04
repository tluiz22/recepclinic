import { describe, expect, it } from "vitest";
import { Validation } from "./errors";
import { canBeOwnContact, isValidBirthdate, normalizeInsurance } from "./patients";

const TODAY = "2026-10-04";

describe("nascimento válido (achados 1 e 2 da F1)", () => {
  it("de 01/01/1900 até hoje, no calendário da clínica", () => {
    expect(isValidBirthdate("1900-01-01", TODAY)).toBe(true);
    expect(isValidBirthdate("2026-10-04", TODAY)).toBe(true);
    expect(isValidBirthdate("1899-12-31", TODAY)).toBe(false);
    // Amanhã nunca passa, seja qual for a hora do servidor: `today` vem do fuso da clínica.
    expect(isValidBirthdate("2026-10-05", TODAY)).toBe(false);
  });

  it("data que não existe é recusada aqui, não só no banco", () => {
    expect(isValidBirthdate("2015-02-31", TODAY)).toBe(false);
    expect(isValidBirthdate("2015-13-01", TODAY)).toBe(false);
    expect(isValidBirthdate("2024-02-29", TODAY)).toBe(true);
    expect(isValidBirthdate("04/10/2000", TODAY)).toBe(false);
  });
});

describe("próprio contato só com 18 anos completos", () => {
  it("faz 18 hoje: pode; amanhã: ainda não", () => {
    expect(canBeOwnContact("2008-10-04", TODAY)).toBe(true);
    expect(canBeOwnContact("2008-10-05", TODAY)).toBe(false);
  });
});

describe("plano do paciente (D10)", () => {
  it("particular limpa a carteirinha", () => {
    expect(normalizeInsurance(null, new Validation())).toEqual({
      insurance_plan_id: null,
      insurance_card_number: null,
      insurance_card_valid_until: null,
    });
  });

  it("plano com carteirinha e validade; validade inválida acusa", () => {
    const v = new Validation();
    expect(normalizeInsurance({ planId: "p1", cardNumber: " 123 ", cardValidUntil: "2027-01-31" }, v)).toEqual({
      insurance_plan_id: "p1",
      insurance_card_number: "123",
      insurance_card_valid_until: "2027-01-31",
    });
    expect(v.ok).toBe(true);
    const invalid = new Validation();
    normalizeInsurance({ planId: "p1", cardValidUntil: "2027-02-30" }, invalid);
    expect(invalid.fields).toEqual({ cardValidUntil: "Validade da carteirinha inválida." });
  });
});
