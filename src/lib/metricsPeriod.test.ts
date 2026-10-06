import { describe, expect, it } from "vitest";
import { parsePeriod } from "./metricsPeriod";

const now = new Date("2026-10-15T15:00:00Z"); // 12h em Fortaleza
const period = (query: string, timeZone = "America/Fortaleza") => parsePeriod(new URLSearchParams(query), timeZone, now);

describe("período das Métricas (F4.9)", () => {
  it("abre em Hoje, no fuso da clínica", () => {
    expect(period("")).toMatchObject({ preset: "hoje", from: "2026-10-15", to: "2026-10-15", label: "Hoje, 15/10/2026" });
    expect(period("").start.toISOString()).toBe("2026-10-15T03:00:00.000Z");
    expect(period("", "America/Manaus").start.toISOString()).toBe("2026-10-15T04:00:00.000Z");
  });

  it("7 dias, este mês e mês anterior", () => {
    expect(period("periodo=7dias")).toMatchObject({ from: "2026-10-09", to: "2026-10-15" });
    expect(period("periodo=mes")).toMatchObject({ from: "2026-10-01", to: "2026-10-31", label: "Outubro de 2026" });
    expect(period("periodo=mes_anterior")).toMatchObject({ from: "2026-09-01", to: "2026-09-30", label: "Setembro de 2026" });
  });

  it("personalizado; inválido ou longo demais cai em Hoje", () => {
    expect(period("periodo=personalizado&de=2026-09-10&ate=2026-09-20")).toMatchObject({ preset: "personalizado", label: "10/09/2026 a 20/09/2026" });
    expect(period("periodo=personalizado&de=2026-09-20&ate=2026-09-10")).toMatchObject({ preset: "hoje", invalid: true });
    expect(period("periodo=personalizado&de=2024-01-01&ate=2026-09-10")).toMatchObject({ preset: "hoje", invalid: true });
  });
});
