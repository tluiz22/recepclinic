import { describe, expect, it } from "vitest";
import { formatPhoneBR, normalizePhone, whatsappHref } from "./phone";

describe("normalizePhone", () => {
  it("acrescenta +55 quando o número vem sem código do país", () => {
    expect(normalizePhone("(84) 99999-1234")).toBe("+5584999991234");
  });

  it("mantém o código do país quando o número já vem com +", () => {
    expect(normalizePhone("+55 84 99999-1234")).toBe("+5584999991234");
  });

  it("recusa números curtos demais", () => {
    expect(normalizePhone("1234")).toBeNull();
  });

  it("recusa entrada vazia", () => {
    expect(normalizePhone("")).toBeNull();
  });
});

describe("formatPhoneBR", () => {
  it("formata celular brasileiro em E.164", () => {
    expect(formatPhoneBR("+5561998645490")).toBe("(61) 99864-5490");
  });

  it("devolve como veio o que não é celular brasileiro", () => {
    expect(formatPhoneBR("+14155552671")).toBe("+14155552671");
  });
});

describe("whatsappHref", () => {
  it("monta o link wa.me só com dígitos", () => {
    expect(whatsappHref("+5584999991234")).toBe("https://wa.me/5584999991234");
  });
});
