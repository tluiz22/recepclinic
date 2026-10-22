import { describe, expect, it } from "vitest";
import { financial, type FinancialTotal } from "./metrics";

const totals: FinancialTotal[] = [
  { serviceName: "Exame", locationName: "Consultório", bucket: "lost", count: 1, cents: 15000 },
  { serviceName: "Consulta", locationName: "Consultório", bucket: "done", count: 1, cents: 30000 },
  { serviceName: "Consulta", locationName: "Consultório", bucket: "lost", count: 1, cents: 30000 },
  { serviceName: "Consulta", locationName: "Consultório", bucket: "expected", count: 2, cents: 60000 },
];

describe("contas das Métricas (F4.9)", () => {
  it("financeiro: uma linha por serviço e local, em ordem, e o total", () => {
    const result = financial(totals);
    expect(result.rows.map((r) => r.label)).toEqual(["Consulta · Consultório", "Exame · Consultório"]);
    expect(result.rows[0]).toMatchObject({ done: { count: 1, cents: 30000 }, expected: { count: 2, cents: 60000 }, lost: { count: 1, cents: 30000 } });
    expect(result.total).toEqual({
      label: "Total",
      done: { count: 1, cents: 30000 },
      expected: { count: 2, cents: 60000 },
      lost: { count: 2, cents: 45000 },
    });
  });

  it("financeiro sem nada no período", () => {
    expect(financial([])).toEqual({ rows: [], total: { label: "Total", done: { count: 0, cents: 0 }, expected: { count: 0, cents: 0 }, lost: { count: 0, cents: 0 } } });
  });
});
