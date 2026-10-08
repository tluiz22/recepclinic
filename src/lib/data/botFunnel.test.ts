import { describe, expect, it } from "vitest";
import { buildFunnelReport, type FunnelEventRow } from "./botFunnel";

const T0 = new Date("2026-10-07T12:00:00Z");
let n = 0;
const ev = (sessionId: string, flow: FunnelEventRow["flow"], step: string, minutes: number, metadata: Record<string, unknown> = {}, phone = "+5584990000001"): FunnelEventRow => ({
  sessionId,
  flow,
  step,
  source: ["page_opened", "confirmed", "confirm_failed", "link_expired"].includes(step) ? "web" : "bot",
  phone,
  contactId: null,
  metadata,
  occurredAt: new Date(T0.getTime() + minutes * 60_000 + ++n),
});

const start = new Date("2026-10-07T00:00:00Z");
const end = new Date("2026-10-08T00:00:00Z");
const now = new Date("2026-10-07T18:00:00Z");

describe("funil do bot (F6.7)", () => {
  it("conta cada tentativa até a etapa mais avançada, com conversão, resultados e motivos", () => {
    const events = [
      // s1: marcou do começo ao fim.
      ev("s1", "booking", "started", 0),
      ev("s1", "booking", "BOOK_SERVICE", 1),
      ev("s1", "booking", "BOOK_AGENDA", 2),
      ev("s1", "booking", "patient_identified", 3),
      ev("s1", "booking", "link_sent", 4),
      ev("s1", "booking", "page_opened", 5),
      ev("s1", "booking", "confirmed", 6),
      // s2: parou no link (sem evento de resultado, há mais de 30 min) = abandono.
      ev("s2", "booking", "started", 10, {}, "+5584990000002"),
      ev("s2", "booking", "BOOK_FOR_WHOM", 11, {}, "+5584990000002"),
      ev("s2", "booking", "patient_identified", 12, {}, "+5584990000002"),
      ev("s2", "booking", "link_sent", 13, {}, "+5584990000002"),
      // s3: barrada pela idade limite.
      ev("s3", "booking", "started", 20, {}, "+5584990000003"),
      ev("s3", "booking", "BOOK_AGE_LIMIT", 21, {}, "+5584990000003"),
      ev("s3", "booking", "blocked", 22, { reason: "consultation_age_limit" }, "+5584990000003"),
    ];
    const booking = buildFunnelReport(events, start, end, now).flows.find((f) => f.id === "booking")!;
    expect(booking.stages.map((s) => [s.label, s.count])).toEqual([
      ["Iniciaram", 3],
      ["Escolheram o serviço", 3],
      ["Identificaram o paciente", 2],
      ["Receberam o link", 2],
      ["Abriram o link", 1],
      ["Confirmaram", 1],
    ]);
    expect(booking.stages[2].conversion).toBeCloseTo(2 / 3);
    expect(booking.outcomes).toMatchObject({ concluded: 1, abandoned: 1, blocked: 1 });
    expect(booking.blockedReasons).toEqual([{ label: "Acima da idade limite", count: 1 }]);
    expect(booking.notes).toEqual([{ label: "Barradas pela idade limite (0 tentaram outra pessoa)", count: 1 }]);
  });

  it("remarcar e cancelar separam menu e lembrete", () => {
    const events = [
      ev("r1", "reschedule", "started", 0, { category: "consultation", source: "reminder" }),
      ev("r1", "reschedule", "link_sent", 1),
      ev("c1", "cancel", "started", 2, { category: "exam" }),
      ev("c1", "cancel", "CANCEL_CONFIRM", 3),
      ev("c1", "cancel", "canceled", 4),
    ];
    const report = buildFunnelReport(events, start, end, now);
    expect(report.flows.find((f) => f.id === "reschedule_reminder")!.stages[1].count).toBe(1);
    expect(report.flows.find((f) => f.id === "reschedule_menu")!.stages[0].count).toBe(0);
    expect(report.flows.find((f) => f.id === "cancel_menu")!.outcomes.concluded).toBe(1);
  });

  it("retomar contato: abandonos e erros, sem quem concluiu o mesmo fluxo depois", () => {
    const events = [
      ev("a1", "exam", "started", 0, {}, "+5584990000009"),
      ev("a1", "exam", "BOOK_FOR_WHOM", 1, {}, "+5584990000009"),
      ev("a1", "exam", "abandoned", 16, { reason: "timeout", last_step: "BOOK_FOR_WHOM" }, "+5584990000009"),
      // Mesmo número concluiu depois: sai da lista.
      ev("b1", "booking", "started", 30, {}, "+5584990000008"),
      ev("b1", "booking", "abandoned", 31, { reason: "back_to_menu" }, "+5584990000008"),
      ev("b2", "booking", "started", 40, {}, "+5584990000008"),
      ev("b2", "booking", "confirmed", 45, {}, "+5584990000008"),
      // Recepção: pedido e assumiu no meio.
      ev("h1", "handoff", "requested", 50),
      ev("h2", "handoff", "agent_took_over", 55, { mid_journey: true }),
    ];
    const report = buildFunnelReport(events, start, end, now);
    expect(report.incomplete.map((i) => [i.flowLabel, i.lastStage, i.detail])).toEqual([
      ["Marcar exame", "Escolheram o exame", "Abandonou (tempo esgotado)"],
    ]);
    expect(report.handoffRequests).toBe(1);
    expect(report.agentTookOver).toEqual({ total: 1, midJourney: 1 });
  });

  it("tentativa iniciada fora do período não entra; recente sem resultado fica em andamento", () => {
    const events = [ev("x", "booking", "started", -24 * 60), ev("y", "booking", "started", 5 * 60 + 50)];
    const booking = buildFunnelReport(events, start, end, now).flows.find((f) => f.id === "booking")!;
    expect(booking.stages[0].count).toBe(1);
    expect(booking.outcomes.in_progress).toBe(1);
  });
});
