import { describe, expect, it } from "vitest";
import { isAnonymizedPhone } from "./anonymization";

describe("telefone anonimizado (F9.4)", () => {
  it("reconhece o +00 com e sem +", () => {
    expect(isAnonymizedPhone("+000123456789012")).toBe(true);
    expect(isAnonymizedPhone("000123456789012")).toBe(true);
  });

  it("telefones de verdade passam", () => {
    expect(isAnonymizedPhone("+5561999031234")).toBe(false);
    expect(isAnonymizedPhone("5561999031234")).toBe(false);
  });
});
