import type { DbClient } from "../clients";
import { unwrap } from "../errors";
import { getSupportWhatsapp } from "../platformSettings";
import { getConversation, returnToBot, type HandoffStatus } from "./conversations";

// Atendimento humano (F8.5a, cliente, 27/out/2026): as conversas em que o bot
// parou e a clínica precisa responder. Na coexistência tudo o que o bot fala
// aparece no app da recepção; esta lista diz, de relance, o que é com ela.
//
// A situação fica guardada na conversa (CA, cliente, 04/nov/2026; antes era
// calculada pela última mensagem): "Aguardando a clínica" (a pausa começou ou
// o paciente escreveu de novo; cortesia como "ok", "obrigado" ou 👍 não conta,
// C27) ou "Em atendimento" (a clínica respondeu pelo app). A conversa sai da
// lista com o "Finalizar atendimento", com o "#bot" ou, "Em atendimento", 12 h
// depois da última mensagem (handoffReturn.ts); sempre sem mandar nada.

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

/** Na tela: "waiting" = Aguardando a clínica; "in_progress" = Em atendimento. */
export type AttentionStatus = "waiting" | "in_progress";

const STATUS: Record<HandoffStatus, AttentionStatus> = { waiting_clinic: "waiting", in_progress: "in_progress" };

export type AttentionItem = {
  phone: string;
  contactId: string | null;
  name: string | null;
  reason: string | null;
  /** Assunto informado ao bot (jornada E4); `subjectAsked` sem assunto = "não informado". */
  subject: string | null;
  subjectAsked: boolean;
  startedAt: Date;
  status: AttentionStatus;
  /** Desde quando a clínica deve uma resposta (só em "Aguardando"). */
  waitingSince: Date | null;
  /** Hora da última mudança de situação (CA): a rotina de 12 h confere que não mudou. */
  statusAt: Date;
  lastAgentAt: Date | null;
  /** Última mensagem da conversa na pausa (paciente ou recepção pelo app). */
  lastActivityAt: Date;
  /** Última mensagem do paciente (janela de 24 h da Meta para texto livre). */
  lastPatientAt: Date | null;
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
  handoff_subject: string | null;
  handoff_subject_asked_at: string | null;
  handoff_status: string | null;
  handoff_status_at: string | null;
  contacts: { full_name: string } | null;
};

/**
 * Conversas pausadas da clínica, "Aguardando a clínica" primeiro (a mais antiga
 * no topo), depois "Em atendimento" (a mais recente no topo). `phone`: só a
 * conversa desse número.
 */
export async function listHumanAttention(
  db: DbClient,
  clinicId: string,
  phone?: string,
): Promise<AttentionItem[]> {
  // Em implantação nada é da recepção ainda (cliente, 29/out/2026): a lista começa ao ativar.
  const clinic = unwrap(await db.from("clinics").select("status").eq("id", clinicId).maybeSingle(), "Atendimento humano");
  if (!clinic || clinic.status === "onboarding") return [];

  let query = db
    .from("conversation_state")
    .select("contact_phone, contact_id, handoff_reason, handoff_started_at, human_handoff_at, handoff_notified_at, handoff_reminded_at, handoff_subject, handoff_subject_asked_at, handoff_status, handoff_status_at, contacts ( full_name )")
    .eq("clinic_id", clinicId)
    .eq("human_handoff", true);
  if (phone) query = query.eq("contact_phone", phone);
  const paused = unwrap(await query, "Atendimento humano") as unknown as PausedRow[];
  // O suporte do RecepClinic nunca aparece como pendência (cliente, 01/nov/2026).
  const support = await getSupportWhatsapp(db);
  const open = paused.filter((row) => row.human_handoff_at && row.contact_phone !== support).map((row) => ({ row }));
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

  const items = open.map(({ row }): AttentionItem => {
    const own = messages.filter((m) => m.contact_phone === row.contact_phone);
    const patient = own.filter((m) => m.direction === "inbound");
    const startedAt = new Date(row.handoff_started_at ?? row.human_handoff_at!);
    const agent = own.find((m) => m.message_type === "agent_reply" && new Date(m.created_at) >= startedAt);
    const lastAgentAt = agent ? new Date(agent.created_at) : null;
    // A situação guardada (CA); conversa sem ela (não deveria haver): aguardando desde o início.
    const status = STATUS[(row.handoff_status as HandoffStatus | null) ?? "waiting_clinic"] ?? "waiting";
    const statusAt = new Date(row.handoff_status_at ?? startedAt);
    const last = patient[0];
    const known = byPhone.get(row.contact_phone);
    const activity = [startedAt, statusAt, lastAgentAt, last ? new Date(last.created_at) : null].filter((t): t is Date => !!t);
    return {
      phone: row.contact_phone,
      contactId: row.contact_id ?? known?.id ?? null,
      name: row.contacts?.full_name ?? known?.full_name ?? null,
      reason: row.handoff_reason,
      subject: row.handoff_subject,
      subjectAsked: !!row.handoff_subject_asked_at,
      startedAt,
      status,
      waitingSince: status === "waiting" ? statusAt : null,
      statusAt,
      lastAgentAt,
      lastActivityAt: new Date(Math.max(...activity.map((t) => t.getTime()))),
      lastPatientAt: last ? new Date(last.created_at) : null,
      notifiedAt: row.handoff_notified_at ? new Date(row.handoff_notified_at) : null,
      remindedAt: row.handoff_reminded_at ? new Date(row.handoff_reminded_at) : null,
    };
  });

  const waiting = items.filter((i) => i.status === "waiting").sort((a, b) => a.waitingSince!.getTime() - b.waitingSince!.getTime());
  const inProgress = items.filter((i) => i.status === "in_progress").sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
  return [...waiting, ...inProgress];
}

/** Quantas conversas aguardam a clínica (contador do menu e do Início). */
export async function countAwaitingClinic(db: DbClient, clinicId: string): Promise<number> {
  return (await listHumanAttention(db, clinicId)).filter((item) => item.status === "waiting").length;
}

/**
 * "Finalizar atendimento" (CA, cliente, 04/nov/2026; era "Devolver ao bot"): o mesmo que o "#bot". O bot volta na
 * hora, sem mandar nada ao paciente nem mostrar o menu; o evento guarda quem finalizou (login da tela). false = a
 * conversa já não estava com a clínica (nada muda, nada é registrado de novo).
 */
export async function finishAttendance(
  db: DbClient,
  clinicId: string,
  phone: string,
  { now = new Date(), seenStatusAt }: { now?: Date; seenStatusAt?: Date | null } = {},
): Promise<"finished" | "already" | "patient_wrote"> {
  const current = await getConversation(db, clinicId, phone);
  if (!current?.humanHandoff || !current.handoffStatus || !current.handoffStatusAt) return "already";
  // O paciente escreveu depois que a tela foi aberta: a recepção confere antes (a mensagem não fica sem resposta).
  if (seenStatusAt && current.handoffStatus === "waiting_clinic" && current.handoffStatusAt.getTime() > seenStatusAt.getTime()) return "patient_wrote";
  // Só se nada mudou desde a leitura (uma mensagem que chega no mesmo instante não se perde).
  const finished = await returnToBot(db, clinicId, phone, { origin: "reception", now, expected: { status: current.handoffStatus, statusAt: current.handoffStatusAt } });
  if (finished) return "finished";
  const after = await getConversation(db, clinicId, phone);
  return after?.humanHandoff ? "patient_wrote" : "already";
}

// ---------------------------------------------------------------------------
// Pessoal e administrativo (NA5; cliente, 06/nov/2026, decisão 5): os números marcados, na tela Atendimento da clínica
// sem a Central. Sem o texto (só a Central guarda): número, tipo, hora da última mensagem e o aviso de mensagem nova.
// ---------------------------------------------------------------------------

export type ClassifiedItem = {
  phone: string;
  contactId: string | null;
  name: string | null;
  classification: "personal" | "administrative";
  classifiedAt: Date | null;
  classifiedBy: string | null;
  /** Última mensagem da conversa (do número ou da clínica). */
  lastMessageAt: Date | null;
  /** A última mensagem do número ainda sem resposta da clínica: "Mensagem nova". */
  hasNew: boolean;
};

type ClassifiedRow = {
  contact_phone: string;
  contact_id: string | null;
  classification: string;
  classified_at: string | null;
  classified_by: string | null;
  contacts: { full_name: string } | null;
};

/** Números marcados como Pessoal ou Administrativo/outros, a mensagem mais nova primeiro. */
export async function listClassifiedConversations(db: DbClient, clinicId: string): Promise<ClassifiedItem[]> {
  const rows = unwrap(
    await db
      .from("conversation_state")
      .select("contact_phone, contact_id, classification, classified_at, classified_by, contacts ( full_name )")
      .eq("clinic_id", clinicId)
      .neq("classification", "patient"),
    "Pessoal e administrativo",
  ) as unknown as ClassifiedRow[];
  if (rows.length === 0) return [];
  const phones = rows.map((row) => row.contact_phone);
  const messages = unwrap(
    await db
      .from("whatsapp_messages")
      .select("contact_phone, direction, message_type, created_at")
      .eq("clinic_id", clinicId)
      .in("contact_phone", phones)
      .order("created_at", { ascending: false })
      .limit(2000),
    "Pessoal e administrativo",
  );
  const items = rows.map((row): ClassifiedItem => {
    const mine = messages.filter((m) => m.contact_phone === row.contact_phone);
    const lastInbound = mine.find((m) => m.direction === "inbound");
    const lastReply = mine.find((m) => m.direction === "outbound" && (m.message_type === "agent_reply" || m.message_type === "panel_reply"));
    const classifiedAt = row.classified_at ? new Date(row.classified_at) : null;
    const inboundAt = lastInbound ? new Date(lastInbound.created_at) : null;
    return {
      phone: row.contact_phone,
      contactId: row.contact_id,
      name: row.contacts?.full_name ?? null,
      classification: row.classification === "administrative" ? "administrative" : "personal",
      classifiedAt,
      classifiedBy: row.classified_by,
      lastMessageAt: mine[0] ? new Date(mine[0].created_at) : null,
      hasNew: !!inboundAt && (!lastReply || inboundAt > new Date(lastReply.created_at)),
    };
  });
  return items.sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0));
}
