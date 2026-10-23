import type { DbClient } from "../clients";
import { unwrap } from "../errors";
import { holdOfferForRetry, isOfferAwaitingSend, markOfferSent, skipOfferAfterRetries } from "../waitlist/offers";
import { recordOutboundMessage, type SendOutcome } from "./messages";
import { MAX_ATTEMPTS, isTechnicalCode, nextRetryAt, RETRYABLE_MESSAGE_TYPES, type RetryContext } from "./retryRules";
import type { ClinicSender } from "./send";

// Reenvio automático de envios com falha técnica (cliente, 23/out/2026): de
// minuto em minuto (/api/cron/reenvios), as tentativas previstas saem com o
// mesmo pedido à Meta, depois de conferir que o envio ainda faz sentido
// (atendimento sem mudança, oferta de pé, resumo do dia ainda valendo, nota
// emitida). Cada tentativa é uma mensagem nova, ligada à primeira; um envio
// novo do mesmo tipo, pela tela ou pela rotina, toma o lugar da tentativa
// (recordOutboundMessage). A falha avisada depois pelo webhook também agenda.

/** Tentativas por clínica numa rodada: com a Meta fora do ar, o resto fica para o minuto seguinte. */
const MAX_PER_RUN = 50;

const ACTIVE = new Set(["scheduled", "confirmed"]);
/** Avisos e envios do atendimento que só valem com ele ativo e na mesma data. */
const ACTIVE_APPOINTMENT_TYPES = new Set([
  "appointment_reminder",
  "appointment_confirmation",
  "appointment_reschedule",
  "exam_preparation",
  "consultation_guidance",
  "waitlist_offer",
]);
const CANCELLATION_TYPES = new Set(["appointment_cancellation", "appointment_mass_cancellation"]);

type RetryPayload = { request: Record<string, unknown>; context: RetryContext };

type DueRow = {
  id: string;
  appointment_id: string | null;
  contact_id: string | null;
  contact_phone: string;
  message_type: string;
  template_name: string | null;
  body: string | null;
  attempt: number;
  first_attempt_id: string | null;
  retry_payload: RetryPayload | null;
};

export type RetryRunTotals = { due: number; sent: number; failed: number; gaveUp: number; dropped: number };

export async function runSendRetries(db: DbClient, clinicId: string, sender: ClinicSender | null, now: Date = new Date()): Promise<RetryRunTotals> {
  const totals: RetryRunTotals = { due: 0, sent: 0, failed: 0, gaveUp: 0, dropped: 0 };
  const due = unwrap(
    await db
      .from("whatsapp_messages")
      .select("id, appointment_id, contact_id, contact_phone, message_type, template_name, body, attempt, first_attempt_id, retry_payload")
      .eq("clinic_id", clinicId)
      .not("retry_at", "is", null)
      .lte("retry_at", now.toISOString())
      .order("retry_at")
      .limit(MAX_PER_RUN),
    "Reenvios",
  ) as unknown as DueRow[];
  totals.due = due.length;

  for (const row of due) {
    // Reserva a tentativa: duas rodadas ao mesmo tempo não reenviam duas vezes.
    const claimed = unwrap(
      await db.from("whatsapp_messages").update({ retry_at: null }).eq("clinic_id", clinicId).eq("id", row.id).not("retry_at", "is", null).select("id"),
      "Reenvios",
    );
    if (claimed.length === 0) continue;

    const payload = row.retry_payload;
    // WhatsApp desconectado agora: não é falha técnica, as tentativas acabam.
    if (!payload || !sender?.resend || !(await stillMakesSense(db, clinicId, row, payload.context, now))) {
      await giveUp(db, clinicId, payload?.context ?? {}, "o envio deixou de valer antes da nova tentativa");
      totals.dropped++;
      continue;
    }

    let outcome: SendOutcome;
    try {
      outcome = await sender.resend(payload.request, row.body ?? "");
    } catch (error) {
      outcome = { sent: false, reason: error instanceof Error ? error.message : String(error) };
    }
    const attempt = row.attempt + 1;
    const messageId = await recordOutboundMessage(
      db,
      clinicId,
      {
        phone: row.contact_phone,
        contactId: row.contact_id,
        appointmentId: row.appointment_id,
        messageType: row.message_type,
        templateName: row.template_name,
        body: row.body,
        status: outcome.sent ? "sent" : "failed",
        waMessageId: outcome.sent ? outcome.messageId : null,
        retry: { outcome, context: payload.context },
        attempt,
        firstAttemptId: row.first_attempt_id ?? row.id,
      },
      now,
    );
    // O pedido fica só na tentativa mais nova.
    unwrap(await db.from("whatsapp_messages").update({ retry_payload: null }).eq("clinic_id", clinicId).eq("id", row.id), "Reenvios");

    if (row.message_type === "nfse_document") {
      unwrap(
        await db.rpc("nfse_delivery_follow_retry", {
          p_previous_message_id: row.id,
          p_message_id: messageId,
          p_sent: outcome.sent,
          p_error: outcome.sent ? "" : outcome.reason,
        }),
        "Envio da nota",
      );
    }

    if (outcome.sent) {
      totals.sent++;
      await afterSent(db, clinicId, row, payload.context, outcome.messageId, now);
    } else if (outcome.failure?.technical && attempt < MAX_ATTEMPTS) {
      totals.failed++;
      if (payload.context.offerId) await holdOfferForRetry(db, clinicId, payload.context.offerId, attempt, now);
    } else {
      totals.gaveUp++;
      await giveUp(db, clinicId, payload.context, outcome.reason);
    }
  }
  return totals;
}

/** O envio ainda faz sentido agora? */
async function stillMakesSense(db: DbClient, clinicId: string, row: DueRow, context: RetryContext, now: Date): Promise<boolean> {
  if (!RETRYABLE_MESSAGE_TYPES.has(row.message_type)) return false;
  if (context.until && now.getTime() >= Date.parse(context.until)) return false;

  if (ACTIVE_APPOINTMENT_TYPES.has(row.message_type) || CANCELLATION_TYPES.has(row.message_type)) {
    if (!row.appointment_id) return false;
    const appointment = unwrap(
      await db.from("appointments").select("status, scheduled_at").eq("clinic_id", clinicId).eq("id", row.appointment_id).maybeSingle(),
      "Atendimento",
    );
    if (!appointment) return false;
    if (CANCELLATION_TYPES.has(row.message_type)) {
      if (appointment.status !== "canceled") return false;
    } else {
      if (!ACTIVE.has(appointment.status) || Date.parse(appointment.scheduled_at) <= now.getTime()) return false;
      if (context.scheduledAt && Date.parse(appointment.scheduled_at) !== Date.parse(context.scheduledAt)) return false;
    }
  }

  if (row.message_type === "waitlist_offer") return !!context.offerId && (await isOfferAwaitingSend(db, clinicId, context.offerId));
  if (row.message_type === "nfse_document") {
    if (!context.invoiceId) return false;
    return unwrap(await db.rpc("nfse_invoice_issued_for_retry", { p_invoice_id: context.invoiceId }), "Nota fiscal") === true;
  }
  return true;
}

/** O que muda quando o reenvio sai. */
async function afterSent(db: DbClient, clinicId: string, row: DueRow, context: RetryContext, waMessageId: string, now: Date): Promise<void> {
  if (row.message_type === "appointment_reminder" && row.appointment_id) {
    // Conta como lembrado (como no envio da rotina).
    unwrap(
      await db.from("appointments").update({ reminder_sent_at: now.toISOString() }).eq("clinic_id", clinicId).eq("id", row.appointment_id).is("reminder_sent_at", null),
      "Atendimento",
    );
  }
  if (context.offerId) await markOfferSent(db, clinicId, context.offerId, waMessageId, now);
}

/** As tentativas acabaram: a mensagem fica "Não entregue" (aba Envios); a oferta de vaga segue para a fila. */
async function giveUp(db: DbClient, clinicId: string, context: RetryContext, reason: string): Promise<void> {
  if (context.offerId) await skipOfferAfterRetries(db, clinicId, context.offerId, reason);
}

/**
 * Falha avisada depois pela Meta (webhook "failed"): grava o motivo e, se for
 * técnica, agenda a próxima tentativa como na falha na hora. Não agenda se um
 * envio do mesmo tipo já saiu depois (pela tela ou pela rotina).
 */
export async function scheduleRetryAfterLateFailure(
  db: DbClient,
  clinicId: string,
  messageId: string,
  error: { code: number | null; title: string | null },
  now: Date = new Date(),
): Promise<boolean> {
  const row = unwrap(
    await db
      .from("whatsapp_messages")
      .select("id, appointment_id, contact_phone, message_type, attempt, created_at, retry_payload")
      .eq("clinic_id", clinicId)
      .eq("id", messageId)
      .maybeSingle(),
    "Mensagem do WhatsApp",
  ) as { id: string; appointment_id: string | null; contact_phone: string; message_type: string; attempt: number; created_at: string; retry_payload: RetryPayload | null } | null;
  if (!row) return false;

  const technical = isTechnicalCode(error.code);
  const retryAt = technical && row.retry_payload && RETRYABLE_MESSAGE_TYPES.has(row.message_type) ? nextRetryAt(row.attempt, now) : null;
  const newer = retryAt ? await hasNewerSend(db, clinicId, row) : false;
  const schedule = retryAt && !newer;
  unwrap(
    await db
      .from("whatsapp_messages")
      .update({
        failure_code: error.code,
        failure_reason: error.title?.slice(0, 300) ?? null,
        retry_at: schedule ? retryAt.toISOString() : null,
        ...(schedule ? {} : { retry_payload: null }),
      })
      .eq("clinic_id", clinicId)
      .eq("id", row.id),
    "Mensagem do WhatsApp",
  );
  const offerId = row.retry_payload?.context.offerId;
  if (offerId && row.message_type === "waitlist_offer" && !newer) {
    if (schedule) await holdOfferForRetry(db, clinicId, offerId, row.attempt, now);
    // Falha técnica na última tentativa: a vaga segue para a fila (a não técnica fica como antes, até vencer).
    else if (technical) await skipOfferAfterRetries(db, clinicId, offerId, error.title ?? "a Meta não entregou a oferta");
  }
  return !!schedule;
}

async function hasNewerSend(
  db: DbClient,
  clinicId: string,
  row: { id: string; appointment_id: string | null; contact_phone: string; message_type: string; created_at: string },
): Promise<boolean> {
  let query = db
    .from("whatsapp_messages")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("direction", "outbound")
    .eq("message_type", row.message_type)
    .gt("created_at", row.created_at)
    .neq("id", row.id);
  query = row.appointment_id ? query.eq("appointment_id", row.appointment_id) : query.is("appointment_id", null).eq("contact_phone", row.contact_phone);
  return unwrap(await query.limit(1), "Mensagem do WhatsApp").length > 0;
}
