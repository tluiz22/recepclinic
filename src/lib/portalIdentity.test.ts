import { describe, expect, it } from "vitest";
import { blockedText, cleanCode, clock, hashCode, hashToken, ipPrefix, newCode, newSessionToken, phoneEnding, resendWaitSeconds } from "./portalIdentity";

describe("identificação do portal", () => {
  it("código de 6 números, preso à sessão", () => {
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(/^\d{6}$/);
    expect(hashCode("123456", "s1")).not.toBe(hashCode("123456", "s2"));
    expect(hashCode("123456", "s1")).toBe(hashCode("123456", "s1"));
  });

  it("aceita o código digitado ou colado com espaços; recusa o resto", () => {
    expect(cleanCode(" 482 137 ")).toBe("482137");
    expect(cleanCode("48213")).toBeNull();
    expect(cleanCode("4821370")).toBeNull();
    expect(cleanCode(null)).toBeNull();
  });

  it("sessão com token longo; o banco só vê o hash", () => {
    const token = newSessionToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
  });

  it("IP truncado (sem guardar o IP inteiro)", () => {
    expect(ipPrefix("200.10.20.33")).toBe("200.10.20");
    expect(ipPrefix("200.10.20.33, 10.0.0.1")).toBe("200.10.20");
    expect(ipPrefix("::ffff:10.1.2.3")).toBe("10.1.2");
    expect(ipPrefix("2804:14c:5b:abcd::1")).toBe("2804:14c:5b");
    // "::" comprimido: o /48 certo.
    expect(ipPrefix("2001:db8::1")).toBe("2001:db8:0");
    expect(ipPrefix("2001::5")).toBe("2001:0:0");
    expect(ipPrefix("2001::1")).toBe(ipPrefix("2001::2"));
    expect(ipPrefix(undefined)).toBe("desconhecido");
  });

  it("textos de espera e do celular", () => {
    const now = new Date("2026-11-09T12:00:00Z");
    expect(resendWaitSeconds(new Date("2026-11-09T11:59:30Z"), now)).toBe(30);
    expect(resendWaitSeconds(new Date("2026-11-09T11:58:00Z"), now)).toBe(0);
    expect(blockedText(new Date("2026-11-09T12:15:00Z"), now)).toBe("em 15 minutos");
    expect(blockedText(new Date("2026-11-09T13:00:00Z"), now)).toBe("em 1 hora");
    expect(blockedText(new Date("2026-11-10T12:00:00Z"), now)).toBe("amanhã");
    expect(clock(59)).toBe("0:59");
    expect(clock(299)).toBe("4:59");
    expect(phoneEnding("+5584998764321")).toBe("final 4321");
  });
});
