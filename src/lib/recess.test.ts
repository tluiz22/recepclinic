import { describe, expect, it } from "vitest";
import { blockDays, RECESS_DEFAULT_MESSAGE, recessReturnDate, renderRecessMessage } from "./recess";

const TZ = "America/Sao_Paulo";
const at = (iso: string) => new Date(`${iso}-03:00`);

describe("recesso", () => {
  it("retorna no dia seguinte ao fim (dia todo)", () => {
    expect(recessReturnDate(at("2026-12-31T00:00:00"), TZ)).toBe("2026-12-31");
    expect(recessReturnDate(at("2026-12-24T00:00:00"), TZ)).toBe("2026-12-24");
  });
  it("retorna no dia seguinte ao fim (com horário)", () => {
    expect(recessReturnDate(at("2026-12-30T12:00:00"), TZ)).toBe("2026-12-31");
  });
  it("troca {data} na mensagem padrão", () => {
    const text = renderRecessMessage(RECESS_DEFAULT_MESSAGE, "2027-01-04");
    expect(text).toContain("no dia 04/01/2027");
    expect(text).not.toContain("{data}");
  });
  it("conta os dias do período", () => {
    expect(blockDays(at("2026-12-20T00:00:00"), at("2026-12-26T00:00:00"), TZ)).toBe(6);
    expect(blockDays(at("2026-12-20T08:00:00"), at("2026-12-20T12:00:00"), TZ)).toBe(1);
  });
});
