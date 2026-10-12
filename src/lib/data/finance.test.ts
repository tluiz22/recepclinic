import { describe, expect, it } from "vitest";
import { DEFAULT_PATIENT_FINANCE, effectivePayer, resolvePayer } from "./finance";

// Módulo financeiro (F11.1): quem paga, pelo paciente, contato e dados do módulo.
const child = { fullName: "Ana Criança", isContactSelf: false };
const adult = { fullName: "Bruno Adulto", isContactSelf: true };
const mother = { fullName: "Carla Mãe" };

describe("responsável financeiro", () => {
  it("padrão: o contato do WhatsApp, com o CPF dele", () => {
    expect(resolvePayer(child, mother, DEFAULT_PATIENT_FINANCE, "52998224725")).toEqual({ payer: "contact", name: "Carla Mãe", cpf: "52998224725" });
    expect(resolvePayer(child, mother, DEFAULT_PATIENT_FINANCE, null)).toEqual({ payer: "contact", name: "Carla Mãe", cpf: null });
  });

  it("o próprio paciente, com o CPF do paciente", () => {
    const finance = { ...DEFAULT_PATIENT_FINANCE, payer: "patient" as const, cpf: "12345678909" };
    expect(resolvePayer(child, mother, finance, "52998224725")).toEqual({ payer: "patient", name: "Ana Criança", cpf: "12345678909" });
  });

  it("outra pessoa, com nome e CPF próprios", () => {
    const finance = { ...DEFAULT_PATIENT_FINANCE, payer: "other" as const, payerName: "Davi Pai", payerCpf: "12345678909" };
    expect(resolvePayer(child, mother, finance, "52998224725")).toEqual({ payer: "other", name: "Davi Pai", cpf: "12345678909" });
  });

  it("quem fala por si: o contato é o próprio paciente, e o CPF fica no contato", () => {
    expect(effectivePayer(adult, "patient")).toBe("contact");
    expect(effectivePayer(child, "patient")).toBe("patient");
    const finance = { ...DEFAULT_PATIENT_FINANCE, payer: "patient" as const };
    expect(resolvePayer(adult, { fullName: "Bruno Adulto" }, finance, "52998224725")).toEqual({ payer: "contact", name: "Bruno Adulto", cpf: "52998224725" });
  });
});
