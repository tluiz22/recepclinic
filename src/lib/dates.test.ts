import { describe, expect, it } from "vitest";
import { formatDateBR, formatDateOptionLabel, formatWeekdayFull } from "./dates";
import { formatCentsBRL } from "./money";
import { formatWhen } from "./whatsapp/formatDateTime";

// O Intl separa "R$" do valor com espaço não separável; os testes comparam com espaço comum.
const plainSpaces = (text: string) => text.replace(/\s/g, " ");

describe("formatDateBR", () => {
  it("AAAA-MM-DD vira DD/MM/AAAA", () => {
    expect(formatDateBR("2026-10-14")).toBe("14/10/2026");
  });
});

describe("formatWeekdayFull e formatDateOptionLabel", () => {
  it.each([
    ["2026-10-11", "Domingo"],
    ["2026-10-14", "Quarta-feira"],
    ["2026-10-17", "Sábado"],
  ])("%s é %s", (date, weekday) => {
    expect(formatWeekdayFull(date)).toBe(weekday);
  });

  it("opção de data do agendamento", () => {
    expect(formatDateOptionLabel("2026-10-14")).toBe("Quarta-feira, 14/10/2026");
  });
});

describe("formatCentsBRL", () => {
  it.each([
    [25000, "R$ 250,00"],
    [12345, "R$ 123,45"],
    [0, "R$ 0,00"],
    [150000, "R$ 1.500,00"],
  ])("%i centavos = %s", (cents, expected) => {
    expect(plainSpaces(formatCentsBRL(cents))).toBe(expected);
  });
});

describe("formatWhen", () => {
  it("data e hora no fuso de Fortaleza", () => {
    expect(formatWhen(new Date("2026-08-21T17:00:00Z"))).toBe("21/08/2026 às 14h00");
  });

  it("23h de Fortaleza não vira o dia seguinte (UTC)", () => {
    expect(formatWhen(new Date("2026-10-15T02:30:00Z"))).toBe("14/10/2026 às 23h30");
  });

  it("meia-noite aparece como 00h00", () => {
    expect(formatWhen(new Date("2026-10-15T03:00:00Z"))).toBe("15/10/2026 às 00h00");
  });
});
