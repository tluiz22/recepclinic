import { describe, expect, it } from "vitest";
import { parsePreparationResendOutcome } from "./preparation";
import {
  isAutoResendDue,
  parseReminderTap,
  parseResendOutcome,
  reminderAction,
  reminderButtonPayload,
  reminderCutoff,
  reminderWindow,
  type ReminderState,
} from "./reminders";

const TZ = "America/Fortaleza";
const at = (iso: string) => new Date(`${iso}-03:00`);
const ID = "0a0f0000-0000-4000-8000-000000000001";

const appointment = (overrides: Partial<ReminderState> = {}): ReminderState => ({
  scheduledAt: at("2026-10-15T10:00:00"),
  reminderSentAt: null,
  rescheduledAt: null,
  reminderResponse: null,
  patientConfirmedAt: null,
  ...overrides,
});

describe("hora e dia do lembrete, no calendário da clínica", () => {
  it("é a hora do lembrete na véspera", () => {
    expect(reminderCutoff(at("2026-10-15T10:00:00"), 14, TZ)).toEqual(at("2026-10-14T14:00:00"));
    // 23h em Fortaleza já é o dia seguinte em UTC: vale o dia da clínica.
    expect(reminderCutoff(at("2026-10-14T23:00:00"), 9, TZ)).toEqual(at("2026-10-13T09:00:00"));
    // Dia 1º: véspera no mês anterior.
    expect(reminderCutoff(at("2026-11-01T10:00:00"), 18, TZ)).toEqual(at("2026-10-31T18:00:00"));
  });

  it("segue o fuso da clínica", () => {
    // 15/10 às 10h em Manaus (UTC-4): lembrete às 14h de Manaus do dia 14.
    expect(reminderCutoff(new Date("2026-10-15T14:00:00Z"), 14, "America/Manaus")).toEqual(new Date("2026-10-14T18:00:00Z"));
  });

  it("cobre o dia seguinte inteiro", () => {
    expect(reminderWindow(at("2026-10-14T14:05:00"), TZ)).toEqual({ start: at("2026-10-15T00:00:00"), end: at("2026-10-16T00:00:00") });
    expect(reminderWindow(at("2026-10-14T23:30:00"), TZ)).toEqual({ start: at("2026-10-15T00:00:00"), end: at("2026-10-16T00:00:00") });
  });
});

describe("botão do lembrete na tela", () => {
  const hour = 14;

  it("Enviar: sem tentativa, só depois do envio automático da véspera", () => {
    expect(reminderAction(appointment(), [], hour, TZ, at("2026-10-14T13:59:00"))).toBeNull();
    expect(reminderAction(appointment(), [], hour, TZ, at("2026-10-14T14:00:00"))).toBe("send");
  });

  it("Reenviar: a última tentativa não chegou (falhou, sem template ou não marcada como lembrada)", () => {
    const now = at("2026-10-14T15:00:00");
    expect(reminderAction(appointment(), [{ status: "failed", createdAt: at("2026-10-14T14:00:00") }], hour, TZ, now)).toBe("resend");
    expect(reminderAction(appointment(), [{ status: "skipped_no_template", createdAt: at("2026-10-14T14:00:00") }], hour, TZ, now)).toBe("resend");
    // A Meta avisou a falha depois do envio aceito.
    const sent = appointment({ reminderSentAt: at("2026-10-14T14:00:00") });
    expect(reminderAction(sent, [{ status: "sent", createdAt: at("2026-10-14T14:00:00") }, { status: "failed", createdAt: at("2026-10-14T14:30:00") }], hour, TZ, now)).toBe("resend");
  });

  it("Reenviar sem resposta: entregue há 2h ou mais, sem botão tocado nem presença", () => {
    const sent = appointment({ reminderSentAt: at("2026-10-14T14:00:00") });
    const attempts = [{ status: "read", createdAt: at("2026-10-14T14:00:00") }];
    expect(reminderAction(sent, attempts, hour, TZ, at("2026-10-14T15:59:00"))).toBeNull();
    expect(reminderAction(sent, attempts, hour, TZ, at("2026-10-14T16:00:00"))).toBe("resend_unanswered");
    expect(reminderAction({ ...sent, reminderResponse: "reschedule" }, attempts, hour, TZ, at("2026-10-14T16:00:00"))).toBeNull();
    expect(reminderAction({ ...sent, patientConfirmedAt: at("2026-10-14T15:00:00") }, attempts, hour, TZ, at("2026-10-14T16:00:00"))).toBeNull();
  });

  it("tentativas da data antiga não contam depois da remarcação", () => {
    const rescheduled = appointment({ rescheduledAt: at("2026-10-14T15:00:00") });
    const old = [{ status: "failed", createdAt: at("2026-10-14T14:00:00") }];
    expect(reminderAction(rescheduled, old, hour, TZ, at("2026-10-14T16:00:00"))).toBe("send");
  });
});

describe("reenvio automático", () => {
  const sent = appointment({ scheduledAt: at("2026-10-15T16:00:00"), reminderSentAt: at("2026-10-14T14:00:00") });
  const delivered = [{ status: "delivered", createdAt: at("2026-10-14T14:00:00") }];

  it("4h depois do lembrete entregue, sem resposta", () => {
    expect(isAutoResendDue(sent, delivered, 0, TZ, at("2026-10-14T17:59:00"))).toBe(false);
    expect(isAutoResendDue(sent, delivered, 0, TZ, at("2026-10-14T18:00:00"))).toBe(true);
  });

  it("só entre 7h e 20h da clínica", () => {
    expect(isAutoResendDue(sent, delivered, 0, TZ, at("2026-10-14T20:59:00"))).toBe(true);
    expect(isAutoResendDue(sent, delivered, 0, TZ, at("2026-10-14T21:00:00"))).toBe(false);
    expect(isAutoResendDue(sent, delivered, 0, TZ, at("2026-10-15T06:59:00"))).toBe(false);
    expect(isAutoResendDue(sent, delivered, 0, TZ, at("2026-10-15T07:00:00"))).toBe(true);
  });

  it("não para atendimento a menos de 2h, nem com resposta, nem depois do botão ou de outro reenvio", () => {
    expect(isAutoResendDue(sent, delivered, 0, TZ, at("2026-10-15T14:00:00"))).toBe(false);
    expect(isAutoResendDue(sent, delivered, 0, TZ, at("2026-10-15T13:59:00"))).toBe(true);
    expect(isAutoResendDue({ ...sent, reminderResponse: "confirmed" }, delivered, 0, TZ, at("2026-10-14T18:00:00"))).toBe(false);
    expect(isAutoResendDue(sent, delivered, 1, TZ, at("2026-10-14T18:00:00"))).toBe(false);
    const twice = [...delivered, { status: "delivered", createdAt: at("2026-10-14T15:00:00") }];
    expect(isAutoResendDue(sent, twice, 0, TZ, at("2026-10-14T19:00:00"))).toBe(false);
    expect(isAutoResendDue(sent, [{ status: "failed", createdAt: at("2026-10-14T14:00:00") }], 0, TZ, at("2026-10-14T18:00:00"))).toBe(false);
  });
});

describe("botões do template e avisos da tela", () => {
  it("o payload diz o botão e o atendimento", () => {
    expect(parseReminderTap(reminderButtonPayload("confirm", ID))).toEqual({ button: "confirm", appointmentId: ID });
    expect(parseReminderTap(`reminder:apagar:${ID}`)).toBeNull();
    expect(parseReminderTap("reminder:cancel:123")).toBeNull();
    expect(parseReminderTap(undefined)).toBeNull();
  });

  it("achado 4: só os códigos próprios viram aviso", () => {
    expect(parseResendOutcome("not_connected")).toBe("not_connected");
    expect(parsePreparationResendOutcome("no_template")).toBe("no_template");
    for (const inherited of ["toString", "constructor", "__proto__", ""]) {
      expect(parseResendOutcome(inherited)).toBeNull();
      expect(parsePreparationResendOutcome(inherited)).toBeNull();
    }
    expect(parseResendOutcome(null)).toBeNull();
  });
});
