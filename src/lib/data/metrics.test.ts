import { describe, expect, it } from "vitest";
import { financial, type MetricsRow } from "./metrics";

const row = (overrides: Partial<MetricsRow>): MetricsRow => ({
  id: crypto.randomUUID(),
  scheduledAt: new Date("2026-10-14T12:00:00Z"),
  status: "completed",
  category: "consultation",
  serviceName: "Consulta",
  locationName: "Consultório",
  priceCents: 30000,
  ...overrides,
});

const rows = [
  row({}),
  row({ status: "no_show" }),
  row({ status: "canceled" }),
  row({ status: "scheduled", scheduledAt: new Date("2026-10-15T12:00:00Z") }), // já passou, sem registro
  row({ status: "scheduled", scheduledAt: new Date("2026-10-20T12:00:00Z") }),
  row({ category: "return_visit", serviceName: "Retorno", priceCents: 0 }),
  row({ category: "exam", serviceName: "Exame", status: "no_show", priceCents: 15000 }),
];

describe("contas das Métricas (F4.9)", () => {
  it("financeiro: realizado, previsto e faltas; retorno e cancelado fora", () => {
    const result = financial(rows);
    expect(result.rows.map((r) => r.label)).toEqual(["Consulta · Consultório", "Exame · Consultório"]);
    expect(result.total).toEqual({
      label: "Total",
      done: { count: 1, cents: 30000 },
      expected: { count: 2, cents: 60000 },
      lost: { count: 2, cents: 45000 },
    });
  });
});
