// Case 2 · Cancelar (Fase 3b) — estados CANCEL_SELECT e CANCEL_CONFIRM da
// máquina de estados do bot.
//
// Mesma identificação usada no case 3 · Remarcar (reaproveita
// `fetchUpcomingAppointments` de `./shared`): até 3 consultas/exames futuros
// viram lista de escolha; mais de 3, pergunta a data de nascimento da
// criança para filtrar. Diferente de Agendar/Remarcar, aqui a ação é
// imediata e destrutiva — por isso o diagrama do plano tem um estado extra
// (CANCEL_CONFIRM) só para o Sim/Não antes de cancelar de fato.
//
// "category" (consulta vs exame, ver shared.ts) acompanha o contexto a
// conversa inteira — Consultas > Cancelar nunca deve listar/mencionar um
// exame, e vice-versa, mesmo sendo o mesmo fluxo por baixo dos panos.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendInteractiveButtonsMessage, sendInteractiveListMessage, sendTextMessage } from "../client";
import { formatWhen } from "../formatDateTime";
import { logAppointmentEvent } from "../../audit";
import {
  fetchUpcomingAppointments,
  parseBirthdateInput,
  resolveByListOrDigit,
  sendAndLog,
  endFlow,
  updateConversationState,
  type AppointmentCandidate,
  type AppointmentCategory,
  type Selection,
} from "./shared";
import * as texts from "./messages";

export const CANCEL_STATES: ReadonlySet<string> = new Set(["CANCEL_SELECT", "CANCEL_CONFIRM"]);

interface CancelContext {
  category: AppointmentCategory;
  // "presence": depois do "Não" ao cancelar pelo lembrete, esperando a
  // resposta a "Deseja confirmar sua presença?" (mesmo estado CANCEL_CONFIRM).
  awaiting?: "appointment_choice" | "birthdate_search" | "presence";
  candidates?: AppointmentCandidate[];
  pending_appointment?: AppointmentCandidate;
  from_reminder?: boolean;
}

// Consultas > Cancelar ou Exames > Cancelar → identifica a(s) consulta(s)/
// exame(s) futuro(s) desse responsável, já filtrado pela categoria certa
// (nunca mistura consulta com exame).
export async function startCancel(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  category: AppointmentCategory
): Promise<void> {
  if (!guardianId) {
    const body = texts.cancelNoGuardianText();
    await sendAndLog(supabase, guardianId, "bot_cancel_no_guardian", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await endFlow(supabase, guardianPhone, guardianId, "blocked", { reason: "no_guardian" });
    return;
  }

  const candidates = await fetchUpcomingAppointments(supabase, guardianId, category);
  await presentCandidates(supabase, guardianPhone, guardianId, category, candidates);
}

// Botão "Cancelar" do lembrete (Fase 19): o atendimento já vem escolhido —
// vai direto para o Sim/Não do CANCEL_CONFIRM, contra toque acidental.
export async function startCancelForAppointment(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  appointment: AppointmentCandidate
): Promise<void> {
  const category: AppointmentCategory = appointment.appointment_type === "exam" ? "exame" : "consulta";
  await goToConfirm(supabase, guardianPhone, guardianId, category, appointment, true);
}

// `waMessageId`: mensagem recebida, marcada como `reminder_confirm` quando
// confirma a presença depois do "Não" (conta como confirmação nas métricas
// do lembrete, que valem pelo último toque).
export async function handleCancelState(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  state: string,
  rawContext: Record<string, unknown>,
  selection: Selection,
  waMessageId?: string
): Promise<void> {
  const context = rawContext as unknown as CancelContext;

  if (state === "CANCEL_SELECT") {
    await handleCancelSelect(supabase, guardianPhone, guardianId, context, selection);
    return;
  }

  if (state === "CANCEL_CONFIRM" && context.awaiting === "presence") {
    await handleKeptPresence(supabase, guardianPhone, guardianId, context, selection, waMessageId);
    return;
  }

  if (state === "CANCEL_CONFIRM") {
    await handleCancelConfirm(supabase, guardianPhone, guardianId, context, selection);
  }
}

// --- CANCEL_SELECT (identificação) ---------------------------------------

async function handleCancelSelect(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  context: CancelContext,
  selection: Selection
): Promise<void> {
  if (context.awaiting === "appointment_choice") {
    const candidates = context.candidates ?? [];
    const match = resolveByListOrDigit(selection, candidates, (c) => `cancel_${c.id}`);
    if (!match) {
      const body = texts.notUnderstoodText();
      await sendAndLog(supabase, guardianId, "bot_not_understood", body, () =>
        sendTextMessage({ to: guardianPhone, body })
      );
      await sendAppointmentChoice(supabase, guardianPhone, guardianId, context.category, candidates);
      return;
    }
    await goToConfirm(supabase, guardianPhone, guardianId, context.category, match);
    return;
  }

  if (context.awaiting === "birthdate_search") {
    const isoBirthdate = parseBirthdateInput(selection.text);
    if (!isoBirthdate) {
      const body = texts.invalidBirthdateText();
      await sendAndLog(supabase, guardianId, "bot_invalid_birthdate", body, () =>
        sendTextMessage({ to: guardianPhone, body })
      );
      return;
    }

    const matches = (context.candidates ?? []).filter((c) => c.birthdate === isoBirthdate);

    if (matches.length === 0) {
      const body = texts.noMatchingAppointmentText(context.category);
      await sendAndLog(supabase, guardianId, "bot_cancel_no_match", body, () =>
        sendTextMessage({ to: guardianPhone, body })
      );
      await endFlow(supabase, guardianPhone, guardianId, "blocked", { reason: "no_match" });
      return;
    }

    if (matches.length === 1) {
      await goToConfirm(supabase, guardianPhone, guardianId, context.category, matches[0]);
      return;
    }

    // Mais de uma consulta para a mesma data de nascimento (ex.: gêmeos).
    await sendAppointmentChoice(supabase, guardianPhone, guardianId, context.category, matches);
    await updateConversationState(supabase, guardianPhone, "CANCEL_SELECT", {
      context: { category: context.category, awaiting: "appointment_choice", candidates: matches } satisfies CancelContext,
    });
  }
}

// --- CANCEL_CONFIRM (Sim/Não antes de cancelar de fato) --------------------

async function handleCancelConfirm(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  context: CancelContext,
  selection: Selection
): Promise<void> {
  const pending = context.pending_appointment;
  if (!pending) {
    const body = texts.couldNotIdentifyAppointmentText(context.category);
    await sendAndLog(supabase, guardianId, "bot_cancel_error", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await endFlow(supabase, guardianPhone, guardianId, "error", { reason: "appointment_not_identified" });
    return;
  }

  const answer = selection.text.trim().toLowerCase();

  if (answer.startsWith("s")) {
    await performCancel(supabase, guardianPhone, guardianId, context.category, pending);
    return;
  }

  if (answer.startsWith("n")) {
    // Pelo lembrete, com presença ainda não confirmada: pergunta se confirma.
    const askPresence =
      context.from_reminder && (await fetchActiveAppointment(supabase, pending.id))?.patient_confirmed_at === null;
    if (askPresence) {
      const body = texts.cancelKeptAskPresenceText(context.category);
      await sendAndLog(supabase, guardianId, "bot_cancel_aborted", body, () =>
        sendInteractiveButtonsMessage({ to: guardianPhone, bodyText: body, buttons: texts.cancelKeptPresenceButtons() })
      );
      // A tentativa de cancelar termina aqui (funil); a pergunta da presença
      // segue no mesmo estado, fora do funil.
      await endFlow(supabase, guardianPhone, guardianId, "declined", {});
      await updateConversationState(supabase, guardianPhone, "CANCEL_CONFIRM", {
        context: { ...context, awaiting: "presence" } satisfies CancelContext,
      });
      return;
    }

    const body = texts.cancelAbortedText(context.category);
    await sendAndLog(supabase, guardianId, "bot_cancel_aborted", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await endFlow(supabase, guardianPhone, guardianId, "declined", {});
    return;
  }

  const notUnderstood = texts.notUnderstoodYesNoText();
  await sendAndLog(supabase, guardianId, "bot_not_understood", notUnderstood, () =>
    sendTextMessage({ to: guardianPhone, body: notUnderstood })
  );
  const body = texts.confirmCancelText(
    pending.patient_name,
    formatWhen(new Date(pending.scheduled_at)),
    context.category
  );
  await sendAndLog(supabase, guardianId, "bot_cancel_confirm", body, () =>
    sendTextMessage({ to: guardianPhone, body })
  );
}

// --- "Deseja confirmar sua presença?" (depois do "Não" pelo lembrete) -----

async function handleKeptPresence(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  context: CancelContext,
  selection: Selection,
  waMessageId?: string
): Promise<void> {
  const normalized = selection.text.trim().toLowerCase();
  const isYes =
    selection.id === texts.CANCEL_KEPT_PRESENCE_ID.yes || normalized === "1" || normalized.startsWith("s");
  const isNo =
    selection.id === texts.CANCEL_KEPT_PRESENCE_ID.no ||
    normalized === "2" ||
    normalized === "n" ||
    normalized.startsWith("não") ||
    normalized.startsWith("nao");

  if (!isYes && !isNo) {
    const body = texts.cancelKeptPresenceNotUnderstoodText();
    await sendAndLog(supabase, guardianId, "bot_not_understood", body, () =>
      sendInteractiveButtonsMessage({ to: guardianPhone, bodyText: body, buttons: texts.cancelKeptPresenceButtons() })
    );
    return;
  }

  await updateConversationState(supabase, guardianPhone, "WELCOME", { context: {} });

  if (isNo) {
    const body = texts.cancelKeptPresenceDeclinedText();
    await sendAndLog(supabase, guardianId, "bot_cancel_kept_presence_declined", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    return;
  }

  // Revalida: pode ter sido cancelado/remarcado/confirmado pela tela enquanto
  // a pergunta estava aberta.
  const pending = context.pending_appointment;
  const current = pending ? await fetchActiveAppointment(supabase, pending.id) : null;
  if (!pending || !current) {
    const body = texts.reminderInactiveText();
    await sendAndLog(supabase, guardianId, "bot_reminder_inactive", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    return;
  }

  const whenLabel = formatWhen(new Date(current.scheduled_at));
  if (current.patient_confirmed_at) {
    const body = texts.reminderPresenceAlreadyConfirmedText(pending.patient_name, whenLabel);
    await sendAndLog(supabase, guardianId, "bot_reminder_confirmed", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    return;
  }

  // Mesmo registro do botão "Confirmar presença" do lembrete (reminder.ts).
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("appointments")
    .update({
      reminder_response: "confirmed",
      reminder_response_at: now,
      patient_confirmed_at: now,
      patient_confirmed_by: null,
    })
    .eq("id", pending.id);
  if (error) {
    console.error("[whatsapp bot] erro ao confirmar presença depois do Não:", error.message);
    const body = texts.cancelErrorText();
    await sendAndLog(supabase, guardianId, "bot_cancel_error", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    return;
  }
  await logAppointmentEvent(supabase, { appointmentId: pending.id, type: "presence_confirmed", channel: "whatsapp_bot" });
  if (waMessageId) {
    await supabase
      .from("whatsapp_messages")
      .update({ appointment_id: pending.id, message_type: "reminder_confirm" })
      .eq("wa_message_id", waMessageId);
  }

  const body = texts.reminderPresenceConfirmedText(pending.patient_name, whenLabel);
  await sendAndLog(supabase, guardianId, "bot_reminder_confirmed", body, () =>
    sendTextMessage({ to: guardianPhone, body })
  );
}

// Atendimento ainda ativo e futuro (nulo se não), com a situação da presença.
async function fetchActiveAppointment(
  supabase: SupabaseClient,
  appointmentId: string
): Promise<{ scheduled_at: string; patient_confirmed_at: string | null } | null> {
  const { data } = await supabase
    .from("appointments")
    .select("status, scheduled_at, patient_confirmed_at")
    .eq("id", appointmentId)
    .maybeSingle();
  if (!data || !["scheduled", "confirmed"].includes(data.status) || new Date(data.scheduled_at).getTime() <= Date.now()) {
    return null;
  }
  return { scheduled_at: data.scheduled_at, patient_confirmed_at: data.patient_confirmed_at ?? null };
}

// --- ação de cancelar de fato ---------------------------------------------

async function performCancel(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  category: AppointmentCategory,
  appointment: AppointmentCandidate
): Promise<void> {
  const { error } = await supabase
    .from("appointments")
    .update({ status: "canceled", canceled_via: "whatsapp_bot", canceled_at: new Date().toISOString() })
    .eq("id", appointment.id);
  if (error) {
    console.error("[whatsapp bot] erro ao marcar consulta como cancelada:", error.message);
    const body = texts.cancelErrorText();
    await sendAndLog(supabase, guardianId, "bot_cancel_error", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await endFlow(supabase, guardianPhone, guardianId, "error", { reason: "cancel_error" });
    return;
  }

  await logAppointmentEvent(supabase, { appointmentId: appointment.id, type: "canceled", channel: "whatsapp_bot" });

  const body = texts.cancelSuccessText(
    appointment.patient_name,
    formatWhen(new Date(appointment.scheduled_at)),
    category
  );
  await sendAndLog(supabase, guardianId, "bot_cancel_success", body, () =>
    sendTextMessage({ to: guardianPhone, body })
  );
  await endFlow(supabase, guardianPhone, guardianId, "canceled", { appointment_id: appointment.id });
}

// --- helpers --------------------------------------------------------------

async function presentCandidates(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  category: AppointmentCategory,
  candidates: AppointmentCandidate[]
): Promise<void> {
  if (candidates.length === 0) {
    const body = texts.cancelNoAppointmentsText(category);
    await sendAndLog(supabase, guardianId, "bot_cancel_no_appointments", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await endFlow(supabase, guardianPhone, guardianId, "blocked", { reason: "no_appointments" });
    return;
  }

  if (candidates.length <= 3) {
    await sendAppointmentChoice(supabase, guardianPhone, guardianId, category, candidates);
    await updateConversationState(supabase, guardianPhone, "CANCEL_SELECT", {
      context: { category, awaiting: "appointment_choice", candidates } satisfies CancelContext,
    });
    return;
  }

  const body = texts.askBirthdateText();
  await sendAndLog(supabase, guardianId, "bot_cancel_ask_birthdate", body, () =>
    sendTextMessage({ to: guardianPhone, body })
  );
  await updateConversationState(supabase, guardianPhone, "CANCEL_SELECT", {
    context: { category, awaiting: "birthdate_search", candidates } satisfies CancelContext,
  });
}

async function sendAppointmentChoice(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  category: AppointmentCategory,
  candidates: AppointmentCandidate[]
): Promise<void> {
  const body = texts.appointmentChoiceBodyText("cancelar", category);
  await sendAndLog(supabase, guardianId, "bot_cancel_choice", body, () =>
    sendInteractiveListMessage({
      to: guardianPhone,
      bodyText: body,
      buttonText: "Escolher opção",
      sections: texts.appointmentListSections(candidates, "cancel"),
    })
  );
}

async function goToConfirm(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  category: AppointmentCategory,
  appointment: AppointmentCandidate,
  fromReminder = false
): Promise<void> {
  const body = texts.confirmCancelText(appointment.patient_name, formatWhen(new Date(appointment.scheduled_at)), category);
  await sendAndLog(supabase, guardianId, "bot_cancel_confirm", body, () =>
    sendTextMessage({ to: guardianPhone, body })
  );
  await updateConversationState(supabase, guardianPhone, "CANCEL_CONFIRM", {
    context: {
      category,
      pending_appointment: appointment,
      ...(fromReminder ? { from_reminder: true } : {}),
    } satisfies CancelContext,
  });
}
