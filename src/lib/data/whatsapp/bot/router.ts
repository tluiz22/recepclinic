import type { DbClient } from "../../clients";
import { unwrap } from "../../errors";
import { hasFeature } from "../../features";
import {
  checkHandoff,
  IDLE_TIMEOUT_MINUTES,
  isClassifiedOut,
  isPastIdleTimeout,
  logAbandonment,
  markHandoffSubjectAsked,
  openConversation,
  pauseForHuman,
  recordHandoffSubject,
  setConversationState,
  setNotUnderstoodCount,
  WELCOME,
  type Conversation,
} from "../conversations";
import { contactIdByPhone, recordOutboundMessage } from "../messages";
import { botRetryContext } from "../retryRules";
import { messageBody, toE164, type WaMessage } from "../meta";
import type { ClinicSender } from "../send";
import { askHandoffSubject, createBot, currentPrompt, go, KnowledgeTakeover, mergeContext, NotUnderstoodLimitReached, offerReception, RECEPTION_CONFIRM_KEY, say, sendButtons, type Bot, type BotEnv, type ReceptionOffer } from "./engine";
import { asksForReception, extractSelection, isBack, isBackToMenu, TALK_TO_RECEPTION_ID, yesNo } from "./input";
import { handleMenu, handlePreparationChoice, showMenu, showPreviousMenu, startConversation } from "./menus";
import { handleOfferTap, handleReminderTap, handoff, handoffNotUnderstood, handoffText, offerTapOf, reminderTapOf } from "./manage";
import {
  BLOCKED_HANDOFF,
  BLOCKED_RECEPTION_WILL_CONTACT,
  IDLE_CLOSED,
  NOT_UNDERSTOOD_OFFER,
  RECEPTION_CONFIRM,
  RECEPTION_CONFIRM_BUTTONS,
  RECEPTION_CONFIRM_IDS,
  RECEPTION_DECLINED,
  RECEPTION_DECLINED_NO_MENU,
  RECEPTION_NOW_ID,
  willReply,
} from "./texts";
import { blockedContactByPhone, blockedNoticeDue, markBlockedNotice } from "../contactBlock";
import { listBotMessages } from "../customMessages";
import { askReceptionReason, firstMessageAnswer, handleKnowledgeReply, handleReceptionReason, knowledgeHookFor, pendingReasonOf, performTakeover, REASON_KEY } from "./knowledge/respond";
import { logError } from "../../../log";
import { isCourtesyMessage } from "../courtesy";
import { followsRecentProof, hasRecentCompletedAppointment, isPaymentProof, PROOF_CONTEXT_KEY, proofFileNameOf, proofTextOf } from "./paymentProof";

// Entrada do bot (F6.3): chamado pelo webhook para cada mensagem recebida, já
// registrada. Só com o item "Bot de WhatsApp" liberado (D11) e o WhatsApp da
// clínica conectado. Conversa pausada pela recepção fica em silêncio, menos
// para os toques no lembrete (Confirmar) e na oferta de vaga, que respondem a
// uma pergunta do sistema (F6.4). Número bloqueado pela clínica (F9.6b): só
// os toques no lembrete; o resto recebe a resposta neutra, uma vez por dia. Nunca lança: o erro vai para o
// log e a Meta recebe 200 do mesmo jeito. Número marcado como Pessoal ou
// Administrativo/outros (NA): como o pausado, sem o bot e sem pausa.
// Mudou o caminho do paciente: atualizar o fluxograma em
// src/components/admin/tecnologia/botJourney.ts (Tecnologia › Jornada do bot).

export async function handleIncomingMessage(env: BotEnv, message: WaMessage): Promise<"handled" | "skipped"> {
  const phone = toE164(message.from);
  if (!phone) return "skipped";
  if (!(await hasFeature(env.db, env.clinicId, "whatsapp_bot"))) return "skipped";

  let convo = await openConversation(env.db, env.clinicId, phone, await contactIdByPhone(env.db, env.clinicId, phone));
  const paused = checkHandoff(convo) === "paused";

  // Toques em botões de template valem em qualquer ponto da conversa.
  const offerTap = offerTapOf(message);
  const reminderTap = reminderTapOf(message);
  if (offerTap || reminderTap) {
    const b = await createBot(env, convo, message.id ?? null);
    if (offerTap) await handleOfferTap(b, offerTap);
    else await handleReminderTap(b, reminderTap!, paused);
    return "handled";
  }
  // Número marcado como Pessoal ou Administrativo/outros (NA, decisões 2 e 4): o bot não responde. Só seguem os
  // botões do lembrete e da oferta (acima) e o fluxo que eles abrem (cancelar, remarcar, lista de espera).
  if (isClassifiedOut(convo)) return "skipped";
  if (paused) {
    // Assunto da transferência (jornada E4): a primeira resposta em texto depois da pergunta, guardada sem resposta do
    // bot (cliente, 06/nov/2026); o resto fica com a recepção.
    if (message.type === "text" && (await recordHandoffSubject(env.db, env.clinicId, convo, messageBody(message)))) return "handled";
    return "skipped";
  }

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

  // Cortesia (BE-8, cliente, 11/nov/2026): "ok", "obrigado", 👍 ou reação depois do menu, de um link ou de uma
  // orientação não tem resposta, sem prazo e sem encerrar a conversa. Com pedido junto, não é cortesia (segue o caminho).
  if (isCourtesyMessage(message) && (await courtesyNeedsNoReply(env.db, env.clinicId, convo))) return "skipped";

  // Comprovante de pagamento (cliente, 12/nov/2026): foto ou PDF de quem pagou na recepção fica sem resposta, só nesta
  // mensagem (e anexos nos 10 min seguintes); a conversa segue com o bot e a secretária vê o anexo nas Conversas.
  if (await isProofWithoutReply(env, convo, message)) {
    await setConversationState(env.db, env.clinicId, phone, convo.state, { context: { ...convo.context, [PROOF_CONTEXT_KEY]: env.now.toISOString() } }, env.now);
    return "skipped";
  }

  const b = await createBot(env, convo, message.id ?? null, message.type ?? null);
  // Base de conhecimento (BC, Etapa 4): texto digitado, ou toque numa mensagem dela, fora dos passos de texto livre.
  b.incomingText = message.type === "text" ? (messageBody(message) ?? "").trim() || null : null;
  const kbTap = /^kb_/.test(extractSelection(message).id ?? "");
  if ((b.incomingText || kbTap) && !FREE_TEXT_AWAITING.has(awaitingOf(convo) ?? "")) b.knowledge = await knowledgeHookFor(b);
  try {
    await dispatch(env, b, convo, phone, message);
  } catch (error) {
    if (error instanceof KnowledgeTakeover) {
      await performTakeover(b, error.action);
    } else {
      // 4ª mensagem seguida que o bot não entende (F8.5d): pergunta se quer a recepção (cliente, 31/out/2026).
      if (!(error instanceof NotUnderstoodLimitReached)) throw error;
      await offerReception(b, { kind: "bot_handoff_not_understood", reason: "not_understood" }, NOT_UNDERSTOOD_OFFER);
      return "handled";
    }
  }
  // Mensagens seguidas que o bot não entendeu (F8.5d): soma uma ou zera.
  // Saudação: a contagem fica como está (alternar "oi" com o que o bot não entende não evita a oferta da recepção).
  const count = b.notUnderstoodSaid ? convo.notUnderstoodCount + 1 : b.keepNotUnderstoodCount ? convo.notUnderstoodCount : 0;
  if (count !== convo.notUnderstoodCount) await setNotUnderstoodCount(env.db, env.clinicId, phone, count);
  return "handled";
}

/** Conversa parada (começo ou menu) e mensagem reconhecida como comprovante (regras em paymentProof.ts). */
async function isProofWithoutReply(env: BotEnv, convo: Conversation, message: WaMessage): Promise<boolean> {
  if (!["image", "document", "text"].includes(message.type ?? "")) return false;
  const idle = convo.state === WELCOME || convo.state === "MENU";
  if (!idle) return false;
  const base = { type: message.type ?? null, text: proofTextOf(message), fileName: proofFileNameOf(message), idle, followsRecentProof: followsRecentProof(convo.context, env.now) };
  // A consulta só é lida quando as palavras sozinhas não decidem.
  if (isPaymentProof({ ...base, recentCompletedAppointment: false })) return true;
  if (!isPaymentProof({ ...base, recentCompletedAppointment: true })) return false;
  return hasRecentCompletedAppointment(env.db, env.clinicId, convo.contactId, env.now);
}

/**
 * Mensagens do bot depois das quais a cortesia fica sem resposta (BE-8): o menu, os links do portal e as orientações
 * que fecham um assunto. Depois de uma pergunta (Sim/Não, "Você quis dizer…?", lista de preparo), de um template ou da
 * recepção, responde (na dúvida, responde).
 */
const COURTESY_SILENT_AFTER = /^bot_(?:menu|portal_\w+|reminder_(?:reschedule|cancel)_link|kb_will_reply|kb_resolved|idle_closed|presence_(?:confirmed|already_confirmed|location)|appointment_inactive|info_preparation)$/;

async function courtesyNeedsNoReply(db: DbClient, clinicId: string, convo: Conversation): Promise<boolean> {
  if (convo.state !== WELCOME && convo.state !== "MENU") return false;
  const last = unwrap(
    await db
      .from("whatsapp_messages")
      .select("message_type")
      .eq("clinic_id", clinicId)
      .eq("contact_phone", convo.phone)
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "Última mensagem enviada",
  );
  return !!last && COURTESY_SILENT_AFTER.test(last.message_type);
}

/** Responde a mensagem conforme o ponto da conversa (o "não entendi" passa pelo motor, que conta). */
const AUDIO_TYPES = new Set(["audio", "voice"]);

/** Passos em que qualquer texto é a resposta (nome e endereço): o pedido digitado de recepção não vale neles. */
const FREE_TEXT_AWAITING = new Set(["address_input", "contact_name", "patient_name", "self_name"]);
const awaitingOf = (convo: Conversation) => ((convo.context ?? {}) as { awaiting?: string }).awaiting;

/** Pedido de recepção digitado esperando o Sim ou o Não (no contexto, sem trocar o passo). */
const receptionConfirmPending = (convo: Conversation) => !!((convo.context ?? {}) as Record<string, unknown>)[RECEPTION_CONFIRM_KEY];
/** Transferência oferecida pelo bot (sem horário, convênio, "não entendi"…), e não o pedido digitado. */
const receptionOfferOf = (convo: Conversation) => {
  const value = ((convo.context ?? {}) as Record<string, unknown>)[RECEPTION_CONFIRM_KEY];
  return typeof value === "object" && value !== null ? (value as ReceptionOffer) : null;
};

/** Sim à transferência oferecida: a pausa de antes, com o motivo dela. */
async function acceptReceptionOffer(b: Bot, offer: ReceptionOffer): Promise<void> {
  if (offer.reason === "not_understood") return handoffNotUnderstood(b);
  await say(b, offer.kind, b.receptionAvailable ? await handoffText(b) : willReply(b.clinic.designation));
  await pauseForHuman(b.db, b.clinicId, b.phone, { contactId: b.convo.contactId, reason: offer.reason }, b.now);
  // BE-4: o aviso já pede a dúvida; sem a recepção no app, a pergunta do assunto.
  if (b.receptionAvailable) await markHandoffSubjectAsked(b.db, b.clinicId, b.phone, b.now);
  else await askHandoffSubject(b);
}

/** Não à transferência oferecida: o menu; na clínica sem nada para marcar, a despedida (cliente, 31/out/2026). */
async function declineReceptionOffer(b: Bot, offer: ReceptionOffer): Promise<void> {
  if (offer.noMenu) {
    await say(b, "bot_reception_declined", RECEPTION_DECLINED_NO_MENU);
    return go(b, WELCOME);
  }
  await say(b, "bot_reception_declined", RECEPTION_DECLINED);
  return showMenu(b);
}

async function dispatch(env: BotEnv, b: Bot, convo: Conversation, phone: string, message: WaMessage): Promise<void> {
  const selection = extractSelection(message);

  const blocked = await blockedContactByPhone(env.db, env.clinicId, phone);
  if (blocked) {
    await answerBlocked(b, blocked);
    return;
  }

  // Toque numa lista ou botão de uma mensagem anterior (já respondida, ou de um passo que já passou):
  // não entendeu e o menu inicial (cliente, 23/out/2026). Os botões de template já foram tratados acima.
  const tapped = message.interactive?.list_reply ?? message.interactive?.button_reply;
  const stale = !!(tapped && message.context?.id && message.context.id !== currentPrompt(convo));

  // "Marcar" e "Você quis dizer…?" da base de conhecimento: a escolha responde e o passo se repete.
  if (b.knowledge && !stale && (await handleKnowledgeReply(b, selection)) === "handled") return;

  if (stale) {
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

  // "voltar" digitado (cliente, 31/out/2026): o menu de onde veio, nunca o retorno da base.
  if (isBack(selection)) {
    if (convo.state === WELCOME) return startConversation(b);
    if (convo.funnelSessionId) await logAbandonment(env.db, env.clinicId, convo, "back_to_menu", env.now);
    return showPreviousMenu(b);
  }

  // "Falar com a recepção" em qualquer passo (cliente, 30/out/2026): o botão de saída de uma resposta não entendida
  // transfere; o pedido digitado ("atendente"), fora dos passos de texto livre (nome e endereço), pede confirmação.
  if (b.receptionAvailable && selection.id === TALK_TO_RECEPTION_ID) return handoff(b, "way_out");

  // Motivo do pedido de recepção (EA, cliente, 02/nov/2026): o toque ou um novo pedido transfere direto (nunca uma
  // barreira); áudio também (o bot não ouve); o texto vai para a base. Número, outro toque: segue o passo.
  const reason = b.receptionAvailable ? pendingReasonOf(b) : undefined;
  if (reason) {
    await mergeContext(b, { [REASON_KEY]: undefined });
    if (selection.id === RECEPTION_NOW_ID || asksForReception(selection) || AUDIO_TYPES.has(message.type ?? "")) return handoff(b, reason.origin);
    if (!selection.id && /\p{L}/u.test(selection.text)) return handleReceptionReason(b, selection.text, reason.origin);
  }

  if (receptionConfirmPending(convo)) {
    const offer = receptionOfferOf(convo);
    await mergeContext(b, { [RECEPTION_CONFIRM_KEY]: undefined });
    const answer = yesNo(selection, RECEPTION_CONFIRM_IDS);
    if (answer === true) return offer ? acceptReceptionOffer(b, offer) : handoff(b, "typed");
    if (answer === false) {
      if (convo.funnelSessionId) await logAbandonment(env.db, env.clinicId, convo, "back_to_menu", env.now);
      if (offer) return declineReceptionOffer(b, offer);
      // Pedido logo na 1ª mensagem: as boas-vindas e o menu.
      if (convo.state === WELCOME) return showMenu(b, { withWelcome: true });
      await say(b, "bot_reception_declined", RECEPTION_DECLINED);
      return showMenu(b);
    }
    // Outra resposta: vale para o passo em que a pessoa estava.
  } else if (b.receptionAvailable && !FREE_TEXT_AWAITING.has(awaitingOf(convo) ?? "") && asksForReception(selection)) {
    // Com a base: pergunta o motivo (EA); sem ela, confirma antes de transferir, como antes.
    if (b.features.includes("knowledge_base")) return askReceptionReason(b, "typed", selection.text);
    await mergeContext(b, { [RECEPTION_CONFIRM_KEY]: true });
    return sendButtons(b, "bot_reception_confirm", RECEPTION_CONFIRM, RECEPTION_CONFIRM_BUTTONS);
  }

  switch (convo.state) {
    case "MENU":
      await handleMenu(b, selection);
      break;
    case "INFO_PREP_SELECT":
      await handlePreparationChoice(b, selection);
      break;
    default:
      // WELCOME, ou estado de outra versão do bot: começa do zero (com atendimento marcado, pergunta antes do menu).
      // Pergunta da base na 1ª mensagem: a resposta depois das boas-vindas (cliente, 31/out/2026).
      await startConversation(b, { afterWelcome: convo.state === WELCOME && b.knowledge ? await firstMessageAnswer(b) : undefined });
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
 * começo e o funil registra a desistência por tempo. Parada no menu (nada em
 * andamento): volta ao começo em silêncio (cliente, 11/nov/2026). Só conversas
 * do último dia (a janela de 24h da Meta). Devolve quantas encerrou.
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
      if (convo.state === "MENU") {
        await logAbandonment(db, clinicId, convo, "timeout", now);
        await setConversationState(db, clinicId, phone, WELCOME, { context: {} }, now);
        closed++;
        continue;
      }
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
          // Falha passageira da Meta: reenvio rápido (cliente, 05/nov/2026).
          retry: { outcome, context: botRetryContext(now) },
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
