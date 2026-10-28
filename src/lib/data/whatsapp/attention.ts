import { addDays, localDateOf } from "../../clinicTime";
import type { DbClient } from "../clients";
import { unwrap } from "../errors";
import { loadClinicHolidays } from "../agenda/slots";
import { handoffDeadline, returnToBot } from "./conversations";

// Atendimento humano (F8.5a, cliente, 27/out/2026): as conversas em que o bot
// parou e a clínica precisa responder. Na coexistência tudo o que o bot fala
// aparece no app da recepção; esta lista diz, de relance, o que é com ela.
//
// "Aguardando a clínica": a pausa começou e a clínica ainda não respondeu
// pelo app, ou o paciente escreveu de novo depois da última resposta.
// "Em atendimento": a clínica respondeu e o paciente não escreveu depois.
// A conversa sai da lista com o "#bot", com o "Devolver ao bot" ou quando o
// prazo da pausa vence (a conversa volta ao bot na próxima mensagem).

export type HandoffReason = "requested" | "agent_took_over" | "bot_limit" | "no_availability" | "not_understood";

export const HANDOFF_REASON_LABELS: Record<HandoffReason, string> = {
  requested: "Pediu para falar com a clínica",
  agent_took_over: "A clínica respondeu pelo app",
  bot_limit: "O bot atingiu um limite do contato",
  no_availability: "O bot não encontrou horário livre",
  not_understood: "O bot não entendeu as mensagens",
};

/** Motivo para a tela; pausa anterior à F8.5a não tem motivo gravado. */
export function handoffReasonLabel(reason: string | null): string {
  return reason && reason in HANDOFF_REASON_LABELS ? HANDOFF_REASON_LABELS[reason as HandoffReason] : "Atendimento pela clínica";
}

export type AttentionStatus = "waiting" | "in_progress";

/**
 * Situação de uma conversa pausada, pelas horas das mensagens do paciente e
 * das respostas da recepção pelo app desde o início da pausa.
 */
export function classifyAttention(
  startedAt: Date,
  patientTimes: Date[],
  agentTimes: Date[],
): { status: AttentionStatus; waitingSince: Date | null; lastAgentAt: Date | null } {
  const afterStart = (t: Date) => t.getTime() >= startedAt.getTime();
  const lastAgentAt = agentTimes.filter(afterStart).reduce<Date | null>((max, t) => (!max || t > max ? t : max), null);
  if (!lastAgentAt) return { status: "waiting", waitingSince: startedAt, lastAgentAt: null };
  const unanswered = patientTimes.filter((t) => t.getTime() > lastAgentAt.getTime());
  if (unanswered.length === 0) return { status: "in_progress", waitingSince: null, lastAgentAt };
  const first = unanswered.reduce((min, t) => (t < min ? t : min));
  return { status: "waiting", waitingSince: first, lastAgentAt };
}

export type AttentionItem = {
  phone: string;
  contactId: string | null;
  name: string | null;
  reason: string | null;
  startedAt: Date;
  status: AttentionStatus;
  /** Desde quando a clínica deve uma resposta (só em "Aguardando"). */
  waitingSince: Date | null;
  lastAgentAt: Date | null;
  /** Quando o bot volta sozinho, sem "#bot". */
  deadline: Date;
  /** Última mensagem da conversa na pausa (paciente ou recepção pelo app). */
  lastActivityAt: Date;
  /** Notificações (F8.5c): último aviso de "aguardando" e último lembrete do "#bot". */
  notifiedAt: Date | null;
  remindedAt: Date | null;
};

type PausedRow = {
  contact_phone: string;
  contact_id: string | null;
  handoff_reason: string | null;
  handoff_started_at: string | null;
  human_handoff_at: string | null;
  handoff_notified_at: string | null;
  handoff_reminded_at: string | null;
  contacts: { full_name: string } | null;
};

/**
 * Conversas pausadas da clínica, "Aguardando" primeiro (a mais antiga no topo),
 * depois "Em atendimento". `phone`: só a conversa desse número.
 */
export async function listHumanAttention(
  db: DbClient,
  clinicId: string,
  timeZone: string,
  now: Date = new Date(),
  phone?: string,
): Promise<AttentionItem[]> {
  let query = db
    .from("conversation_state")
    .select("contact_phone, contact_id, handoff_reason, handoff_started_at, human_handoff_at, handoff_notified_at, handoff_reminded_at, contacts ( full_name )")
    .eq("clinic_id", clinicId)
    .eq("human_handoff", true);
  if (phone) query = query.eq("contact_phone", phone);
  const paused = unwrap(await query, "Atendimento humano") as unknown as PausedRow[];
  const rows = paused.filter((row) => row.human_handoff_at);
  if (rows.length === 0) return [];

  // Prazo da pausa (vencido = a conversa já é do bot de novo, na próxima mensagem).
  const firstDay = rows.map((row) => localDateOf(new Date(row.human_handoff_at!), timeZone)).sort()[0];
  const holidays = await loadClinicHolidays(db, clinicId, firstDay, addDays(firstDay, 40));
  const open = rows
    .map((row) => ({ row, deadline: handoffDeadline(new Date(row.human_handoff_at!), timeZone, holidays) }))
    .filter(({ deadline }) => now.getTime() < deadline.getTime());
  if (open.length === 0) return [];

  const phones = open.map(({ row }) => row.contact_phone);
  const since = new Date(Math.min(...open.map(({ row }) => new Date(row.handoff_started_at ?? row.human_handoff_at!).getTime())) - 24 * 60 * 60_000);
  // Sem o texto: a conversa fica no app do WhatsApp (cliente, 28/out/2026, D12).
  const messages = unwrap(
    await db
      .from("whatsapp_messages")
      .select("contact_phone, direction, message_type, created_at")
      .eq("clinic_id", clinicId)
      .in("contact_phone", phones)
      .or("direction.eq.inbound,message_type.eq.agent_reply")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(2000),
    "Atendimento humano",
  );

  // Conversa sem contato ligado (ex.: a recepção escreveu primeiro): o nome pelo telefone.
  const unlinked = open.filter(({ row }) => !row.contact_id).map(({ row }) => row.contact_phone);
  const byPhone = new Map<string, { id: string; full_name: string }>();
  if (unlinked.length > 0) {
    const contacts = unwrap(
      await db.from("contacts").select("id, full_name, phone").eq("clinic_id", clinicId).in("phone", unlinked),
      "Atendimento humano",
    );
    for (const contact of contacts) byPhone.set(contact.phone, contact);
  }

  const items = open.map(({ row, deadline }): AttentionItem => {
    const own = messages.filter((m) => m.contact_phone === row.contact_phone);
    const patient = own.filter((m) => m.direction === "inbound");
    const agent = own.filter((m) => m.message_type === "agent_reply");
    const startedAt = new Date(row.handoff_started_at ?? row.human_handoff_at!);
    const situation = classifyAttention(
      startedAt,
      patient.map((m) => new Date(m.created_at)),
      agent.map((m) => new Date(m.created_at)),
    );
    const last = patient[0];
    const known = byPhone.get(row.contact_phone);
    const activity = [startedAt, situation.lastAgentAt, last ? new Date(last.created_at) : null].filter((t): t is Date => !!t);
    return {
      phone: row.contact_phone,
      contactId: row.contact_id ?? known?.id ?? null,
      name: row.contacts?.full_name ?? known?.full_name ?? null,
      reason: row.handoff_reason,
      startedAt,
      ...situation,
      deadline,
      lastActivityAt: new Date(Math.max(...activity.map((t) => t.getTime()))),
      notifiedAt: row.handoff_notified_at ? new Date(row.handoff_notified_at) : null,
      remindedAt: row.handoff_reminded_at ? new Date(row.handoff_reminded_at) : null,
    };
  });

  const waiting = items.filter((i) => i.status === "waiting").sort((a, b) => a.waitingSince!.getTime() - b.waitingSince!.getTime());
  const inProgress = items.filter((i) => i.status === "in_progress").sort((a, b) => b.lastAgentAt!.getTime() - a.lastAgentAt!.getTime());
  return [...waiting, ...inProgress];
}

/** Quantas conversas aguardam a clínica (contador do menu e do Início). */
export async function countAwaitingClinic(db: DbClient, clinicId: string, timeZone: string, now: Date = new Date()): Promise<number> {
  return (await listHumanAttention(db, clinicId, timeZone, now)).filter((item) => item.status === "waiting").length;
}

/**
 * "Devolver ao bot" (cliente, 27/out/2026): o mesmo que o "#bot", sem mandar
 * nada ao paciente. false = a conversa já não estava com a clínica.
 */
export async function giveBackToBot(db: DbClient, clinicId: string, phone: string): Promise<boolean> {
  const paused = unwrap(
    await db.from("conversation_state").select("id").eq("clinic_id", clinicId).eq("contact_phone", phone).eq("human_handoff", true).maybeSingle(),
    "Atendimento humano",
  );
  if (!paused) return false;
  await returnToBot(db, clinicId, phone);
  return true;
}
