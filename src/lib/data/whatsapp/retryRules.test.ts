import { describe, expect, it } from "vitest";
import { describeTrail } from "../agenda/trail";
import { countFailedSends, failedSendDetails, retryingSends } from "../sends";
import { GraphRequestError } from "./graph";
import { botRetryContext, classifySendError, isRetryable, isTechnicalCode, lastRetryWithin, nextRetryAt } from "./retryRules";

// Reenvio automático de envios com falha técnica (cliente, 23/out/2026).

const graph = (code: number | null, httpStatus: number) => new GraphRequestError("Envio pelo WhatsApp", { code, message: "x", httpStatus });

describe("o que é falha técnica", () => {
  it("instabilidade, manutenção e limite de vazão da Meta: sim", () => {
    for (const code of [1, 2, 4, 80007, 130429, 131000, 131016, 131056, 131057, 133004]) {
      expect(classifySendError(graph(code, 400))).toEqual({ code, technical: true });
    }
  });

  it("número sem WhatsApp, template, pagamento, parâmetro e token: não", () => {
    for (const code of [100, 190, 131026, 131042, 131047, 131049, 132000, 132001, 132015]) {
      expect(classifySendError(graph(code, 400))).toEqual({ code, technical: false });
    }
  });

  it("sem código da Meta: HTTP 5xx e 429 sim; 4xx não", () => {
    expect(classifySendError(graph(null, 503))).toEqual({ code: null, technical: true });
    expect(classifySendError(graph(null, 429))).toEqual({ code: null, technical: true });
    expect(classifySendError(graph(null, 400))).toEqual({ code: null, technical: false });
  });

  it("erro de rede e tempo esgotado: sim; outro erro do código: não", () => {
    expect(classifySendError(new TypeError("fetch failed"))).toEqual({ code: null, technical: true });
    expect(classifySendError(Object.assign(new Error("timeout"), { name: "TimeoutError" }))).toEqual({ code: null, technical: true });
    expect(classifySendError(new Error("outra coisa"))).toEqual({ code: null, technical: false });
    expect(classifySendError("texto")).toEqual({ code: null, technical: false });
  });

  it("falha avisada depois pelo webhook: pelo código", () => {
    expect(isTechnicalCode(131000)).toBe(true);
    expect(isTechnicalCode(131026)).toBe(false);
    expect(isTechnicalCode(null)).toBe(false);
  });
});

describe("quando sai a próxima tentativa", () => {
  const failedAt = new Date("2026-10-23T12:00:00Z");

  it("10 minutos depois da 1ª falha e 30 minutos depois da 1ª (20 depois da 2ª); depois da 3ª, nenhuma", () => {
    expect(nextRetryAt(1, failedAt)).toEqual(new Date("2026-10-23T12:10:00Z"));
    expect(nextRetryAt(2, new Date("2026-10-23T12:10:00Z"))).toEqual(new Date("2026-10-23T12:30:00Z"));
    expect(nextRetryAt(3, failedAt)).toBeNull();
  });

  it("até a última tentativa: 30 minutos da 1ª falha, 20 da 2ª", () => {
    expect(lastRetryWithin(1)).toBe(30 * 60_000);
    expect(lastRetryWithin(2)).toBe(20 * 60_000);
    expect(lastRetryWithin(3)).toBe(0);
  });
});

describe("aba Envios e trilha", () => {
  const scheduledAt = new Date("2026-10-24T12:00:00Z");
  const msg = (status: string, createdAt: string, extra: { attempt?: number; retryAt?: Date | null } = {}) => ({
    messageType: "appointment_reminder",
    status,
    createdAt: new Date(createdAt),
    ...extra,
  });

  it("falha com nova tentativa prevista: 'Tentando de novo', não conta como falha", () => {
    const retrying = [msg("failed", "2026-10-23T21:00:00Z", { attempt: 1, retryAt: new Date("2026-10-23T21:10:00Z") })];
    expect(countFailedSends(retrying, [], scheduledAt)).toBe(0);
    expect(retryingSends(retrying)).toEqual([2]);
  });

  it("as tentativas acabaram: conta como falha", () => {
    const exhausted = [
      msg("failed", "2026-10-23T21:00:00Z", { attempt: 1 }),
      msg("failed", "2026-10-23T21:10:00Z", { attempt: 2 }),
      msg("failed", "2026-10-23T21:30:00Z", { attempt: 3 }),
    ];
    expect(countFailedSends(exhausted, [], scheduledAt)).toBe(1);
    expect(retryingSends(exhausted)).toEqual([]);
  });

  it("o reenvio saiu: nem falha nem 'Tentando de novo'", () => {
    const resolved = [msg("failed", "2026-10-23T21:00:00Z", { attempt: 1 }), msg("delivered", "2026-10-23T21:10:00Z", { attempt: 2 })];
    expect(countFailedSends(resolved, [], scheduledAt)).toBe(0);
    expect(retryingSends(resolved)).toEqual([]);
  });

  it("trilha: o número da tentativa e a hora da próxima", () => {
    const at = new Date("2026-10-23T21:00:00Z");
    const row = (attempt: number, status: string, retryAt: Date | null) => ({ kind: "message" as const, at, messageType: "appointment_reminder", status, attempt, retryAt });
    expect(describeTrail(row(1, "failed", new Date("2026-10-23T21:10:00Z")), new Map(), "America/Fortaleza")).toMatchObject({
      text: "WhatsApp: Lembrete não entregue · nova tentativa às 18:10",
      tone: "neutral",
    });
    expect(describeTrail(row(2, "delivered", null), new Map(), "America/Fortaleza")).toMatchObject({ text: "WhatsApp: Lembrete entregue (tentativa 2 de 3)", tone: "success" });
    expect(describeTrail(row(3, "failed", null), new Map(), "America/Fortaleza")).toMatchObject({ text: "WhatsApp: Lembrete não entregue (tentativa 3 de 3)", tone: "danger" });
  });
});

describe("mensagens do bot (cliente, 05/nov/2026)", () => {
  const failedAt = new Date("2026-11-05T17:34:00Z");

  it("3 tentativas: 30 s e 2 min depois da primeira falha", () => {
    expect(nextRetryAt(1, failedAt, true)).toEqual(new Date("2026-11-05T17:34:30Z"));
    const second = new Date("2026-11-05T17:34:30Z");
    expect(nextRetryAt(2, second, true)).toEqual(new Date("2026-11-05T17:36:00Z"));
    expect(nextRetryAt(3, second, true)).toBeNull();
  });

  it("entram no reenvio pelo contexto; sem ele, só os automáticos da lista", () => {
    expect(isRetryable("bot_idle_closed", botRetryContext(failedAt))).toBe(true);
    expect(isRetryable("bot_idle_closed", {})).toBe(false);
    expect(isRetryable("appointment_reminder", {})).toBe(true);
  });

  it("valem por 5 minutos", () => {
    expect(botRetryContext(failedAt)).toEqual({ bot: true, until: "2026-11-05T17:39:00.000Z" });
  });
});

describe("detalhes da falha e descarte (cliente, 05/nov/2026)", () => {
  const scheduledAt = new Date("2026-11-12T16:15:00Z");
  const base = { messageType: "appointment_reschedule", phone: "+5584999990000" };

  it("cada tentativa, o número e o motivo da Meta", () => {
    const messages = [
      { ...base, id: "a", status: "failed", createdAt: new Date("2026-11-03T13:38:00Z"), attempt: 1, failureCode: 131042, failureReason: "Business eligibility payment issue" },
    ];
    expect(failedSendDetails(messages, [], scheduledAt)).toEqual([
      {
        messageId: "a",
        eventId: null,
        messageType: "appointment_reschedule",
        phone: "+5584999990000",
        firstAt: new Date("2026-11-03T13:38:00Z"),
        attempts: [{ at: new Date("2026-11-03T13:38:00Z"), status: "failed" }],
        failureCode: 131042,
        failureReason: "Business eligibility payment issue",
        notSentReason: null,
        retrying: false,
        retryAt: null,
      },
    ]);
  });

  it("reenvios aparecem na mesma falha, da primeira à última tentativa", () => {
    const messages = [
      { ...base, id: "a", status: "failed", createdAt: new Date("2026-11-03T13:38:00Z"), attempt: 1 },
      { ...base, id: "b", firstAttemptId: "a", status: "failed", createdAt: new Date("2026-11-03T13:48:00Z"), attempt: 2 },
    ];
    const [detail] = failedSendDetails(messages, [], scheduledAt);
    expect(detail.messageId).toBe("b");
    expect(detail.firstAt).toEqual(new Date("2026-11-03T13:38:00Z"));
    expect(detail.attempts.map((t) => t.status)).toEqual(["failed", "failed"]);
  });

  it("descartada pelo Suporte: sai da lista, sem trazer de volta a tentativa anterior", () => {
    const messages = [
      { ...base, id: "a", status: "failed", createdAt: new Date("2026-11-03T13:38:00Z"), attempt: 1 },
      { ...base, id: "b", firstAttemptId: "a", status: "dismissed", createdAt: new Date("2026-11-03T13:48:00Z"), attempt: 2 },
    ];
    expect(countFailedSends(messages, [], scheduledAt)).toBe(0);
    expect(failedSendDetails(messages, [], scheduledAt)).toEqual([]);
  });

  it("'não enviado' da trilha: o motivo gravado", () => {
    const notSent = [{ id: 7, kind: "reminder", reason: "not_connected", scheduledAt, occurredAt: new Date("2026-11-11T21:00:00Z") }];
    expect(failedSendDetails([], notSent, scheduledAt)).toMatchObject([{ eventId: 7, messageId: null, messageType: "appointment_reminder", notSentReason: "not_connected" }]);
  });
});
