import type { DbClient } from "../../clients";
import { unwrap } from "../../errors";
import { hasFeature } from "../../features";
import { checkHandoff, IDLE_TIMEOUT_MINUTES, isPastIdleTimeout, logAbandonment, openConversation, setConversationState, WELCOME } from "../conversations";
import { contactIdByPhone, recordOutboundMessage } from "../messages";
import { toE164, type WaMessage } from "../meta";
import type { ClinicSender } from "../send";
import { BOOKING_STATES, handleBookingState } from "./booking";
import { createBot, type BotEnv } from "./engine";
import { extractSelection, isBackToMenu } from "./input";
import { handleInfo, handleMenu, handlePreparationChoice, handleSubmenu, showMenu } from "./menus";
import { handleManageState, handleOfferTap, handleReminderTap, MANAGE_STATES, offerTapOf, reminderTapOf } from "./manage";
import { IDLE_CLOSED } from "./texts";
import { listBotMessages } from "../customMessages";
import { logError } from "../../../log";

// Entrada do bot (F6.3): chamado pelo webhook para cada mensagem recebida, já
// registrada. Só com o item "Bot de WhatsApp" liberado (D11) e o WhatsApp da
// clínica conectado. Conversa pausada pela recepção fica em silêncio, menos
// para os toques no lembrete (Confirmar) e na oferta de vaga, que respondem a
// uma pergunta do sistema (F6.4). Nunca lança: o erro vai para o log e a Meta
// recebe 200 do mesmo jeito.

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
  }

  const b = await createBot(env, convo, message.id ?? null);
  const selection = extractSelection(message);

  // "Voltar ao menu" vale no meio de qualquer fluxo.
  if (convo.state !== WELCOME && convo.state !== "MENU" && isBackToMenu(selection)) {
    await logAbandonment(env.db, env.clinicId, convo, "back_to_menu", env.now);
    await showMenu(b);
    return "handled";
  }

  if (MANAGE_STATES.has(convo.state)) {
    await handleManageState(b, convo.state, selection);
    return "handled";
  }
  if (BOOKING_STATES.has(convo.state)) {
    await handleBookingState(b, convo.state, selection);
    return "handled";
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
      // WELCOME, ou estado de outra versão do bot: começa do zero.
      await showMenu(b, { withWelcome: true });
  }
  return "handled";
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
