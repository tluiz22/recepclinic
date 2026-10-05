import { addDays, localDateOf, localTimeOf, toInstant, weekdayOf } from "../../clinicTime";
import { isNationalHoliday } from "../../holidays";
import type { Json } from "../../supabase/database.types";
import type { DbClient } from "../clients";
import { unwrap, unwrapOne } from "../errors";
import { loadClinicHolidays } from "../agenda/slots";
import { logFunnelEvent, type FunnelFlow } from "./funnel";
import { isReturnToBotKeyword, messageBody, toE164, type WaMessage } from "./meta";

// Estado da conversa do bot e pausa da recepção (F3.9a), com a credencial da
// clínica. Uma conversa por número na clínica; o bot (F6) lê e troca o estado
// a cada mensagem. Só com o bot liberado (D11: o banco recusa criar conversa
// e gravar funil sem o item).
//
// Pausa da recepção: quando a recepção escreve pelo app do WhatsApp Business
// (eco) ou o paciente pede atendimento humano, o bot fica em silêncio. A pausa
// vale 24h desde a última mensagem da recepção; se o prazo cair em sábado,
// domingo ou feriado da clínica (nacional ou próprio), passa para o próximo
// dia útil no mesmo horário, no fuso da clínica (cliente, 05/out/2026; no
// piloto, feriado não contava). Vencido o prazo, a próxima mensagem do
// paciente devolve a conversa ao bot; "#bot" da recepção devolve antes.

export const HANDOFF_HOURS = 24;
/** Conversa parada fora do repouso por mais que isso recomeça do zero (piloto). */
export const IDLE_TIMEOUT_MINUTES = 15;

export const WELCOME = "WELCOME";
export const HUMAN_HANDOFF = "HUMAN_HANDOFF";

/**
 * Estados fora de qualquer fluxo do funil (piloto): entrar num deles encerra
 * a tentativa em andamento. A lista acompanha o bot (F6).
 */
export const NON_FUNNEL_STATES = new Set([
  WELCOME,
  "MENU",
  "CONSULTAS_MENU",
  "EXAMES_MENU",
  "INFO_MENU",
  "INFO_PREP_SELECT",
  "WAITLIST_SELECT",
  "WAITLIST_LEAVE_CONFIRM",
  HUMAN_HANDOFF,
]);

// ---------------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------------

/** Dia sem atendimento para o prazo da pausa: fim de semana ou feriado. */
function isOffDay(date: string, clinicHolidays: Set<string>): boolean {
  const weekday = weekdayOf(date);
  return weekday === 0 || weekday === 6 || isNationalHoliday(date) || clinicHolidays.has(date);
}

/** Até quantos dias seguidos sem atendimento o prazo pula (contra laço sem fim). */
const MAX_OFF_DAYS = 31;

/**
 * Fim da pausa iniciada (ou renovada) em `handoffAt`: 24h depois; caindo em
 * fim de semana ou feriado, o próximo dia útil no mesmo horário da clínica.
 */
export function handoffDeadline(handoffAt: Date, timeZone: string, clinicHolidays: Set<string>): Date {
  const plain = new Date(handoffAt.getTime() + HANDOFF_HOURS * 60 * 60_000);
  let date = localDateOf(plain, timeZone);
  if (!isOffDay(date, clinicHolidays)) return plain;

  const time = localTimeOf(plain, timeZone);
  // Segundos que o "HH:mm" deixa de fora.
  const remainder = plain.getTime() - toInstant(date, time, timeZone).getTime();
  for (let i = 0; i < MAX_OFF_DAYS && isOffDay(date, clinicHolidays); i++) date = addDays(date, 1);
  return new Date(toInstant(date, time, timeZone).getTime() + remainder);
}

export function isPastIdleTimeout(lastUpdatedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - lastUpdatedAt.getTime() >= IDLE_TIMEOUT_MINUTES * 60_000;
}

// ---------------------------------------------------------------------------
// Conversa
// ---------------------------------------------------------------------------

export type Conversation = {
  id: string;
  phone: string;
  contactId: string | null;
  state: string;
  context: Record<string, unknown>;
  humanHandoff: boolean;
  humanHandoffAt: Date | null;
  funnelSessionId: string | null;
  funnelFlow: FunnelFlow | null;
  updatedAt: Date;
};

const COLUMNS = "id, contact_phone, contact_id, state, context, human_handoff, human_handoff_at, funnel_session_id, funnel_flow, updated_at";

type Row = {
  id: string;
  contact_phone: string;
  contact_id: string | null;
  state: string;
  context: Json;
  human_handoff: boolean;
  human_handoff_at: string | null;
  funnel_session_id: string | null;
  funnel_flow: string | null;
  updated_at: string;
};

const toConversation = (row: Row): Conversation => ({
  id: row.id,
  phone: row.contact_phone,
  contactId: row.contact_id,
  state: row.state,
  context: (row.context ?? {}) as Record<string, unknown>,
  humanHandoff: row.human_handoff,
  humanHandoffAt: row.human_handoff_at ? new Date(row.human_handoff_at) : null,
  funnelSessionId: row.funnel_session_id,
  funnelFlow: row.funnel_flow as FunnelFlow | null,
  updatedAt: new Date(row.updated_at),
});

export async function getConversation(db: DbClient, clinicId: string, phone: string): Promise<Conversation | null> {
  const row = unwrap(
    await db.from("conversation_state").select(COLUMNS).eq("clinic_id", clinicId).eq("contact_phone", phone).maybeSingle(),
    "Conversa do WhatsApp",
  );
  return row ? toConversation(row) : null;
}

/** Conversa do número (criada em WELCOME na primeira mensagem), com o contato quando ele já existe. */
export async function openConversation(
  db: DbClient,
  clinicId: string,
  phone: string,
  contactId: string | null,
): Promise<Conversation> {
  unwrap(
    await db
      .from("conversation_state")
      .upsert({ clinic_id: clinicId, contact_phone: phone, contact_id: contactId }, { onConflict: "clinic_id,contact_phone", ignoreDuplicates: true }),
    "Conversa do WhatsApp",
  );
  const conversation = (await getConversation(db, clinicId, phone))!;
  // O número virou contato depois que a conversa começou.
  if (contactId && conversation.contactId !== contactId) {
    unwrap(
      await db.from("conversation_state").update({ contact_id: contactId }).eq("id", conversation.id),
      "Conversa do WhatsApp",
    );
    conversation.contactId = contactId;
  }
  return conversation;
}

/**
 * Troca o estado (toda troca passa por aqui, como no piloto): dentro de uma
 * tentativa do funil, cada estado alcançado vira um passo; entrar num estado
 * fora do funil encerra a tentativa.
 */
export async function setConversationState(
  db: DbClient,
  clinicId: string,
  phone: string,
  state: string,
  { context, contactId }: { context?: Record<string, unknown>; contactId?: string | null } = {},
  now: Date = new Date(),
): Promise<Conversation> {
  const endsFunnel = NON_FUNNEL_STATES.has(state);
  const row = unwrapOne(
    await db
      .from("conversation_state")
      .update({
        state,
        ...(context !== undefined ? { context: context as NonNullable<Json> } : {}),
        ...(contactId !== undefined ? { contact_id: contactId } : {}),
        ...(endsFunnel ? { funnel_session_id: null, funnel_flow: null } : {}),
      })
      .eq("clinic_id", clinicId)
      .eq("contact_phone", phone)
      .select(COLUMNS)
      .maybeSingle(),
    "Conversa do WhatsApp",
  );
  const conversation = toConversation(row);
  if (!endsFunnel && conversation.funnelSessionId && conversation.funnelFlow) {
    await logFunnelEvent(
      db,
      clinicId,
      { sessionId: conversation.funnelSessionId, flow: conversation.funnelFlow, step: state, phone, contactId: conversation.contactId },
      now,
    );
  }
  return conversation;
}

/** Abre uma tentativa nova do funil na conversa e grava "started". */
export async function startFunnel(
  db: DbClient,
  clinicId: string,
  phone: string,
  flow: Exclude<FunnelFlow, "handoff">,
  metadata: Record<string, unknown> = {},
  now: Date = new Date(),
): Promise<string> {
  const sessionId = crypto.randomUUID();
  const row = unwrapOne(
    await db
      .from("conversation_state")
      .update({ funnel_session_id: sessionId, funnel_flow: flow })
      .eq("clinic_id", clinicId)
      .eq("contact_phone", phone)
      .select("contact_id")
      .maybeSingle(),
    "Conversa do WhatsApp",
  );
  await logFunnelEvent(db, clinicId, { sessionId, flow, step: "started", phone, contactId: row.contact_id, metadata }, now);
  return sessionId;
}

/** Passo avulso (resultado, bloqueio) na tentativa em andamento, se houver. */
export async function logFunnelStep(
  db: DbClient,
  conversation: Pick<Conversation, "phone" | "contactId" | "funnelSessionId" | "funnelFlow">,
  clinicId: string,
  step: string,
  metadata: Record<string, unknown> = {},
  now: Date = new Date(),
): Promise<void> {
  if (!conversation.funnelSessionId || !conversation.funnelFlow) return;
  await logFunnelEvent(
    db,
    clinicId,
    {
      sessionId: conversation.funnelSessionId,
      flow: conversation.funnelFlow,
      step,
      phone: conversation.phone,
      contactId: conversation.contactId,
      metadata,
    },
    now,
  );
}

export type AbandonReason = "timeout" | "back_to_menu" | "secretary_took_over";

/** Tentativa interrompida (sem resultado): grava "abandoned" com o motivo e o último estado. */
export async function logAbandonment(
  db: DbClient,
  clinicId: string,
  conversation: Pick<Conversation, "phone" | "contactId" | "funnelSessionId" | "funnelFlow" | "state">,
  reason: AbandonReason,
  now: Date = new Date(),
): Promise<void> {
  await logFunnelStep(db, conversation, clinicId, "abandoned", { reason, last_step: conversation.state }, now);
}

// ---------------------------------------------------------------------------
// Pausa da recepção
// ---------------------------------------------------------------------------

async function clinicTimeZone(db: DbClient, clinicId: string): Promise<string> {
  const row = unwrapOne(
    await db.from("clinic_settings").select("timezone").eq("clinic_id", clinicId).maybeSingle(),
    "Configuração da clínica",
  );
  return row.timezone;
}

/** Fim da pausa da conversa no calendário da clínica (null = sem pausa). */
export async function getHandoffDeadline(db: DbClient, clinicId: string, conversation: Conversation): Promise<Date | null> {
  if (!conversation.humanHandoff || !conversation.humanHandoffAt) return null;
  const timeZone = await clinicTimeZone(db, clinicId);
  const from = localDateOf(conversation.humanHandoffAt, timeZone);
  const holidays = await loadClinicHolidays(db, clinicId, from, addDays(from, MAX_OFF_DAYS + 2));
  return handoffDeadline(conversation.humanHandoffAt, timeZone, holidays);
}

/** Devolve a conversa ao bot, do começo (o paciente pode não lembrar onde parou). */
export async function returnToBot(db: DbClient, clinicId: string, phone: string): Promise<void> {
  unwrap(
    await db
      .from("conversation_state")
      .update({ human_handoff: false, state: WELCOME, context: {}, funnel_session_id: null, funnel_flow: null })
      .eq("clinic_id", clinicId)
      .eq("contact_phone", phone),
    "Conversa do WhatsApp",
  );
}

/**
 * Mensagem do paciente numa conversa pausada: `paused` = o bot fica calado;
 * `resumed` = o prazo venceu e a conversa voltou ao bot (do começo); `active`
 * = não estava pausada.
 */
export async function checkHandoff(
  db: DbClient,
  clinicId: string,
  conversation: Conversation,
  now: Date = new Date(),
): Promise<"active" | "paused" | "resumed"> {
  if (!conversation.humanHandoff) return "active";
  const deadline = await getHandoffDeadline(db, clinicId, conversation);
  if (deadline && now.getTime() < deadline.getTime()) return "paused";
  await returnToBot(db, clinicId, conversation.phone);
  return "resumed";
}

/**
 * Pausa o bot: a recepção assumiu (eco do app) ou o paciente pediu atendimento
 * humano. Mensagens seguintes da recepção só renovam o prazo; o funil conta
 * o início de cada pausa, e a tentativa em andamento fica como abandono
 * ("secretária assumiu"). Número que nunca falou com o bot já nasce pausado.
 */
export async function pauseForHuman(
  db: DbClient,
  clinicId: string,
  phone: string,
  { contactId, reason }: { contactId: string | null; reason: "agent_took_over" | "requested" },
  now: Date = new Date(),
): Promise<void> {
  const current = await getConversation(db, clinicId, phone);
  const deadline = current ? await getHandoffDeadline(db, clinicId, current) : null;
  const pauseActive = !!deadline && now.getTime() < deadline.getTime();

  if (!pauseActive) {
    await logFunnelEvent(
      db,
      clinicId,
      {
        sessionId: crypto.randomUUID(),
        flow: "handoff",
        step: reason,
        phone,
        contactId: current?.contactId ?? contactId,
        metadata: {
          mid_journey: !!current?.funnelSessionId,
          ...(current?.funnelFlow ? { journey_flow: current.funnelFlow } : {}),
        },
      },
      now,
    );
  }
  if (current?.funnelSessionId && reason === "agent_took_over") {
    await logAbandonment(db, clinicId, current, "secretary_took_over", now);
  }

  unwrap(
    await db.from("conversation_state").upsert(
      {
        clinic_id: clinicId,
        contact_phone: phone,
        contact_id: current?.contactId ?? contactId,
        state: HUMAN_HANDOFF,
        context: {},
        human_handoff: true,
        human_handoff_at: now.toISOString(),
        funnel_session_id: null,
        funnel_flow: null,
      },
      { onConflict: "clinic_id,contact_phone" },
    ),
    "Conversa do WhatsApp",
  );
}

/**
 * Eco de uma mensagem da recepção pelo app (já registrada, recordAgentEcho):
 * "#bot" devolve a conversa ao bot; qualquer outra mensagem pausa o bot
 * naquele número (por isso as mensagens automáticas do app precisam estar
 * desligadas).
 */
export async function handleAgentEcho(
  db: DbClient,
  clinicId: string,
  echo: WaMessage,
  contactId: string | null,
  now: Date = new Date(),
): Promise<"returned_to_bot" | "paused" | "ignored"> {
  const phone = toE164(echo.to);
  if (!phone) return "ignored";
  if (isReturnToBotKeyword(messageBody(echo))) {
    await returnToBot(db, clinicId, phone);
    return "returned_to_bot";
  }
  await pauseForHuman(db, clinicId, phone, { contactId, reason: "agent_took_over" }, now);
  return "paused";
}
