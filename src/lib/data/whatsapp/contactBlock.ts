import { localDateOf } from "../../clinicTime";
import { cancelAppointments } from "../agenda/appointments";
import type { DbClient } from "../clients";
import { unwrap, unwrapOne } from "../errors";
import { leaveWaitlist } from "../waitlist/entries";

// Bloquear contato (F9.6b; cliente, 09 e 10/out/2026). Só o Administrador (o
// banco confere). O bot deixa de atender o número: responde neutro, uma vez
// por dia, e só os botões do lembrete seguem. Ao bloquear, os pacientes do
// contato saem da lista de espera; com a opção marcada, os atendimentos
// futuros deles são cancelados sem aviso (não gasta template; a vaga volta
// para a lista de espera) e as séries terminam (o agendador não cria mais
// sessões). Desbloquear não desfaz nada disso. A equipe marca pelo painel
// normalmente.

export type ContactBlock = { blockedAt: Date; blockedBy: string | null; reason: string | null };

export async function getContactBlock(db: DbClient, clinicId: string, contactId: string): Promise<ContactBlock | null> {
  const row = unwrapOne(
    await db.from("contacts").select("bot_blocked_at, bot_blocked_by, bot_blocked_reason").eq("clinic_id", clinicId).eq("id", contactId).maybeSingle(),
    "Contato",
  );
  return row.bot_blocked_at ? { blockedAt: new Date(row.bot_blocked_at), blockedBy: row.bot_blocked_by, reason: row.bot_blocked_reason } : null;
}

async function contactPatientIds(db: DbClient, clinicId: string, contactId: string): Promise<string[]> {
  return unwrap(await db.from("patients").select("id").eq("clinic_id", clinicId).eq("contact_id", contactId), "Pacientes do contato").map((r) => r.id);
}

/** Atendimentos marcados ou confirmados, ainda por vir, de todos os pacientes do contato. */
export async function listContactFutureAppointmentIds(db: DbClient, clinicId: string, contactId: string, now: Date = new Date()): Promise<string[]> {
  const patientIds = await contactPatientIds(db, clinicId, contactId);
  if (!patientIds.length) return [];
  const rows = unwrap(
    await db
      .from("appointments")
      .select("id")
      .eq("clinic_id", clinicId)
      .in("patient_id", patientIds)
      .in("status", ["scheduled", "confirmed"])
      .gt("scheduled_at", now.toISOString())
      .order("scheduled_at"),
    "Atendimentos do contato",
  );
  return rows.map((r) => r.id);
}

export type BlockResult = { canceled: number; seriesEnded: number; leftWaitlist: number };

export async function blockContact(
  db: DbClient,
  clinicId: string,
  contactId: string,
  { reason, cancelFuture }: { reason: string | null; cancelFuture: boolean },
  actorId: string | null,
  now: Date = new Date(),
): Promise<BlockResult> {
  unwrap(
    await db.rpc("set_contact_bot_blocked", { p_clinic_id: clinicId, p_contact_id: contactId, p_blocked: true, p_reason: reason ?? undefined }),
    "Bloquear contato",
  );

  const future = await listContactFutureAppointmentIds(db, clinicId, contactId, now);
  let leftWaitlist = 0;
  if (future.length) {
    const entries = unwrap(
      await db.from("waitlist_entries").select("appointment_id").eq("clinic_id", clinicId).eq("status", "active").in("appointment_id", future),
      "Lista de espera",
    );
    for (const { appointment_id: appointmentId } of entries) {
      if (await leaveWaitlist(db, clinicId, appointmentId, { channel: "admin", actorId }, now)) leftWaitlist++;
    }
  }
  if (!cancelFuture) return { canceled: 0, seriesEnded: 0, leftWaitlist };

  const patientIds = await contactPatientIds(db, clinicId, contactId);
  const ended = patientIds.length
    ? unwrap(
        await db
          .from("appointment_series")
          .update({ ended_at: now.toISOString(), ended_by: actorId })
          .eq("clinic_id", clinicId)
          .in("patient_id", patientIds)
          .is("ended_at", null)
          .select("id"),
        "Séries do contato",
      )
    : [];
  const { canceled } = await cancelAppointments(db, clinicId, future, { channel: "admin", actorId }, now);
  return { canceled: canceled.length, seriesEnded: ended.length, leftWaitlist };
}

export async function unblockContact(db: DbClient, clinicId: string, contactId: string): Promise<void> {
  unwrap(await db.rpc("set_contact_bot_blocked", { p_clinic_id: clinicId, p_contact_id: contactId, p_blocked: false }), "Desbloquear contato");
}

/** Resposta neutra ao número bloqueado: uma por dia, no dia da clínica. */
export function blockedNoticeDue(lastNoticeAt: Date | null, now: Date, timeZone: string): boolean {
  return !lastNoticeAt || localDateOf(lastNoticeAt, timeZone) !== localDateOf(now, timeZone);
}

/** Contato bloqueado do número (mesmo desativado), com a hora da última resposta neutra. */
export async function blockedContactByPhone(db: DbClient, clinicId: string, phone: string): Promise<{ id: string; lastNoticeAt: Date | null } | null> {
  const row = unwrap(
    await db
      .from("contacts")
      .select("id, bot_blocked_notified_at")
      .eq("clinic_id", clinicId)
      .eq("phone", phone)
      .not("bot_blocked_at", "is", null)
      .maybeSingle(),
    "Contato",
  );
  return row ? { id: row.id, lastNoticeAt: row.bot_blocked_notified_at ? new Date(row.bot_blocked_notified_at) : null } : null;
}

export async function markBlockedNotice(db: DbClient, clinicId: string, contactId: string, now: Date): Promise<void> {
  unwrap(await db.from("contacts").update({ bot_blocked_notified_at: now.toISOString() }).eq("clinic_id", clinicId).eq("id", contactId), "Contato");
}
