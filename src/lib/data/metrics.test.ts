import { describe, expect, it } from "vitest";
import { byOrigin, financial, noShowByCategory, overview, volumeByService, type MetricsRow } from "./metrics";

const now = new Date("2026-10-15T15:00:00Z");
const row = (overrides: Partial<MetricsRow>): MetricsRow => ({
  id: crypto.randomUUID(),
  scheduledAt: new Date("2026-10-14T12:00:00Z"),
  status: "completed",
  category: "consultation",
  serviceName: "Consulta",
  locationName: "Consultório",
  isHomeVisit: false,
  agendaId: "a",
  patientId: crypto.randomUUID(),
  bookingChannel: "admin",
  canceledVia: null,
  priceCents: 30000,
  ...overrides,
});

const rows = [
  row({}),
  row({ status: "no_show", bookingChannel: "whatsapp_bot" }),
  row({ status: "canceled", canceledVia: "whatsapp_bot" }),
  row({ status: "scheduled", scheduledAt: new Date("2026-10-15T12:00:00Z") }), // já passou, sem registro
  row({ status: "scheduled", scheduledAt: new Date("2026-10-20T12:00:00Z"), bookingChannel: "booking_link" }),
  row({ category: "return_visit", serviceName: "Retorno", priceCents: 0 }),
  row({ category: "exam", serviceName: "Exame", status: "no_show", priceCents: 15000 }),
];

describe("contas das Métricas (F4.9)", () => {
  it("visão geral: sem cancelados no total; pendentes, próximos, faltas e canal", () => {
    expect(overview(rows, now)).toEqual({
      total: 6,
      completed: 2,
      noShow: 2,
      canceled: 1,
      pending: 1,
      upcoming: 1,
      noShowRate: 0.5,
      byChannel: { whatsapp: 1, panel: 4, link: 1 },
    });
  });

  it("volume por serviço e local, do maior para o menor", () => {
    expect(volumeByService(rows)[0]).toEqual({ label: "Consulta · Consultório", count: 4 });
  });

  it("não comparecimento por tipo, só entre os registrados", () => {
    expect(noShowByCategory(rows)).toEqual([
      { label: "Consulta", completed: 1, noShow: 1, rate: 0.5 },
      { label: "Retorno", completed: 1, noShow: 0, rate: 0 },
      { label: "Exame", completed: 0, noShow: 1, rate: 1 },
      { label: "Total", completed: 2, noShow: 2, rate: 0.5 },
    ]);
  });

  it("por origem: marcados e cancelados por canal", () => {
    expect(byOrigin(rows)).toContainEqual({ label: "WhatsApp (bot)", booked: 1, canceled: 1 });
    expect(byOrigin(rows)).toContainEqual({ label: "Painel (equipe)", booked: 5, canceled: 0 });
  });

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
