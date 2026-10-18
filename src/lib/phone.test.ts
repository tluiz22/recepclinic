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

  it("aceita 55 sem o + e fixo de 8 dígitos", () => {
    expect(normalizePhone("5561998545490")).toBe("+5561998545490");
    expect(normalizePhone("(61) 3333-4444")).toBe("+556133334444");
  });

  it("recusa celular sem dígitos, DDD com zero e fixo que não começa de 2 a 5 (cliente, 17/out/2026)", () => {
    expect(normalizePhone("(61) 99854-54")).toBeNull();
    expect(normalizePhone("619985454")).toBeNull();
    expect(normalizePhone("6199854549")).toBeNull();
    expect(normalizePhone("01998545490")).toBeNull();
    expect(normalizePhone("+55619985454")).toBeNull();
  });

  it("de outro país, só com o +", () => {
    expect(normalizePhone("+14155552671")).toBe("+14155552671");
  });
});

describe("formatPhoneBR", () => {
  it("formata celular brasileiro em E.164", () => {
    expect(formatPhoneBR("+5561998645490")).toBe("(61) 99864-5490");
  });

  it("formata fixo brasileiro", () => {
    expect(formatPhoneBR("+556133334444")).toBe("(61) 3333-4444");
  });

  it("número brasileiro fora do formato: sem o +55", () => {
    expect(formatPhoneBR("+55619985454")).toBe("(61) 9985454");
  });

  it("devolve como veio o número de outro país", () => {
    expect(formatPhoneBR("+14155552671")).toBe("+14155552671");
  });
});

describe("whatsappHref", () => {
  it("monta o link wa.me só com dígitos", () => {
    expect(whatsappHref("+5584999991234")).toBe("https://wa.me/5584999991234");
  });
});
