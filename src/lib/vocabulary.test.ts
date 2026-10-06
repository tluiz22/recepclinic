import { describe, expect, it } from "vitest";
import { capitalize, PROFILE_LABELS, vocabularyFor } from "./vocabulary";
import { isEmailLinkType, isPasswordProblem, passwordProblem, passwordRejection } from "./data/auth";

describe("vocabulário pelo perfil da clínica (D4b)", () => {
  it("Pediátrica: criança e responsável; Adultos: paciente e contato; Mista: paciente e responsável", () => {
    expect(vocabularyFor("pediatric")).toEqual({ patient: "criança", patients: "crianças", contact: "responsável", contacts: "responsáveis" });
    expect(vocabularyFor("adult")).toEqual({ patient: "paciente", patients: "pacientes", contact: "contato", contacts: "contatos" });
    expect(vocabularyFor("mixed")).toEqual({ patient: "paciente", patients: "pacientes", contact: "responsável", contacts: "responsáveis" });
  });

  it("títulos e rótulos dos perfis", () => {
    expect(capitalize("criança")).toBe("Criança");
    expect(capitalize("responsáveis")).toBe("Responsáveis");
    expect(PROFILE_LABELS).toEqual({ pediatric: "Pediátrica", adult: "Adultos", mixed: "Mista" });
  });
});

describe("senha nova e links do e-mail", () => {
  it("pelo menos 8 caracteres e as duas iguais", () => {
    expect(passwordProblem("1234567", "1234567")).toBe("short");
    expect(passwordProblem("12345678", "12345679")).toBe("mismatch");
    expect(passwordProblem("12345678", "12345678")).toBeNull();
    expect(passwordProblem("x".repeat(73), "x".repeat(73))).toBe("long");
  });

  it("só os códigos próprios", () => {
    expect(isPasswordProblem("short")).toBe(true);
    expect(isPasswordProblem("toString")).toBe(false);
    expect(isPasswordProblem(null)).toBe(false);
    expect(isEmailLinkType("invite")).toBe(true);
    expect(isEmailLinkType("recovery")).toBe(true);
    expect(isEmailLinkType("signup")).toBe(false);
  });

  it("recusa do Auth ao gravar a senha vira o motivo certo na tela", () => {
    expect(passwordRejection({ code: "same_password" })).toBe("same");
    expect(passwordRejection({ code: "weak_password" })).toBe("weak");
    expect(passwordRejection({ name: "AuthSessionMissingError" })).toBe("session");
    expect(passwordRejection({ code: "algo_novo" })).toBe("rejected");
  });
});
