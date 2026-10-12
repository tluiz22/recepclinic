import { describe, expect, it } from "vitest";
import { formatCpf, isValidCpf, maskCpf, normalizeCpf } from "./cpf";

describe("CPF", () => {
  it("confere os dígitos verificadores", () => {
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCpf("12345678909")).toBe(true);
    expect(isValidCpf("52998224724")).toBe(false);
    expect(isValidCpf("11111111111")).toBe(false);
    expect(isValidCpf("5299822472")).toBe(false);
  });

  it("aceita com ou sem máscara e devolve só os dígitos", () => {
    expect(normalizeCpf("529.982.247-25")).toBe("52998224725");
    expect(normalizeCpf(" 52998224725 ")).toBe("52998224725");
    expect(normalizeCpf("529.982.247-24")).toBeNull();
    expect(normalizeCpf("")).toBeNull();
    expect(normalizeCpf(null)).toBeNull();
  });

  it("formata e mascara", () => {
    expect(formatCpf("52998224725")).toBe("529.982.247-25");
    expect(maskCpf("52998224725")).toBe("•••.982.247-••");
  });
});
