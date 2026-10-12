import { describe, expect, it } from "vitest";
import { formatCnpj, isValidCnpj, normalizeCnpj } from "./cnpj";

describe("CNPJ", () => {
  it("confere os dígitos verificadores", () => {
    expect(isValidCnpj("11222333000181")).toBe(true);
    expect(isValidCnpj("11444777000161")).toBe(true);
    expect(isValidCnpj("11222333000182")).toBe(false);
    expect(isValidCnpj("11111111111111")).toBe(false);
    expect(isValidCnpj("1122233300018")).toBe(false);
  });

  it("aceita o CNPJ alfanumérico da Receita", () => {
    expect(isValidCnpj("12ABC34501DE35")).toBe(true);
    expect(isValidCnpj("12ABC34501DE34")).toBe(false);
    expect(normalizeCnpj("12.abc.345/01de-35")).toBe("12ABC34501DE35");
  });

  it("aceita com ou sem máscara e formata", () => {
    expect(normalizeCnpj("11.222.333/0001-81")).toBe("11222333000181");
    expect(normalizeCnpj("11.222.333/0001-80")).toBeNull();
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81");
  });
});
