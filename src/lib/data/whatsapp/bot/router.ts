import type { DbClient } from "../../clients";
import { unwrap } from "../../errors";
import { hasFeature } from "../../features";
import {
  checkHandoff,
  IDLE_TIMEOUT_MINUTES,
  isPastIdleTimeout,
  logAbandonment,
  openConversation,
  setConversationState,
  setNotUnderstoodCount,
  WELCOME,
  type Conversation,
} from "../conversations";
import { contactIdByPhone, recordOutboundMessage } from "../messages";
import { toE164, type WaMessage } from "../meta";
import type { ClinicSender } from "../send";
import { BOOKING_STATES, handleBookingState } from "./booking";
import { createBot, currentPrompt, NotUnderstoodLimitReached, say, type Bot, type BotEnv } from "./engine";
import { ENTRY_STATES, handleEntryState, startConversation } from "./entry";
import { extractSelection, isBackToMenu } from "./input";
import { handleInfo, handleMenu, handlePreparationChoice, handleSubmenu, showMenu } from "./menus";
import { handleManageState, handleOfferTap, handleReminderTap, handoffNotUnderstood, MANAGE_STATES, offerTapOf, reminderTapOf } from "./manage";
import { BLOCKED_HANDOFF, BLOCKED_RECEPTION_WILL_CONTACT, IDLE_CLOSED } from "./texts";
import { blockedContactByPhone, blockedNoticeDue, markBlockedNotice } from "../contactBlock";
import { listBotMessages } from "../customMessages";
import { logError } from "../../../log";

// Entrada do bot (F6.3): chamado pelo webhook para cada mensagem recebida, já
// registrada. Só com o item "Bot de WhatsApp" liberado (D11) e o WhatsApp da
// clínica conectado. Conversa pausada pela recepção fica em silêncio, menos
// para os toques no lembrete (Confirmar) e na oferta de vaga, que respondem a
// uma pergunta do sistema (F6.4). Número bloqueado pela clínica (F9.6b): só
// os toques no lembrete e o fluxo que eles abrem (cancelar, remarcar); o resto
// recebe a resposta neutra, uma vez por dia. Nunca lança: o erro vai para o
// log e a Meta recebe 200 do mesmo jeito.

export async function handleIncomingMessage(env: BotEnv, message: WaMessage): Promise<"handled" | "skipped"> {
  const phone = toE164(message.from);
  if (!phone) return "skipped";
  if (!(await hasFeature(env.db, env.clinicId, "whatsapp_bot"))) return "skipped";

  let convo = await openConversation(env.db, env.clinicId, phone, await contactIdByPhone(env.db, env.clinicId, phone));
  const handoff = await checkHandoff(env.db, env.clinicId, convo, env.now);
  const paused = handoff === "paused";
  if (handoff === "resumed") convo = await openConversation(env.db, env.clinicId, phone, convo.contactId);

  // Toques em botões de template valem em qualquer ponto da conversa.
  const offerTap = offerTapOf(message);
  const reminderTap = reminderTapOf(message);
  if (offerTap || reminderTap) {
    const b = await createBot(env, convo, message.id ?? null);
    if (offerTap) await handleOfferTap(b, offerTap);
    else await handleReminderTap(b, reminderTap!, paused);
    return "handled";
  }
  if (paused) return "skipped";

  // Parada há mais de 15 minutos (a rotina costuma ter encerrado antes): recomeça.
  if (convo.state !== WELCOME && isPastIdleTimeout(convo.updatedAt, env.now)) {
    await logAbandonment(env.db, env.clinicId, convo, "timeout", env.now);
    convo = await setConversationState(env.db, env.clinicId, phone, WELCOME, { context: {} }, env.now);
    // Conversa nova: a contagem do "não entendi" recomeça (F8.5d).
    if (convo.notUnderstoodCount > 0) {
      await setNotUnderstoodCount(env.db, env.clinicId, phone, 0);
      convo = { ...convo, notUnderstoodCount: 0 };
    }
  }

  const b = await createBot(env, convo, message.id ?? null, message.type ?? null);
  try {
    await dispatch(env, b, convo, phone, message);
  } catch (error) {
    // 4ª mensagem seguida que o bot não entende (F8.5d): a conversa vai para a clínica.
    if (!(error instanceof NotUnderstoodLimitReached)) throw error;
    await handoffNotUnderstood(b);
    return "handled";
  }
  // Mensagens seguidas que o bot não entendeu (F8.5d): soma uma ou zera.
  const count = b.notUnderstoodSaid ? convo.notUnderstoodCount + 1 : 0;
  if (count !== convo.notUnderstoodCount) await setNotUnderstoodCount(env.db, env.clinicId, phone, count);
  return "handled";
}

/** Responde a mensagem conforme o ponto da conversa (o "não entendi" passa pelo motor, que conta). */
async function dispatch(env: BotEnv, b: Bot, convo: Conversation, phone: string, message: WaMessage): Promise<void> {
  const selection = extractSelection(message);

  const blocked = await blockedContactByPhone(env.db, env.clinicId, phone);
  if (blocked && (!MANAGE_STATES.has(convo.state) || isBackToMenu(selection))) {
    await answerBlocked(b, blocked);
    return;
  }

  // Toque numa lista ou botão de uma mensagem anterior (já respondida, ou de um passo que já passou):
  // não entendeu e o menu inicial (cliente, 23/out/2026). Os botões de template já foram tratados acima.
  const tapped = message.interactive?.list_reply ?? message.interactive?.button_reply;
  if (tapped && message.context?.id && message.context.id !== currentPrompt(convo)) {
    if (convo.state !== WELCOME && convo.state !== "MENU") await logAbandonment(env.db, env.clinicId, convo, "back_to_menu", env.now);
    await showMenu(b, { notUnderstood: !isBackToMenu(selection) });
    return;
  }

  // "Voltar ao menu" vale no meio de qualquer fluxo.
  if (convo.state !== WELCOME && convo.state !== "MENU" && isBackToMenu(selection)) {
    await logAbandonment(env.db, env.clinicId, convo, "back_to_menu", env.now);
    await showMenu(b);
    return;
  }

  if (ENTRY_STATES.has(convo.state)) {
    await handleEntryState(b, convo.state, selection);
    return;
  }
  if (MANAGE_STATES.has(convo.state)) {
    await handleManageState(b, convo.state, selection);
    return;
  }
  if (BOOKING_STATES.has(convo.state)) {
    await handleBookingState(b, convo.state, selection);
    return;
  }
  switch (convo.state) {
    case "MENU":
      await handleMenu(b, selection);
      break;
    case "CONSULTAS_MENU":
    case "EXAMES_MENU":
      await handleSubmenu(b, convo.state, selection);
      break;
    case "INFO_MENU":
      await handleInfo(b, selection);
      break;
    case "INFO_PREP_SELECT":
      await handlePreparationChoice(b, selection);
      break;
    default:
      // WELCOME, ou estado de outra versão do bot: começa do zero (com atendimento marcado, pergunta antes do menu).
      await startConversation(b);
  }
  return;
}

/** Número bloqueado: a resposta neutra na primeira mensagem do dia; a conversa fica no começo. */
async function answerBlocked(b: Bot, blocked: { id: string; lastNoticeAt: Date | null }): Promise<void> {
  if (b.convo.state !== WELCOME) {
    await logAbandonment(b.db, b.clinicId, b.convo, "back_to_menu", b.now);
    b.convo = await setConversationState(b.db, b.clinicId, b.phone, WELCOME, { context: {} }, b.now);
  }
  if (!blockedNoticeDue(blocked.lastNoticeAt, b.now, b.clinic.timeZone)) return;
  await say(b, "bot_contact_blocked", b.receptionAvailable ? BLOCKED_HANDOFF : BLOCKED_RECEPTION_WILL_CONTACT);
  await markBlockedNotice(b.db, b.clinicId, blocked.id, b.now);
}

// ---------------------------------------------------------------------------
// Conversa parada (cliente, 07/out)
// ---------------------------------------------------------------------------

/** Estados em que a conversa não está no meio de um atendimento. */
const AT_REST = [WELCOME, "HUMAN_HANDOFF"];

/**
 * Rotina de minuto em minuto (agendador do Supabase): conversa parada há 15
 * minutos no meio de um atendimento recebe o aviso de encerramento, volta ao
 * começo e o funil registra a desistência por tempo. Só conversas do último
 * dia (a janela de 24h da Meta). Devolve quantas encerrou.
 */
export async function closeIdleConversations(db: DbClient, clinicId: string, sender: ClinicSender | null, now: Date = new Date()): Promise<number> {
  if (!sender || !(await hasFeature(db, clinicId, "whatsapp_bot"))) return 0;
  // Texto próprio da clínica (F6.6), com o item liberado.
  const idleText = (await hasFeature(db, clinicId, "custom_messages")) ? ((await listBotMessages(db, clinicId)).get("idle_closed") ?? IDLE_CLOSED) : IDLE_CLOSED;
  const before = new Date(now.getTime() - IDLE_TIMEOUT_MINUTES * 60_000);
  const rows = unwrap(
    await db
      .from("conversation_state")
      .select("contact_phone")
      .eq("clinic_id", clinicId)
      .eq("human_handoff", false)
      .not("state", "in", `(${AT_REST.join(",")})`)
      .lt("updated_at", before.toISOString())
      .gt("updated_at", new Date(now.getTime() - 24 * 60 * 60_000).toISOString()),
    "Conversas paradas",
  );
  let closed = 0;
  for (const { contact_phone: phone } of rows) {
    try {
      const convo = await openConversation(db, clinicId, phone, await contactIdByPhone(db, clinicId, phone));
      // Respondeu enquanto a rotina rodava.
      if (AT_REST.includes(convo.state) || !isPastIdleTimeout(convo.updatedAt, now)) continue;
      const outcome = await sender.text(phone, idleText);
      await recordOutboundMessage(
        db,
        clinicId,
        {
          phone,
          contactId: convo.contactId,
          messageType: "bot_idle_closed",
          body: idleText,
          status: outcome.sent ? "sent" : "failed",
          waMessageId: outcome.sent ? outcome.messageId : null,
        },
        now,
      );
      await logAbandonment(db, clinicId, convo, "timeout", now);
      await setConversationState(db, clinicId, phone, WELCOME, { context: {} }, now);
      closed++;
    } catch (error) {
      logError("bot: conversa parada", error, { clinica: clinicId });
    }
  }
  return closed;
}
