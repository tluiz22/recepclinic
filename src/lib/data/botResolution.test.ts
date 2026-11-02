import { describe, expect, it } from "vitest";
import { groupEvents, type FunnelEventRow } from "./botFunnel";
import { buildResolutionReport, classifyNeedItems, groupNeeds } from "./botResolution";

// Taxa de resolução sem a recepção (EA, 02/nov/2026): exemplos com o resultado esperado.

const T0 = new Date("2026-10-07T12:00:00Z");
let n = 0;
const ev = (sessionId: string, flow: FunnelEventRow["flow"], step: string, minutes: number, phone: string, metadata: Record<string, unknown> = {}): FunnelEventRow => ({
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
const end = new Date("2026-10-09T00:00:00Z");
const now = new Date("2026-10-08T23:00:00Z");
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const report = (events: FunnelEventRow[], at = now) => buildResolutionReport(groupEvents(events, start, end), at, dayOf);

const A = "+5584990000001";
const B = "+5584990000002";
const C = "+5584990000003";

describe("desfecho de cada necessidade", () => {
  it("marcação, remarcação e cancelamento concluídos pelo bot: resolvidas", () => {
    const r = report([
      ev("m", "booking", "started", 0, A),
      ev("m", "booking", "confirmed", 5, A),
      ev("r", "reschedule", "started", 10, B),
      ev("r", "reschedule", "confirmed", 15, B),
      ev("c", "cancel", "started", 20, C),
      ev("c", "cancel", "canceled", 21, C),
    ]);
    expect(r).toMatchObject({ total: 3, resolved: 3, human: 0, inconclusive: 0, eligible: 3, rate: 1 });
    expect(r.byType.filter((t) => t.total).map((t) => t.type)).toEqual(["marcar", "remarcar", "cancelar"]);
  });

  it("dúvida confirmada: resolvida; sem confirmação: inconclusiva (e \"sem confirmação\"); \"Falar com a recepção\": recepção", () => {
    const r = report([
      ev("d1", "info", "started", 0, A, { origin: "menu" }),
      ev("d1", "info", "answered", 0, A),
      ev("d1", "info", "resolved", 1, A),
      ev("d2", "info", "started", 0, B),
      ev("d2", "info", "answered", 0, B),
      ev("d3", "info", "started", 0, C),
      ev("d3", "info", "answered", 0, C),
      ev("d3", "info", "escalated", 1, C),
      ev("h3", "handoff", "requested", 1, C, { origin: "kb_answer", info_session_id: "d3" }),
    ]);
    // A transferência ligada à dúvida não conta à parte.
    expect(r).toMatchObject({ total: 3, resolved: 1, human: 1, inconclusive: 1, unconfirmed: 1, eligible: 3 });
    expect(r.rate).toBeCloseTo(1 / 3);
  });

  it("conversa abandonada e pedido de recepção no meio da marcação: inconclusiva e recepção", () => {
    const r = report([
      ev("a", "booking", "started", 0, A),
      ev("a", "booking", "link_sent", 2, A),
      ev("b", "booking", "started", 0, B),
      ev("b", "booking", "abandoned", 3, B, { reason: "reception_requested" }),
      ev("hb", "handoff", "requested", 3, B, { journey_session_id: "b", mid_journey: true }),
    ]);
    expect(r).toMatchObject({ total: 2, resolved: 0, human: 1, inconclusive: 1 });
  });

  it("transferência sem tentativa: pedido de recepção, sempre recepção", () => {
    const r = report([ev("h", "handoff", "requested", 0, A, { origin: "typed" }), ev("n", "handoff", "not_understood", 0, B)]);
    expect(r.byType.find((t) => t.type === "recepcao")).toMatchObject({ total: 2, human: 2, rate: 0 });
  });

  it("em andamento (menos de 30 min): fora da base da taxa", () => {
    const at = new Date(T0.getTime() + 10 * 60_000);
    const r = report([ev("d", "info", "started", 0, A), ev("d", "info", "answered", 0, A), ev("m", "booking", "started", 0, B), ev("m", "booking", "confirmed", 1, B)], at);
    expect(r).toMatchObject({ total: 2, inProgress: 1, resolved: 1, eligible: 1, rate: 1 });
  });
});

describe("necessidade = mesmo contato e tipo em 24h", () => {
  it("abandonou e marcou 1 hora depois: uma necessidade, resolvida", () => {
    const r = report([
      ev("m1", "booking", "started", 0, A),
      ev("m1", "booking", "abandoned", 5, A, { reason: "timeout" }),
      ev("m2", "booking", "started", 60, A),
      ev("m2", "booking", "confirmed", 65, A),
    ]);
    expect(r).toMatchObject({ total: 1, resolved: 1, eligible: 1 });
    expect(groupNeeds(classifyNeedItems(groupEvents([ev("x", "booking", "started", 0, A), ev("y", "booking", "started", 60, A)], start, end), now))[0].attempts).toBe(2);
  });

  it("depois de 24h ou de outro tipo: necessidades separadas; outro contato também", () => {
    const r = report([
      ev("m1", "booking", "started", 0, A),
      ev("m1", "booking", "confirmed", 1, A),
      ev("m2", "booking", "started", 25 * 60, A),
      ev("m2", "booking", "confirmed", 25 * 60 + 1, A),
      ev("c", "cancel", "started", 10, A),
      ev("c", "cancel", "canceled", 11, A),
      ev("m3", "booking", "started", 0, B),
      ev("m3", "booking", "confirmed", 1, B),
    ]);
    expect(r.total).toBe(4);
    expect(r.byDay).toEqual([
      { day: "2026-10-07", eligible: 3, resolved: 3, rate: 1 },
      { day: "2026-10-08", eligible: 1, resolved: 1, rate: 1 },
    ]);
  });

  it("várias mensagens da mesma tentativa contam uma vez", () => {
    const r = report([
      ev("m", "booking", "started", 0, A),
      ev("m", "booking", "BOOK_SERVICE", 1, A),
      ev("m", "booking", "BOOK_AGENDA", 2, A),
      ev("m", "booking", "BOOK_AGENDA", 3, A),
      ev("m", "booking", "link_sent", 4, A),
      ev("m", "booking", "confirmed", 5, A),
    ]);
    expect(r.total).toBe(1);
  });

  it("período: a necessidade conta pela primeira tentativa; a de depois do período só completa a de dentro", () => {
    const events = [
      ev("m1", "booking", "started", 0, A),
      // 1 dia e 11h depois do início = fora do período (fim em 09/10 00:00), mas dentro dos 2 dias lidos.
      ev("m2", "booking", "started", 36 * 60 + 5, B),
      ev("m2", "booking", "confirmed", 36 * 60 + 6, B),
    ];
    const r = buildResolutionReport(groupEvents(events, start, new Date("2026-10-08T00:00:00Z")), now, dayOf);
    expect(r.total).toBe(1);
  });
});
