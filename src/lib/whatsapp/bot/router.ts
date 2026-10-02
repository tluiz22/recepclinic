// Roteador da máquina de estados do bot de WhatsApp (Fase 3b/6).
//
// Chamado pelo webhook (`src/pages/api/whatsapp/webhook.ts`) para cada
// mensagem inbound do paciente, depois que ela já foi registrada em
// `whatsapp_messages`. Menu principal com 4 grupos (Consultas, Exames,
// Informações gerais, Falar com secretária — reorganizado em set/2026 a
// partir das 7 opções soltas de antes): MENU → CONSULTAS_MENU/EXAMES_MENU/
// INFO_MENU, e MENU → HUMAN_HANDOFF direto. Delega os estados de Agendar
// (case 1, `./booking.ts`), Cancelar (case 2, `./cancel.ts`), Remarcar
// (case 3, `./reschedule.ts`) e Marcar exame (case 6, `./exam.ts`).
//
// Nunca lança: erros de uma etapa não devem impedir o webhook de responder
// 200 rápido para a Meta.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WaMessage } from "../types";
import { sendInteractiveListMessage, sendTextMessage } from "../client";
import {
  buildAppUrl,
  extractSelection,
  isBackToMenuSelection,
  isPastHumanHandoffDeadline,
  isPastIdleTimeout,
  matchesOption,
  resolveByListOrDigit,
  resolveGuardianId,
  sendAndLog,
  updateConversationState,
  type Selection,
} from "./shared";
import { BOOKING_STATES, handleBookingState, startBooking } from "./booking";
import { CANCEL_STATES, handleCancelState, startCancel } from "./cancel";
import { RESCHEDULE_STATES, handleRescheduleState, startReschedule } from "./reschedule";
import { EXAM_STATES, handleExamState, startExam } from "./exam";
import { handleReminderTap, parseReminderTap } from "./reminder";
import * as texts from "./messages";
import { sendMenu } from "./menu";
import { logFunnelEvent, startFunnel, type FunnelFlow } from "../funnel";

// "Falar com a secretária" temporariamente desligado enquanto o sistema
// ainda está em teste (pedido do cliente, set/2026) — evita transferir de
// verdade pra secretária antes de ir ao ar. Reverter pra false (ou remover)
// quando sair de testes.
const SECRETARIA_HANDOFF_DISABLED = true;

interface ConversationStateRow {
  state: string;
  guardian_id: string | null;
  atendimento_humano: boolean;
  context: Record<string, unknown> | null;
  updated_at: string;
  funnel_session_id: string | null;
  funnel_flow: string | null;
}

export async function routeIncomingMessage(
  supabase: SupabaseClient,
  guardianPhone: string,
  waMsg: WaMessage
): Promise<void> {
  const { data: convo, error } = await supabase
    .from("conversation_state")
    .select("state, guardian_id, atendimento_humano, context, updated_at, funnel_session_id, funnel_flow")
    .eq("guardian_phone", guardianPhone)
    .maybeSingle<ConversationStateRow>();

  if (error || !convo) {
    console.error(
      "[whatsapp bot] conversation_state não encontrada para",
      guardianPhone,
      error?.message
    );
    return;
  }

  console.log(
    "[whatsapp bot] estado lido:",
    guardianPhone,
    "state=" + convo.state,
    "atendimento_humano=" + convo.atendimento_humano
  );

  // Toque num botão do lembrete (Fase 19) — vale em qualquer estado da
  // conversa, por isso vem antes da máquina de estados. A pausa do
  // atendimento humano é decidida lá dentro (Confirmar vale mesmo pausado).
  const reminderTap = parseReminderTap(waMsg);
  if (reminderTap) {
    const botPaused = convo.atendimento_humano && !isPastHumanHandoffDeadline(new Date(convo.updated_at));
    if (convo.atendimento_humano && !botPaused) {
      // Prazo do atendimento humano vencido: devolve ao bot, como abaixo —
      // senão a troca de estado renovaria o `updated_at` da pausa.
      await updateConversationState(supabase, guardianPhone, "WELCOME", { atendimento_humano: false, context: {} });
    }
    const tapGuardianId = convo.guardian_id ?? (await resolveGuardianId(supabase, guardianPhone));
    const result = await handleReminderTap(supabase, guardianPhone, tapGuardianId, waMsg, reminderTap, botPaused);
    if (result === "inactive" && !botPaused) {
      await updateConversationState(supabase, guardianPhone, "MENU", { context: {} });
      await sendMenu(supabase, guardianPhone, tapGuardianId);
    }
    return;
  }

  // Secretária conduzindo a conversa pelo app (coexistência) — o bot fica em
  // silêncio, a menos que o prazo de resposta já tenha vencido (24h corridas,
  // nunca vencendo num fim de semana — "até o próximo dia útil"). Nesse caso,
  // devolve ao bot sozinho, sem depender da secretária lembrar de digitar
  // `#bot`, e reinicia do zero (WELCOME) — o responsável pode não lembrar
  // mais em que ponto a conversa parou depois de tanto tempo.
  if (convo.atendimento_humano) {
    if (!isPastHumanHandoffDeadline(new Date(convo.updated_at))) return;
    await updateConversationState(supabase, guardianPhone, "WELCOME", {
      atendimento_humano: false,
      context: {},
    });
    convo.state = "WELCOME";
    convo.atendimento_humano = false;
  }

  const guardianId = convo.guardian_id ?? (await resolveGuardianId(supabase, guardianPhone));
  const selection = extractSelection(waMsg);

  // Timeout de inatividade (15min, ver `isPastIdleTimeout`): a conversa
  // ficou parada tempo demais fora de WELCOME (inclusive em MENU — rede de
  // segurança contra qualquer ponto que ainda pouse lá em vez de WELCOME) —
  // reinicia do zero em vez de tentar reencaixar esta mensagem num contexto
  // que o responsável provavelmente já esqueceu.
  if (convo.state !== "WELCOME" && isPastIdleTimeout(new Date(convo.updated_at))) {
    await logAbandonment(supabase, guardianPhone, guardianId, convo, "timeout");
    await updateConversationState(supabase, guardianPhone, "WELCOME", { context: {} });
    convo.state = "WELCOME";
    convo.context = {};
  }

  const context = convo.context ?? {};

  // "Voltar ao menu principal" funciona em qualquer estado do meio da
  // conversa (toque na opção da lista, ou digitar "0"/"menu") — pedido do
  // cliente para não deixar o responsável preso num sub-fluxo. WELCOME/MENU
  // ficam de fora: já mostram o menu ou ainda nem chegaram lá.
  if (convo.state !== "WELCOME" && convo.state !== "MENU" && isBackToMenuSelection(selection)) {
    await logAbandonment(supabase, guardianPhone, guardianId, convo, "back_to_menu");
    await updateConversationState(supabase, guardianPhone, "MENU", { context: {} });
    await sendMenu(supabase, guardianPhone, guardianId);
    return;
  }

  if (BOOKING_STATES.has(convo.state)) {
    await handleBookingState(supabase, guardianPhone, guardianId, convo.state, context, selection);
    return;
  }

  if (RESCHEDULE_STATES.has(convo.state)) {
    await handleRescheduleState(supabase, guardianPhone, guardianId, context, selection);
    return;
  }

  if (CANCEL_STATES.has(convo.state)) {
    await handleCancelState(supabase, guardianPhone, guardianId, convo.state, context, selection);
    return;
  }

  if (EXAM_STATES.has(convo.state)) {
    await handleExamState(supabase, guardianPhone, guardianId, convo.state, context, selection);
    return;
  }

  switch (convo.state) {
    case "WELCOME":
      await handleWelcome(supabase, guardianPhone, guardianId);
      return;
    case "MENU":
      await handleMenu(supabase, guardianPhone, guardianId, selection);
      return;
    case "CONSULTAS_MENU":
      await handleConsultasMenu(supabase, guardianPhone, guardianId, selection);
      return;
    case "EXAMES_MENU":
      await handleExamesMenu(supabase, guardianPhone, guardianId, selection);
      return;
    case "INFO_MENU":
      await handleInfoMenu(supabase, guardianPhone, guardianId, selection);
      return;
    case "INFO_PREP_SELECT":
      await handleInfoPrepSelect(supabase, guardianPhone, guardianId, context, selection);
      return;
    default:
      // Estado desconhecido/obsoleto (ex.: enum antigo já removido da
      // máquina de estados) — reinicia do zero (WELCOME) em vez de deixar a
      // conversa travada num estado sem handler.
      await handleWelcome(supabase, guardianPhone, guardianId);
  }
}

// --- funil (Fase 15) --------------------------------------------------------

// Tentativa em andamento interrompida (timeout de inatividade ou "voltar ao
// menu") — registra o abandono na última etapa alcançada. Tentativa de quem
// some e nunca mais escreve não passa por aqui: é abandono calculado na
// leitura (sem evento de resultado).
async function logAbandonment(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  convo: ConversationStateRow,
  reason: "timeout" | "back_to_menu"
): Promise<void> {
  if (!convo.funnel_session_id || !convo.funnel_flow) return;
  await logFunnelEvent(supabase, {
    sessionId: convo.funnel_session_id,
    flow: convo.funnel_flow as FunnelFlow,
    step: "abandoned",
    guardianPhone,
    guardianId,
    metadata: { reason, last_step: convo.state },
  });
  convo.funnel_session_id = null;
  convo.funnel_flow = null;
}

// --- menus (compartilhados por WELCOME/MENU/INFO_MENU) --------------------
// O menu principal (`sendMenu`) fica em menu.ts.

async function sendInfoMenu(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null
): Promise<void> {
  const body = texts.infoMenuBodyText();
  await sendAndLog(supabase, guardianId, "bot_info_menu", body, () =>
    sendInteractiveListMessage({
      to: guardianPhone,
      bodyText: body,
      buttonText: "Escolher opção",
      sections: texts.infoMenuSections(),
    })
  );
}

async function sendConsultasMenu(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null
): Promise<void> {
  const body = texts.consultasMenuBodyText();
  await sendAndLog(supabase, guardianId, "bot_consultas_menu", body, () =>
    sendInteractiveListMessage({
      to: guardianPhone,
      bodyText: body,
      buttonText: "Escolher opção",
      sections: texts.consultasMenuSections(),
    })
  );
}

async function sendExamesMenu(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null
): Promise<void> {
  const body = texts.examesMenuBodyText();
  await sendAndLog(supabase, guardianId, "bot_exames_menu", body, () =>
    sendInteractiveListMessage({
      to: guardianPhone,
      bodyText: body,
      buttonText: "Escolher opção",
      sections: texts.examesMenuSections(),
    })
  );
}

// --- WELCOME --------------------------------------------------------------

async function handleWelcome(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null
): Promise<void> {
  const welcome = texts.welcomeText();
  await sendAndLog(supabase, guardianId, "bot_welcome", welcome, () =>
    sendTextMessage({ to: guardianPhone, body: welcome })
  );
  await sendMenu(supabase, guardianPhone, guardianId);
  await updateConversationState(supabase, guardianPhone, "MENU");
}

// --- MENU -------------------------------------------------------------

async function handleMenu(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  selection: Selection
): Promise<void> {
  if (matchesOption(selection, "1", texts.MENU_LIST_ID.consultas)) {
    await sendConsultasMenu(supabase, guardianPhone, guardianId);
    await updateConversationState(supabase, guardianPhone, "CONSULTAS_MENU");
    return;
  }

  if (matchesOption(selection, "2", texts.MENU_LIST_ID.exames)) {
    await sendExamesMenu(supabase, guardianPhone, guardianId);
    await updateConversationState(supabase, guardianPhone, "EXAMES_MENU");
    return;
  }

  if (matchesOption(selection, "3", texts.MENU_LIST_ID.informacoes)) {
    await sendInfoMenu(supabase, guardianPhone, guardianId);
    await updateConversationState(supabase, guardianPhone, "INFO_MENU");
    return;
  }

  if (matchesOption(selection, "4", texts.MENU_LIST_ID.secretaria)) {
    // Funil (Fase 15): evento avulso, registrado mesmo com a transferência
    // desligada — mostra quanta gente procura a secretária.
    await logFunnelEvent(supabase, {
      sessionId: crypto.randomUUID(),
      flow: "handoff",
      step: "requested",
      guardianPhone,
      guardianId,
      metadata: { handoff_enabled: !SECRETARIA_HANDOFF_DISABLED },
    });

    if (SECRETARIA_HANDOFF_DISABLED) {
      const body = texts.handoffDisabledText();
      await sendAndLog(supabase, guardianId, "bot_handoff_disabled", body, () =>
        sendTextMessage({ to: guardianPhone, body })
      );
      await sendMenu(supabase, guardianPhone, guardianId);
      return;
    }

    const body = texts.handoffText();
    await sendAndLog(supabase, guardianId, "bot_handoff", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await updateConversationState(supabase, guardianPhone, "HUMAN_HANDOFF", { atendimento_humano: true });
    return;
  }

  const notUnderstood = texts.notUnderstoodText(true);
  await sendAndLog(supabase, guardianId, "bot_not_understood", notUnderstood, () =>
    sendTextMessage({ to: guardianPhone, body: notUnderstood })
  );
  await sendMenu(supabase, guardianPhone, guardianId);
}

// --- CONSULTAS_MENU ---------------------------------------------------

async function handleConsultasMenu(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  selection: Selection
): Promise<void> {
  if (matchesOption(selection, "1", texts.CONSULTAS_LIST_ID.agendarConsulta)) {
    await startFunnel(supabase, guardianPhone, guardianId, "booking");
    await startBooking(supabase, guardianPhone, guardianId, "first_visit");
    return;
  }

  if (matchesOption(selection, "2", texts.CONSULTAS_LIST_ID.agendarRetorno)) {
    await startFunnel(supabase, guardianPhone, guardianId, "return_booking");
    await startBooking(supabase, guardianPhone, guardianId, "return_visit");
    return;
  }

  if (matchesOption(selection, "3", texts.CONSULTAS_LIST_ID.cancelar)) {
    await startFunnel(supabase, guardianPhone, guardianId, "cancel", { category: "consulta" });
    await startCancel(supabase, guardianPhone, guardianId, "consulta");
    return;
  }

  if (matchesOption(selection, "4", texts.CONSULTAS_LIST_ID.remarcar)) {
    await startFunnel(supabase, guardianPhone, guardianId, "reschedule", { category: "consulta" });
    await startReschedule(supabase, guardianPhone, guardianId, "consulta");
    return;
  }

  const notUnderstood = texts.notUnderstoodText();
  await sendAndLog(supabase, guardianId, "bot_not_understood", notUnderstood, () =>
    sendTextMessage({ to: guardianPhone, body: notUnderstood })
  );
  await sendConsultasMenu(supabase, guardianPhone, guardianId);
}

// --- EXAMES_MENU --------------------------------------------------------

async function handleExamesMenu(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  selection: Selection
): Promise<void> {
  if (matchesOption(selection, "1", texts.EXAMES_LIST_ID.marcar)) {
    await startFunnel(supabase, guardianPhone, guardianId, "exam");
    await startExam(supabase, guardianPhone, guardianId);
    return;
  }

  if (matchesOption(selection, "2", texts.EXAMES_LIST_ID.cancelar)) {
    await startFunnel(supabase, guardianPhone, guardianId, "cancel", { category: "exame" });
    await startCancel(supabase, guardianPhone, guardianId, "exame");
    return;
  }

  if (matchesOption(selection, "3", texts.EXAMES_LIST_ID.remarcar)) {
    await startFunnel(supabase, guardianPhone, guardianId, "reschedule", { category: "exame" });
    await startReschedule(supabase, guardianPhone, guardianId, "exame");
    return;
  }

  const notUnderstood = texts.notUnderstoodText();
  await sendAndLog(supabase, guardianId, "bot_not_understood", notUnderstood, () =>
    sendTextMessage({ to: guardianPhone, body: notUnderstood })
  );
  await sendExamesMenu(supabase, guardianPhone, guardianId);
}

// --- INFO_MENU (case 4 · Informações Gerais) -------------------------------

async function handleInfoMenu(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  selection: Selection
): Promise<void> {
  if (matchesOption(selection, "1", texts.INFO_LIST_ID.valores)) {
    const [{ data: locations }, { data: examTypes }] = await Promise.all([
      supabase
        .from("clinic_locations")
        .select("name, type, price_first_visit_cents")
        .eq("is_active", true)
        .neq("type", "exam"),
      supabase.from("exam_types").select("name, price_cents").eq("is_active", true).order("name"),
    ]);
    const body = texts.valoresText(locations ?? [], examTypes ?? []);
    await sendAndLog(supabase, guardianId, "bot_info_valores", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await sendInfoMenu(supabase, guardianPhone, guardianId);
    return;
  }

  if (matchesOption(selection, "2", texts.INFO_LIST_ID.convenios)) {
    const body = texts.conveniosText();
    await sendAndLog(supabase, guardianId, "bot_info_convenios", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await sendInfoMenu(supabase, guardianPhone, guardianId);
    return;
  }

  if (matchesOption(selection, "3", texts.INFO_LIST_ID.endereco)) {
    const { data } = await supabase
      .from("clinic_locations")
      .select("name, address")
      .eq("type", "clinic")
      .eq("is_active", true);
    const body = texts.enderecoText(data ?? []);
    await sendAndLog(supabase, guardianId, "bot_info_endereco", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await sendInfoMenu(supabase, guardianPhone, guardianId);
    return;
  }

  if (matchesOption(selection, "4", texts.INFO_LIST_ID.preparo)) {
    const { data } = await supabase
      .from("exam_types")
      .select("id, name")
      .eq("is_active", true)
      .not("preparation_instructions", "is", null)
      .order("name")
      .limit(texts.MAX_PREPARATION_EXAMS);
    const exams = data ?? [];

    if (!exams.length) {
      const body = texts.noPreparationExamsText();
      await sendAndLog(supabase, guardianId, "bot_info_preparo_vazio", body, () =>
        sendTextMessage({ to: guardianPhone, body })
      );
      await sendInfoMenu(supabase, guardianPhone, guardianId);
      return;
    }

    await sendPreparationExamQuestion(supabase, guardianPhone, guardianId, exams);
    const context: InfoPrepContext = { prep_exam_candidates: exams };
    await updateConversationState(supabase, guardianPhone, "INFO_PREP_SELECT", { context });
    return;
  }

  const notUnderstood = texts.notUnderstoodText();
  await sendAndLog(supabase, guardianId, "bot_not_understood", notUnderstood, () =>
    sendTextMessage({ to: guardianPhone, body: notUnderstood })
  );
  await sendInfoMenu(supabase, guardianPhone, guardianId);
}

// --- INFO_PREP_SELECT (Informações gerais > Preparo para exames, Fase 18) --

interface InfoPrepContext {
  prep_exam_candidates?: { id: string; name: string }[];
}

async function sendPreparationExamQuestion(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  exams: { id: string; name: string }[]
): Promise<void> {
  const body = texts.preparationChoiceBodyText();
  await sendAndLog(supabase, guardianId, "bot_info_preparo_escolha", body, () =>
    sendInteractiveListMessage({
      to: guardianPhone,
      bodyText: body,
      buttonText: "Escolher exame",
      sections: texts.preparationExamSections(exams),
    })
  );
}

// Escolheu o exame: manda o preparo (lido de novo do banco — pode ter sido
// editado depois da lista) + o link da página, e volta ao menu de
// Informações (mesmo comportamento de Valores/Convênios/Endereço).
async function handleInfoPrepSelect(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  rawContext: Record<string, unknown>,
  selection: Selection
): Promise<void> {
  const candidates = (rawContext as InfoPrepContext).prep_exam_candidates ?? [];
  const match = resolveByListOrDigit(selection, candidates, (c) => `prep_exam_${c.id}`);

  if (!match) {
    const body = texts.notUnderstoodText();
    await sendAndLog(supabase, guardianId, "bot_not_understood", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await sendPreparationExamQuestion(supabase, guardianPhone, guardianId, candidates);
    return;
  }

  const { data: exam } = await supabase
    .from("exam_types")
    .select("preparation_instructions")
    .eq("id", match.id)
    .maybeSingle();
  const preparation = exam?.preparation_instructions?.trim();

  const body = preparation
    ? texts.preparationText(preparation, buildAppUrl(`/preparo/${match.id}`))
    : texts.noPreparationExamsText();
  await sendAndLog(supabase, guardianId, "bot_info_preparo", body, () =>
    sendTextMessage({ to: guardianPhone, body })
  );
  await updateConversationState(supabase, guardianPhone, "INFO_MENU", { context: {} });
  await sendInfoMenu(supabase, guardianPhone, guardianId);
}
