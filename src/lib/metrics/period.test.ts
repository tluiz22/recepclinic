import { describe, expect, it } from "vitest";
import { PERIOD_PRESETS, addDays, metricsUrl, parsePeriod, periodParams, todayFortaleza } from "./period";

// Quarta, 14/10/2026, 09h em Fortaleza.
const NOW = new Date("2026-10-14T12:00:00Z");
const period = (query: string, now = NOW) => parsePeriod(new URLSearchParams(query), now);

describe("todayFortaleza e addDays", () => {
  it("dia de Fortaleza, mesmo quando em UTC já é amanhã", () => {
    expect(todayFortaleza(new Date("2026-10-15T02:00:00Z"))).toBe("2026-10-14");
  });

  it("soma e subtrai dias atravessando mês e ano", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("parsePeriod", () => {
  it("sem parâmetro abre em Hoje", () => {
    const result = period("");
    expect(result).toMatchObject({ preset: "hoje", from: "2026-10-14", to: "2026-10-14", label: "Hoje, 14/10/2026", invalid: false });
    expect(result.start.toISOString()).toBe("2026-10-14T03:00:00.000Z");
    expect(result.end.toISOString()).toBe("2026-10-15T03:00:00.000Z");
  });

  it("7 dias inclui hoje", () => {
    expect(period("periodo=7dias")).toMatchObject({
      from: "2026-10-08",
      to: "2026-10-14",
      label: "Últimos 7 dias (08/10 a 14/10)",
    });
  });

  it("este mês é o mês inteiro, inclusive os próximos dias", () => {
    expect(period("periodo=mes")).toMatchObject({ from: "2026-10-01", to: "2026-10-31", label: "Outubro de 2026" });
  });

  it("mês anterior", () => {
    expect(period("periodo=mes_anterior")).toMatchObject({ from: "2026-09-01", to: "2026-09-30", label: "Setembro de 2026" });
  });

  it("mês anterior em janeiro é dezembro do ano anterior", () => {
    expect(period("periodo=mes_anterior", new Date("2026-01-10T12:00:00Z"))).toMatchObject({
      from: "2025-12-01",
      to: "2025-12-31",
      label: "Dezembro de 2025",
    });
  });

  it("fevereiro de ano bissexto termina no dia 29", () => {
    expect(period("periodo=mes", new Date("2028-02-10T12:00:00Z"))).toMatchObject({ to: "2028-02-29" });
  });

  it("personalizado", () => {
    const result = period("periodo=personalizado&de=2026-09-01&ate=2026-09-15");
    expect(result).toMatchObject({ preset: "personalizado", label: "01/09/2026 a 15/09/2026", invalid: false });
    expect(result.end.toISOString()).toBe("2026-09-16T03:00:00.000Z");
  });

  it("personalizado de um dia só", () => {
    expect(period("periodo=personalizado&de=2026-09-01&ate=2026-09-01").label).toBe("01/09/2026");
  });

  it("personalizado de até 366 dias vale", () => {
    expect(period("periodo=personalizado&de=2025-10-14&ate=2026-10-14").invalid).toBe(false);
  });

  it.each([
    ["datas faltando", "periodo=personalizado"],
    ["formato errado", "periodo=personalizado&de=01/09/2026&ate=2026-09-15"],
    ["início depois do fim", "periodo=personalizado&de=2026-09-15&ate=2026-09-01"],
    ["mais de 366 dias", "periodo=personalizado&de=2025-10-13&ate=2026-10-14"],
  ])("personalizado inválido (%s) cai em Hoje marcado como inválido", (_, query) => {
    expect(period(query)).toMatchObject({ preset: "hoje", from: "2026-10-14", invalid: true });
  });

  it("atalho desconhecido abre em Hoje, sem marcar inválido", () => {
    expect(period("periodo=ano")).toMatchObject({ preset: "hoje", invalid: false });
  });
});

describe("periodParams e metricsUrl", () => {
  it("atalhos da tela", () => {
    expect(PERIOD_PRESETS.map((preset) => preset.label)).toEqual(["Hoje", "7 dias", "Este mês", "Mês anterior"]);
  });

  it("Hoje não leva parâmetro; atalho leva só o nome; personalizado leva as datas", () => {
    expect(periodParams(period(""))).toEqual({});
    expect(periodParams(period("periodo=mes"))).toEqual({ periodo: "mes" });
    expect(periodParams(period("periodo=personalizado&de=2026-09-01&ate=2026-09-15"))).toEqual({
      periodo: "personalizado",
      de: "2026-09-01",
      ate: "2026-09-15",
    });
  });

  it("monta o endereço ignorando valores vazios", () => {
    expect(metricsUrl({})).toBe("/admin/metricas");
    expect(metricsUrl({ aba: "funil", periodo: "mes", de: undefined, ate: "" })).toBe("/admin/metricas?aba=funil&periodo=mes");
  });
});
