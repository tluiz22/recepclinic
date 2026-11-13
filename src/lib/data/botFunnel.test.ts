import { describe, expect, it } from "vitest";
import { buildDigitalReport, buildFunnelReport, groupEvents, linkPortalBookings, type FunnelEventRow } from "./botFunnel";

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

describe("Agendamento digital (M5 das Métricas)", () => {
  const P = (i: number) => `+55849900001${String(i).padStart(2, "0")}`;
  const events = [
    // d1: marcou consulta; o atendimento depois foi cancelado.
    ev("d1", "booking", "started", 0, {}, P(1)),
    ev("d1", "booking", "patient_identified", 1, {}, P(1)),
    ev("d1", "booking", "link_sent", 2, {}, P(1)),
    ev("d1", "booking", "page_opened", 3, {}, P(1)),
    ev("d1", "booking", "confirmed", 4, { appointment_id: "a1" }, P(1)),
    // d2: retorno barrado na regra.
    ev("d2", "return_booking", "started", 10, {}, P(2)),
    ev("d2", "return_booking", "blocked", 11, { reason: "return_deadline_passed" }, P(2)),
    // d3: exame, recebeu o link e não abriu (abandono).
    ev("d3", "exam", "started", 20, {}, P(3)),
    ev("d3", "exam", "patient_identified", 21, {}, P(3)),
    ev("d3", "exam", "link_sent", 22, {}, P(3)),
    // d4: consulta, abriu e o horário foi ocupado ao confirmar.
    ev("d4", "booking", "started", 30, {}, P(4)),
    ev("d4", "booking", "patient_identified", 31, {}, P(4)),
    ev("d4", "booking", "link_sent", 32, {}, P(4)),
    ev("d4", "booking", "page_opened", 33, {}, P(4)),
    ev("d4", "booking", "confirm_failed", 34, { reason: "slot_taken" }, P(4)),
    // d5: em andamento (último passo há menos de 30 min).
    ev("d5", "booking", "started", 345, {}, P(5)),
    // d6: remarcou pelo lembrete (não soma nas marcações).
    ev("d6", "reschedule", "started", 40, { source: "reminder" }, P(6)),
    ev("d6", "reschedule", "link_sent", 41, {}, P(6)),
    ev("d6", "reschedule", "page_opened", 42, {}, P(6)),
    ev("d6", "reschedule", "confirmed", 43, {}, P(6)),
    // h1: pediu a recepção no meio de uma marcação (com a etapa, M3).
    ev("h1", "handoff", "requested", 50, { mid_journey: true, journey_state: "BOOK_PATIENT_NEW", origin: "way_out" }, P(4)),
    // h2: o bot não entendeu na entrada (motivo próprio, sem origem de pedido).
    ev("h2", "handoff", "not_understood", 51, { mid_journey: false, journey_state: "ENTRY_BIRTHDATE" }, P(4)),
  ];
  const sessions = groupEvents(events, start, end).map((s) => (s.sessionId === "d1" ? { ...s, appointmentStatus: "canceled" } : s));

  it("marcar soma consulta, retorno e exame, sem remarcar nem cancelar", () => {
    const r = buildDigitalReport(sessions, now);
    expect(r.attempts).toBe(5);
    expect(r.outcomes).toEqual({ concluded: 1, abandoned: 2, blocked: 1, declined: 0, error: 0, in_progress: 1 });
    expect(r.finished).toBe(4);
    expect(r.stages.map((s) => [s.label, s.count])).toEqual([
      ["Pediram para marcar", 5],
      ["Receberam o link", 3],
      ["Abriram o link", 2],
      ["Marcaram", 1],
    ]);
    expect(r.stages[0]).toMatchObject({ lostToNext: 2, blockedHere: 1, biggestLoss: true });
    expect(r.stages[2]).toMatchObject({ lostToNext: 1, slotTakenHere: 1 });
    expect(r.markedLater).toBe(0);
  });

  it("marcou depois pelo portal (link vencido): conta em Marcaram, com o detalhe", () => {
    const lean = [
      // p1: link vencido, marcou pelo portal 2 h depois (o mesmo contato).
      { ...ev("p1", "booking", "started", 0, { lean: true }, P(7)), contactId: "c7" },
      ev("p1", "booking", "link_sent", 1, {}, P(7)),
      ev("p1", "booking", "link_expired", 60, {}, P(7)),
      // p2: pediu e marcou pelo portal 2 dias depois (fora das 24 horas).
      ev("p2", "booking", "started", 5, { lean: true }, P(8)),
      ev("p2", "booking", "link_sent", 6, {}, P(8)),
      // p3: pediu duas vezes; a marcação liga só à mais recente (p3b).
      ev("p3a", "booking", "started", 10, { lean: true }, P(9)),
      ev("p3a", "booking", "link_sent", 11, {}, P(9)),
      ev("p3b", "booking", "started", 40, { lean: true }, P(9)),
      ev("p3b", "booking", "link_sent", 41, {}, P(9)),
    ];
    const s = groupEvents(lean, start, end);
    const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
    linkPortalBookings(s, [
      { appointmentId: "x1", status: "scheduled", createdAt: at(120), contactId: "c7", phone: null },
      { appointmentId: "x2", status: "scheduled", createdAt: at(5 + 48 * 60), contactId: "c8", phone: P(8) },
      { appointmentId: "x3", status: "canceled", createdAt: at(90), contactId: "c9", phone: P(9) },
      // Outra pessoa: não liga.
      { appointmentId: "x4", status: "scheduled", createdAt: at(30), contactId: "c0", phone: P(0) },
    ]);
    const r = buildDigitalReport(s, now);
    expect(r.outcomes).toMatchObject({ concluded: 2, abandoned: 2 });
    expect(r.markedLater).toBe(2);
    expect(r.stages.map((x) => x.count)).toEqual([4, 4, 2, 2]);
    expect(r.standing).toEqual({ standing: 1, canceledLater: 1, unlinked: 0 });
    expect(r.dropped).toEqual([{ label: "Pararam de responder", count: 2 }]);
    expect(s.find((x) => x.sessionId === "p3a")!.appointmentId).toBeNull();
  });

  it("a marcação pelo link não liga de novo a outra tentativa", () => {
    const s = groupEvents(
      [
        ev("q1", "booking", "started", 0, {}, P(10)),
        ev("q1", "booking", "link_sent", 1, {}, P(10)),
        ev("q2", "booking", "started", 2, {}, P(10)),
        ev("q2", "booking", "confirmed", 3, { appointment_id: "y1" }, P(10)),
        // q3: barrada sem receber o link; a marcação pelo portal não a liga.
        ev("q3", "booking", "started", 4, {}, P(11)),
        ev("q3", "booking", "blocked", 5, { reason: "already_scheduled" }, P(11)),
      ],
      start,
      end,
    );
    linkPortalBookings(s, [
      { appointmentId: "y1", status: "scheduled", createdAt: new Date(T0.getTime() + 3 * 60_000), contactId: "c10", phone: P(10) },
      { appointmentId: "y2", status: "scheduled", createdAt: new Date(T0.getTime() + 60 * 60_000), contactId: "c11", phone: P(11) },
    ]);
    expect(buildDigitalReport(s, now).markedLater).toBe(0);
    expect(buildDigitalReport(s, now).outcomes.blocked).toBe(1);
    expect(s.find((x) => x.sessionId === "q1")!.events.some((e) => e.step === "confirmed")).toBe(false);
  });

  it("seguem de pé confere o atendimento, não a conversa", () => {
    expect(buildDigitalReport(sessions, now).standing).toEqual({ standing: 0, canceledLater: 1, unlinked: 0 });
  });

  it("motivos, erros ao confirmar e quem não abriu o link", () => {
    const r = buildDigitalReport(sessions, now);
    expect(r.blocked).toEqual([{ label: "Prazo do retorno vencido", count: 1 }]);
    expect(r.errors).toEqual([{ label: "Ao confirmar: Horário ocupado ao confirmar", count: 1 }]);
    expect(r.dropped).toEqual([{ label: "Pararam de responder", count: 1 }]);
    expect(r.slotTaken).toBe(1);
  });

  it("remarcar: operação própria, pela origem", () => {
    const r = buildDigitalReport(sessions, now, "remarcar", "lembrete");
    expect(r.attempts).toBe(1);
    expect(r.outcomes.concluded).toBe(1);
    expect(r.flows.map((f) => [f.label, f.attempts])).toEqual([["Pelo lembrete", 1]]);
    expect(buildDigitalReport(sessions, now, "remarcar", "menu").attempts).toBe(0);
  });

  it("recepção: por contato, com a etapa do pedido", () => {
    const r = buildDigitalReport(sessions, now);
    expect(r.reception).toMatchObject({ requested: 1, tookOver: 0, contactsNeeding: 1, contactsTotal: 6, withoutStep: 0 });
    expect(r.reception.byStep).toEqual([
      { label: "Cadastrando o paciente", count: 1 },
      { label: "Informando a data de nascimento (agendamento marcado)", count: 1 },
    ]);
    // Os motivos da pausa e, nos pedidos, de onde vieram (cliente, 30/out/2026).
    expect(r.reception.byReason).toEqual([
      { label: "O bot não entendeu", count: 1 },
      { label: "Pediram a recepção", count: 1 },
    ]);
    expect(r.reception.byOrigin).toEqual([{ label: "Botão de saída (resposta não entendida)", count: 1 }]);
  });

  it("sem tentativas: tudo zero, sem divisão por zero", () => {
    const r = buildDigitalReport([], now);
    expect(r.attempts).toBe(0);
    expect(r.stages.every((s) => s.share === null && !s.biggestLoss)).toBe(true);
  });
});
