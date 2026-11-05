import type { Json } from "../../supabase/database.types";
import type { DbClient } from "../clients";
import { unwrap, unwrapOne } from "../errors";
import { logFunnelEvent, type FunnelFlow } from "./funnel";
import { isReturnToBotKeyword, messageBody, toE164, type WaMessage } from "./meta";
import { logError } from "../../log";

// Estado da conversa do bot e pausa da recepção (F3.9a), com a credencial da
// clínica. Uma conversa por número na clínica; o bot (F6) lê e troca o estado
// a cada mensagem. Só com o bot liberado (D11: o banco recusa criar conversa
// e gravar funil sem o item).
//
// Pausa da recepção: quando a recepção escreve pelo app do WhatsApp Business
// (eco), o paciente pede atendimento humano ou o bot não consegue seguir, o
// bot fica em silêncio. A conversa volta ao bot pelo "Finalizar atendimento"
// da tela Atendimento, pelo "#bot" da recepção ou pela rotina de 12 h
// (handoffReturn.ts), sempre sem mandar nada ao paciente (CA, cliente,
// 04/nov/2026; docs/ciclo-atendimento-humano.md).

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
  "WAITLIST_EARLIER",
  "WAITLIST_LEAVE_CONFIRM",
  // Depois do "Não" ao cancelar pelo lembrete: a tentativa de cancelar já terminou (F6.4).
  "PRESENCE_CONFIRM",
  HUMAN_HANDOFF,
]);

// ---------------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------------

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
  /** Mensagens seguidas que o bot não entendeu (F8.5d). */
  notUnderstoodCount: number;
  /** Assunto da transferência (jornada E4): quando o bot perguntou e a resposta. */
  handoffSubjectAskedAt: Date | null;
  handoffSubject: string | null;
  /** Situação com a clínica (CA); nula com o bot. */
  handoffStatus: HandoffStatus | null;
  /** Hora da última mudança de situação ou de responsável. */
  handoffStatusAt: Date | null;
};

/**
 * Situação da conversa com a clínica (CA, cliente, 04/nov/2026), guardada no banco: "Aguardando a clínica" ou "Em
 * atendimento" (a clínica respondeu). Só duas (com dezenas de conversas, três confundiriam). Cada mudança vira um
 * evento em `handoff_events` (gatilho no banco).
 */
export type HandoffStatus = "waiting_clinic" | "in_progress";
/** Quem mudou a situação ou o responsável. */
export type HandoffActor = "patient" | "reception" | "system" | "bot";

const COLUMNS = "id, contact_phone, contact_id, state, context, human_handoff, human_handoff_at, funnel_session_id, funnel_flow, updated_at, not_understood_count, handoff_subject_asked_at, handoff_subject, handoff_status, handoff_status_at";

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
  not_understood_count: number;
  handoff_subject_asked_at: string | null;
  handoff_subject: string | null;
  handoff_status: string | null;
  handoff_status_at: string | null;
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
  notUnderstoodCount: row.not_understood_count ?? 0,
  handoffSubjectAskedAt: row.handoff_subject_asked_at ? new Date(row.handoff_subject_asked_at) : null,
  handoffSubject: row.handoff_subject ?? null,
  handoffStatus: (row.handoff_status as HandoffStatus | null) ?? null,
  handoffStatusAt: row.handoff_status_at ? new Date(row.handoff_status_at) : null,
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
  flow: Exclude<FunnelFlow, "handoff" | "info">,
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

export type AbandonReason = "timeout" | "back_to_menu" | "secretary_took_over" | "reception_requested";

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

/**
 * Fim do atendimento humano (CA): a conversa volta ao bot, do começo (o paciente pode não lembrar onde parou), sem
 * mandar nada nem mostrar o menu; o bot só fala na próxima mensagem do paciente. O histórico fica. Só muda conversa
 * que está com a clínica (repetir não muda nada nem registra de novo); `expected`: só se a situação e a hora dela
 * ainda forem as lidas (a rotina de 12 h não encerra conversa que mudou nesse meio-tempo). true = voltou agora.
 */
export async function returnToBot(
  db: DbClient,
  clinicId: string,
  phone: string,
  { origin, now = new Date(), expected }: { origin: HandoffActor; now?: Date; expected?: { status: HandoffStatus; statusAt: Date } },
): Promise<boolean> {
  let query = db
    .from("conversation_state")
    .update({
      human_handoff: false,
      state: WELCOME,
      context: {},
      funnel_session_id: null,
      funnel_flow: null,
      not_understood_count: 0,
      handoff_status_at: now.toISOString(),
      handoff_changed_by: origin,
    })
    .eq("clinic_id", clinicId)
    .eq("contact_phone", phone)
    .eq("human_handoff", true);
  if (expected) query = query.eq("handoff_status", expected.status).eq("handoff_status_at", expected.statusAt.toISOString());
  const rows = unwrap(await query.select("id"), "Conversa do WhatsApp");
  return rows.length > 0;
}

/**
 * Mensagem do paciente (que não seja cortesia, C27) numa conversa com a clínica (CA): "Em atendimento" volta para
 * "Aguardando a clínica" (precisa de ação). O bot segue desligado. Chamada só para mensagem gravada agora (a repetida
 * pela Meta não muda nada).
 */
export async function markPatientWrote(db: DbClient, clinicId: string, phone: string, now: Date = new Date()): Promise<void> {
  unwrap(
    await db
      .from("conversation_state")
      .update({ handoff_status: "waiting_clinic", handoff_status_at: now.toISOString(), handoff_changed_by: "patient" })
      .eq("clinic_id", clinicId)
      .eq("contact_phone", phone)
      .eq("human_handoff", true)
      .eq("handoff_status", "in_progress"),
    "Conversa do WhatsApp",
  );
}

/** Mensagens seguidas que o bot não entendeu (F8.5d): soma ou zera depois de cada mensagem respondida. */
export async function setNotUnderstoodCount(db: DbClient, clinicId: string, phone: string, count: number): Promise<void> {
  unwrap(
    await db.from("conversation_state").update({ not_understood_count: count }).eq("clinic_id", clinicId).eq("contact_phone", phone),
    "Conversa do WhatsApp",
  );
}

/**
 * Depois de um aviso que não passa pelo bot (confirmação, lembrete…), a
 * conversa recomeça: uma resposta ao aviso não cai no meio de um fluxo antigo
 * (piloto). A pausa da recepção continua valendo. Sem conversa, nada muda.
 */
export async function resetConversationAfterNotice(db: DbClient, clinicId: string, phone: string): Promise<void> {
  const { error } = await db
    .from("conversation_state")
    .update({ state: WELCOME, context: {}, funnel_session_id: null, funnel_flow: null })
    .eq("clinic_id", clinicId)
    .eq("contact_phone", phone);
  if (error) logError("conversa: não recomeçou depois do aviso", error, { clinica: clinicId });
}

/** Mensagem do paciente numa conversa pausada: o bot fica calado até a conversa ser devolvida. */
export function checkHandoff(conversation: Conversation): "active" | "paused" {
  return conversation.humanHandoff ? "paused" : "active";
}

/**
 * Pausa o bot: a recepção assumiu (eco do app), o paciente pediu atendimento
 * humano ou um limite do contato barrou a marcação (F9.6a). Mensagens
 * seguintes da recepção só renovam o prazo; o funil conta o início de cada pausa, e a tentativa em andamento fica como abandono
 * ("secretária assumiu"). Número que nunca falou com o bot já nasce pausado.
 * Na pausa em andamento, o motivo e o início ficam.
 */
/**
 * De onde veio o pedido de recepção (cliente, 30/out/2026): opção do menu, ações do agendamento na entrada, data
 * não encontrada, botão de saída de uma resposta não entendida (C12) ou pedido digitado ("atendente").
 */
export type HandoffOrigin = "menu" | "entry_actions" | "identity_not_found" | "way_out" | "typed" | "kb_answer" | "not_completed";

export async function pauseForHuman(
  db: DbClient,
  clinicId: string,
  phone: string,
  {
    contactId,
    reason,
    origin,
    infoSessionId,
  }: {
    contactId: string | null;
    reason: "agent_took_over" | "requested" | "bot_limit" | "no_availability" | "not_understood";
    origin?: HandoffOrigin;
    /** Dúvida respondida pela base que levou ao pedido (EA): a taxa de resolução conta uma vez só. */
    infoSessionId?: string;
  },
  now: Date = new Date(),
): Promise<void> {
  const current = await getConversation(db, clinicId, phone);
  const pauseActive = !!current?.humanHandoff;
  // Situação (CA): pausa nova pela resposta da clínica já nasce "Em atendimento"; as outras, "Aguardando a clínica".
  // Na pausa em andamento, só a resposta da clínica muda: "Aguardando a clínica" vira "Em atendimento".
  const tookOver = reason === "agent_took_over";
  const status: HandoffStatus | null = !pauseActive
    ? tookOver
      ? "in_progress"
      : "waiting_clinic"
    : tookOver && current?.handoffStatus === "waiting_clinic"
      ? "in_progress"
      : null;

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
          // M3 das Métricas: a tentativa e a etapa da conversa no momento do pedido.
          ...(current?.funnelSessionId ? { journey_session_id: current.funnelSessionId } : {}),
          ...(current?.state ? { journey_state: current.state } : {}),
          ...(origin ? { origin } : {}),
          ...(infoSessionId ? { info_session_id: infoSessionId } : {}),
        },
      },
      now,
    );
  }
  if (current?.funnelSessionId && reason === "agent_took_over") {
    await logAbandonment(db, clinicId, current, "secretary_took_over", now);
  }
  // Pedido no meio de uma marcação, remarcação ou cancelamento (ex.: o botão de saída da C12): a tentativa para aqui.
  if (current?.funnelSessionId && reason === "requested") {
    await logAbandonment(db, clinicId, current, "reception_requested", now);
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
        not_understood_count: 0,
        // Atendimento humano (F8.5a): o motivo e o início são da pausa que começa; numa pausa em andamento, ficam.
        ...(pauseActive ? {} : { handoff_reason: reason, handoff_started_at: now.toISOString() }),
        ...(status
          ? { handoff_status: status, handoff_status_at: now.toISOString(), handoff_changed_by: tookOver ? "reception" : reason === "requested" ? "patient" : "bot" }
          : {}),
        funnel_session_id: null,
        funnel_flow: null,
      },
      { onConflict: "clinic_id,contact_phone" },
    ),
    "Conversa do WhatsApp",
  );
}

// ---------------------------------------------------------------------------
// Assunto da transferência (jornada E4, cliente, 31/out/2026; exceção da D12)
// ---------------------------------------------------------------------------

export const HANDOFF_SUBJECT_MAX = 300;

/** O bot perguntou o assunto: uma vez por pausa. false = já tinha perguntado (ou a conversa não está pausada). */
export async function markHandoffSubjectAsked(db: DbClient, clinicId: string, phone: string, now: Date = new Date()): Promise<boolean> {
  const row = unwrap(
    await db
      .from("conversation_state")
      .update({ handoff_subject_asked_at: now.toISOString() })
      .eq("clinic_id", clinicId)
      .eq("contact_phone", phone)
      .eq("human_handoff", true)
      .is("handoff_subject_asked_at", null)
      .select("id")
      .maybeSingle(),
    "Conversa do WhatsApp",
  );
  return row !== null;
}

/**
 * Motivo já contado ao bot antes da transferência (EA, cliente, 02/nov/2026): vira o assunto da pausa que acabou de
 * começar, e a pergunta do assunto fica como feita (não é repetida). Até 300 caracteres; nunca regrava.
 */
export async function setHandoffSubject(db: DbClient, clinicId: string, phone: string, text: string, now: Date = new Date()): Promise<void> {
  const subject = text.trim().slice(0, HANDOFF_SUBJECT_MAX);
  if (!subject) return;
  unwrap(
    await db
      .from("conversation_state")
      .update({ handoff_subject: subject, handoff_subject_asked_at: now.toISOString() })
      .eq("clinic_id", clinicId)
      .eq("contact_phone", phone)
      .eq("human_handoff", true)
      .is("handoff_subject", null),
    "Conversa do WhatsApp",
  );
}

/**
 * Primeira resposta em texto depois da pergunta vira o assunto, se a recepção
 * ainda não respondeu (depois disso é conversa, que fica no app). Guarda no
 * máximo 300 caracteres; nunca regrava. true = gravou.
 */
export async function recordHandoffSubject(db: DbClient, clinicId: string, convo: Conversation, text: string | null): Promise<boolean> {
  const subject = (text ?? "").trim().slice(0, HANDOFF_SUBJECT_MAX);
  if (!convo.humanHandoff || !convo.handoffSubjectAskedAt || convo.handoffSubject || !subject) return false;
  const replied = unwrap(
    await db
      .from("whatsapp_messages")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("contact_phone", convo.phone)
      .eq("message_type", "agent_reply")
      .gt("created_at", convo.handoffSubjectAskedAt.toISOString())
      .limit(1),
    "Mensagens do WhatsApp",
  );
  if (replied.length) return false;
  const row = unwrap(
    await db
      .from("conversation_state")
      .update({ handoff_subject: subject })
      .eq("clinic_id", clinicId)
      .eq("contact_phone", convo.phone)
      .eq("human_handoff", true)
      .is("handoff_subject", null)
      .select("id")
      .maybeSingle(),
    "Conversa do WhatsApp",
  );
  return row !== null;
}

// ---------------------------------------------------------------------------
// Mensagem automática do app (IS4; cliente, 03/nov/2026)
// ---------------------------------------------------------------------------

/** Tipo da mensagem do app que saiu sozinha (saudação, ausência): não conta como resposta da recepção. */
export const APP_AUTO_REPLY_TYPE = "app_auto_reply";
/** Eco do app até 5 s depois da mensagem do paciente ou do bot: mensagem automática, não gente. */
export const AUTO_REPLY_WINDOW_MS = 5_000;

/**
 * O eco do app parece mensagem automática (incidente da clínica piloto, 03/nov/2026: a mensagem de ausência saía
 * 2 a 3 s depois do "oi" e pausava o bot)? Só com a hora da Meta no eco (`timestamp`, sempre presente nos eventos
 * reais): até 5 s depois (ou 2 s antes, pelo relógio) de uma mensagem do paciente ou do bot naquela conversa.
 */
export async function isLikelyAutomaticEcho(db: DbClient, clinicId: string, echo: WaMessage, echoRecordId: string): Promise<boolean> {
  const phone = toE164(echo.to);
  const seconds = Number(echo.timestamp);
  if (!phone || !echo.timestamp || !Number.isFinite(seconds) || isReturnToBotKeyword(messageBody(echo))) return false;
  const at = seconds * 1000;
  const rows = unwrap(
    await db
      .from("whatsapp_messages")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("contact_phone", phone)
      .neq("id", echoRecordId)
      .or("direction.eq.inbound,message_type.like.bot_*")
      .gte("created_at", new Date(at - AUTO_REPLY_WINDOW_MS).toISOString())
      .lte("created_at", new Date(at + 2_000).toISOString())
      .limit(1),
    "Mensagens do WhatsApp",
  );
  return rows.length > 0;
}

/** O eco vira "mensagem automática do app": não pausa o bot e não conta como resposta da recepção. */
export async function markAutomaticEcho(db: DbClient, clinicId: string, echoRecordId: string): Promise<void> {
  unwrap(
    await db.from("whatsapp_messages").update({ message_type: APP_AUTO_REPLY_TYPE }).eq("clinic_id", clinicId).eq("id", echoRecordId),
    "Mensagem do WhatsApp",
  );
}

/** A última mensagem automática do app nos últimos `days` dias (aviso no Início e em Configurações › WhatsApp). */
export async function latestAutomaticEcho(db: DbClient, clinicId: string, now: Date = new Date(), days = 7): Promise<Date | null> {
  const rows = unwrap(
    await db
      .from("whatsapp_messages")
      .select("created_at")
      .eq("clinic_id", clinicId)
      .eq("message_type", APP_AUTO_REPLY_TYPE)
      .gte("created_at", new Date(now.getTime() - days * 24 * 60 * 60_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1),
    "Mensagens do WhatsApp",
  );
  return rows.length ? new Date(rows[0].created_at) : null;
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
  // "#bot" no app: a recepção finaliza o atendimento (CA), sem mensagem ao paciente.
  if (isReturnToBotKeyword(messageBody(echo))) {
    await returnToBot(db, clinicId, phone, { origin: "reception", now });
    return "returned_to_bot";
  }
  await pauseForHuman(db, clinicId, phone, { contactId, reason: "agent_took_over" }, now);
  return "paused";
}
