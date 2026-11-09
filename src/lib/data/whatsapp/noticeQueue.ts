import type { DbClient } from "../clients";
import { unwrap } from "../errors";
import { logError } from "../../log";
import { sendAppointmentNotice } from "./notices";
import type { ClinicSender } from "./send";

// Fila dos avisos do atendimento (F2c; proposta, seção 4 e cenário 15): a confirmação da marcação pelo portal entra
// na fila com chave única por atendimento e tipo e sai na hora; se a página caiu antes do envio, a rotina de minuto em
// minuto (a dos reenvios) manda. Cada linha é tomada por um só envio (pending → sending): no máximo uma confirmação
// sai. Envio que falhou segue o reenvio automático das mensagens (10 e 30 minutos), como os outros avisos.

export type QueuedNoticeKind = "confirmation";

/** Depois disto, quem tomou a linha e não terminou é deixado de lado (sem mandar de novo: pode ter saído). */
export const STUCK_AFTER_MS = 10 * 60_000;
/** A rotina só pega a linha pendente depois disto (o envio na hora tem a vez). */
export const PENDING_GRACE_MS = 30_000;

/** Põe o aviso na fila; o mesmo atendimento e tipo de novo não entra outra vez. */
export async function enqueueNotice(db: DbClient, clinicId: string, appointmentId: string, kind: QueuedNoticeKind, now: Date = new Date()): Promise<void> {
  unwrap(
    await db
      .from("notice_queue")
      .upsert({ clinic_id: clinicId, appointment_id: appointmentId, kind, created_at: now.toISOString() }, { onConflict: "appointment_id,kind", ignoreDuplicates: true }),
    "Fila de avisos",
  );
}

/** Toma a linha pendente e envia. false = outra execução já tomou (ou já saiu). Nunca lança. */
export async function dispatchNotice(
  db: DbClient,
  clinicId: string,
  appointmentId: string,
  kind: QueuedNoticeKind,
  sender: ClinicSender | null,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    const claimed = unwrap(
      await db
        .from("notice_queue")
        .update({ status: "sending", claimed_at: now.toISOString() })
        .eq("clinic_id", clinicId)
        .eq("appointment_id", appointmentId)
        .eq("kind", kind)
        .eq("status", "pending")
        .select("id"),
      "Fila de avisos",
    );
    if (!claimed.length) return false;
    const status = await sendAppointmentNotice(db, clinicId, appointmentId, kind, sender, now);
    unwrap(
      await db.from("notice_queue").update({ status, finished_at: new Date().toISOString() }).eq("id", claimed[0].id),
      "Fila de avisos",
    );
    return true;
  } catch (error) {
    logError("fila de avisos", error, { clinica: clinicId, atendimento: appointmentId });
    return false;
  }
}

/** Rotina (de minuto em minuto): manda o que ficou pendente e deixa de lado o que travou no meio do envio. */
export async function runNoticeQueue(db: DbClient, clinicId: string, sender: ClinicSender | null, now: Date = new Date()): Promise<{ sent: number; abandoned: number }> {
  const abandoned = unwrap(
    await db
      .from("notice_queue")
      .update({ status: "abandoned", finished_at: now.toISOString() })
      .eq("clinic_id", clinicId)
      .eq("status", "sending")
      .lt("claimed_at", new Date(now.getTime() - STUCK_AFTER_MS).toISOString())
      .select("id"),
    "Fila de avisos",
  );
  for (const row of abandoned) logError("fila de avisos: envio travado", new Error("aviso deixado de lado"), { clinica: clinicId, fila: row.id });

  const pending = unwrap(
    await db
      .from("notice_queue")
      .select("appointment_id, kind")
      .eq("clinic_id", clinicId)
      .eq("status", "pending")
      .lt("created_at", new Date(now.getTime() - PENDING_GRACE_MS).toISOString())
      .order("created_at")
      .limit(50),
    "Fila de avisos",
  );
  let sent = 0;
  for (const row of pending) if (await dispatchNotice(db, clinicId, row.appointment_id, row.kind as QueuedNoticeKind, sender, now)) sent++;
  return { sent, abandoned: abandoned.length };
}
