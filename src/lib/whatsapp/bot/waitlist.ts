// Consultas/Exames › "Encaixe ou antecipar" (Fase 25 · etapa 2) — estados
// WAITLIST_SELECT e WAITLIST_LEAVE_CONFIRM.
//
// Quem já tem atendimento marcado entra na lista de espera para antecipar
// (identificação igual à de Cancelar/Remarcar: até 3 atendimentos viram
// lista, mais de 3 pergunta a data de nascimento). Já na lista: oferece
// "Sair da lista". Sem nada marcado: oferece marcar no primeiro horário
// livre — a tentativa do funil leva `waitlist: true` e, ao confirmar pela
// página, o atendimento entra na lista sozinho (`booking_links.join_waitlist`).
// A oferta de vaga e a resposta a ela ficam no motor da etapa 3.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendInteractiveButtonsMessage, sendInteractiveListMessage, sendTextMessage } from "../client";
import { formatWhen } from "../formatDateTime";
import { startFunnel } from "../funnel";
import { fetchActiveWaitlistAppointmentIds, joinWaitlist, leaveWaitlist } from "../../waitlist";
import {
  BACK_TO_MENU_LIST_ID,
  fetchUpcomingAppointments,
  parseBirthdateInput,
  resolveByListOrDigit,
  sendAndLog,
  updateConversationState,
  type AppointmentCandidate,
  type AppointmentCategory,
  type Selection,
} from "./shared";
import { startBooking } from "./booking";
import { startExam } from "./exam";
import { sendMenu } from "./menu";
import * as texts from "./messages";

export const WAITLIST_STATES: ReadonlySet<string> = new Set(["WAITLIST_SELECT", "WAITLIST_LEAVE_CONFIRM"]);

interface WaitlistContext {
  category: AppointmentCategory;
  awaiting?: "appointment_choice" | "birthdate_search" | "book_choice";
  candidates?: AppointmentCandidate[];
  pending_appointment?: AppointmentCandidate;
}

export async function startWaitlist(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  category: AppointmentCategory
): Promise<void> {
  const candidates = guardianId ? await fetchUpcomingAppointments(supabase, guardianId, category) : [];

  if (candidates.length === 0) {
    const body = texts.waitlistNoAppointmentText(category);
    await sendAndLog(supabase, guardianId, "bot_waitlist_no_appointment", body, () =>
      sendInteractiveButtonsMessage({
        to: guardianPhone,
        bodyText: body,
        buttons: texts.waitlistNoAppointmentButtons(category),
      })
    );
    await updateConversationState(supabase, guardianPhone, "WAITLIST_SELECT", {
      context: { category, awaiting: "book_choice" } satisfies WaitlistContext,
    });
    return;
  }

  if (candidates.length === 1) {
    await chooseAppointment(supabase, guardianPhone, guardianId, category, candidates[0]);
    return;
  }

  if (candidates.length <= 3) {
    await sendAppointmentChoice(supabase, guardianPhone, guardianId, category, candidates);
    await updateConversationState(supabase, guardianPhone, "WAITLIST_SELECT", {
      context: { category, awaiting: "appointment_choice", candidates } satisfies WaitlistContext,
    });
    return;
  }

  const body = texts.askBirthdateText(category === "exame");
  await sendAndLog(supabase, guardianId, "bot_waitlist_ask_birthdate", body, () =>
    sendTextMessage({ to: guardianPhone, body })
  );
  await updateConversationState(supabase, guardianPhone, "WAITLIST_SELECT", {
    context: { category, awaiting: "birthdate_search", candidates } satisfies WaitlistContext,
  });
}

export async function handleWaitlistState(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  state: string,
  rawContext: Record<string, unknown>,
  selection: Selection
): Promise<void> {
  const context = rawContext as unknown as WaitlistContext;
  if (state === "WAITLIST_LEAVE_CONFIRM") {
    await handleLeaveConfirm(supabase, guardianPhone, guardianId, context, selection);
    return;
  }

  switch (context.awaiting) {
    case "book_choice":
      await handleBookChoice(supabase, guardianPhone, guardianId, context, selection);
      return;
    case "appointment_choice":
      await handleAppointmentChoice(supabase, guardianPhone, guardianId, context, selection);
      return;
    case "birthdate_search":
      await handleBirthdateSearch(supabase, guardianPhone, guardianId, context, selection);
      return;
  }
}

// --- sem marcação: marcar no primeiro horário livre e entrar ao confirmar ---

async function handleBookChoice(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  context: WaitlistContext,
  selection: Selection
): Promise<void> {
  const buttons = texts.waitlistNoAppointmentButtons(context.category);
  // Toque no botão, ou o número da opção digitado.
  const digit = Number.parseInt(selection.text.trim(), 10);
  const chosen = buttons.find((button) => button.id === selection.id) ?? buttons[digit - 1];

  if (chosen?.id === texts.WAITLIST_BUTTON_ID.bookConsulta) {
    await startFunnel(supabase, guardianPhone, guardianId, "booking", { waitlist: true });
    await startBooking(supabase, guardianPhone, guardianId, "first_visit");
    return;
  }
  if (chosen?.id === texts.WAITLIST_BUTTON_ID.bookRetorno) {
    await startFunnel(supabase, guardianPhone, guardianId, "return_booking", { waitlist: true });
    await startBooking(supabase, guardianPhone, guardianId, "return_visit");
    return;
  }
  if (chosen?.id === texts.WAITLIST_BUTTON_ID.bookExame) {
    await startFunnel(supabase, guardianPhone, guardianId, "exam", { waitlist: true });
    await startExam(supabase, guardianPhone, guardianId);
    return;
  }
  // O toque em "Voltar ao menu" já é tratado pelo roteador; aqui só o número
  // da opção digitado.
  if (chosen?.id === BACK_TO_MENU_LIST_ID) {
    await updateConversationState(supabase, guardianPhone, "MENU", { context: {} });
    await sendMenu(supabase, guardianPhone, guardianId);
    return;
  }

  const notUnderstood = texts.notUnderstoodText();
  await sendAndLog(supabase, guardianId, "bot_not_understood", notUnderstood, () =>
    sendInteractiveButtonsMessage({ to: guardianPhone, bodyText: notUnderstood, buttons })
  );
}

// --- identificação do atendimento ------------------------------------------

async function handleAppointmentChoice(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  context: WaitlistContext,
  selection: Selection
): Promise<void> {
  const candidates = context.candidates ?? [];
  const match = resolveByListOrDigit(selection, candidates, (c) => `waitlist_${c.id}`);
  if (!match) {
    const body = texts.notUnderstoodText();
    await sendAndLog(supabase, guardianId, "bot_not_understood", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await sendAppointmentChoice(supabase, guardianPhone, guardianId, context.category, candidates);
    return;
  }
  await chooseAppointment(supabase, guardianPhone, guardianId, context.category, match);
}

async function handleBirthdateSearch(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  context: WaitlistContext,
  selection: Selection
): Promise<void> {
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
    await sendAndLog(supabase, guardianId, "bot_waitlist_no_match", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await updateConversationState(supabase, guardianPhone, "WELCOME", { context: {} });
    return;
  }

  if (matches.length === 1) {
    await chooseAppointment(supabase, guardianPhone, guardianId, context.category, matches[0]);
    return;
  }

  // Mais de um atendimento para a mesma data de nascimento (ex.: gêmeos).
  await sendAppointmentChoice(supabase, guardianPhone, guardianId, context.category, matches);
  await updateConversationState(supabase, guardianPhone, "WAITLIST_SELECT", {
    context: { category: context.category, awaiting: "appointment_choice", candidates: matches } satisfies WaitlistContext,
  });
}

// --- entrar na lista, ou oferecer sair se já estiver -------------------------

async function chooseAppointment(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  category: AppointmentCategory,
  appointment: AppointmentCandidate
): Promise<void> {
  const words = await appointmentWords(supabase, appointment);
  const whenLabel = formatWhen(new Date(appointment.scheduled_at));
  const active = await fetchActiveWaitlistAppointmentIds(supabase, [appointment.id]);

  if (active.has(appointment.id)) {
    await askLeave(supabase, guardianPhone, guardianId, category, appointment, words, whenLabel);
    return;
  }

  const result = await joinWaitlist(supabase, appointment.id, "whatsapp_bot");
  if (result === "already") {
    await askLeave(supabase, guardianPhone, guardianId, category, appointment, words, whenLabel);
    return;
  }

  await updateConversationState(supabase, guardianPhone, "WELCOME", { context: {} });
  if (result === "error") {
    const body = texts.waitlistErrorText();
    await sendAndLog(supabase, guardianId, "bot_waitlist_error", body, () => sendTextMessage({ to: guardianPhone, body }));
    return;
  }

  const body = texts.waitlistJoinedText(appointment.patient_name, words, whenLabel);
  await sendAndLog(
    supabase,
    guardianId,
    "bot_waitlist_joined",
    body,
    () => sendTextMessage({ to: guardianPhone, body }),
    appointment.id
  );
}

async function askLeave(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  category: AppointmentCategory,
  appointment: AppointmentCandidate,
  words: texts.WaitlistAppointmentWords,
  whenLabel: string
): Promise<void> {
  const body = texts.waitlistAlreadyInText(appointment.patient_name, words, whenLabel);
  await sendAndLog(supabase, guardianId, "bot_waitlist_already_in", body, () =>
    sendInteractiveButtonsMessage({ to: guardianPhone, bodyText: body, buttons: texts.waitlistAlreadyInButtons() })
  );
  await updateConversationState(supabase, guardianPhone, "WAITLIST_LEAVE_CONFIRM", {
    context: { category, pending_appointment: appointment } satisfies WaitlistContext,
  });
}

async function handleLeaveConfirm(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  context: WaitlistContext,
  selection: Selection
): Promise<void> {
  const appointment = context.pending_appointment;
  const normalized = selection.text.trim().toLowerCase();
  const isLeave =
    selection.id === texts.WAITLIST_BUTTON_ID.leave || normalized === "1" || normalized.startsWith("sair");
  const isStay =
    selection.id === texts.WAITLIST_BUTTON_ID.stay || normalized === "2" || normalized.startsWith("continuar");

  if (!appointment || (!isLeave && !isStay)) {
    if (!appointment) {
      await updateConversationState(supabase, guardianPhone, "WELCOME", { context: {} });
      return;
    }
    const body = texts.notUnderstoodText();
    await sendAndLog(supabase, guardianId, "bot_not_understood", body, () =>
      sendInteractiveButtonsMessage({ to: guardianPhone, bodyText: body, buttons: texts.waitlistAlreadyInButtons() })
    );
    return;
  }

  await updateConversationState(supabase, guardianPhone, "WELCOME", { context: {} });

  if (isStay) {
    const body = texts.waitlistStayText(appointment.patient_name);
    await sendAndLog(supabase, guardianId, "bot_waitlist_stay", body, () => sendTextMessage({ to: guardianPhone, body }));
    return;
  }

  // Já pode ter saído sozinho (atendimento cancelado/antecipado) — a
  // resposta é a mesma: não está mais na lista.
  await leaveWaitlist(supabase, appointment.id, "bot");
  const words = await appointmentWords(supabase, appointment);
  const body = texts.waitlistLeftText(appointment.patient_name, words, formatWhen(new Date(appointment.scheduled_at)));
  await sendAndLog(
    supabase,
    guardianId,
    "bot_waitlist_left",
    body,
    () => sendTextMessage({ to: guardianPhone, body }),
    appointment.id
  );
}

// --- helpers ------------------------------------------------------------------

async function sendAppointmentChoice(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  category: AppointmentCategory,
  candidates: AppointmentCandidate[]
): Promise<void> {
  const body = texts.appointmentChoiceBodyText("antecipar", category);
  await sendAndLog(supabase, guardianId, "bot_waitlist_choice", body, () =>
    sendInteractiveListMessage({
      to: guardianPhone,
      bodyText: body,
      buttonText: "Escolher opção",
      sections: texts.appointmentListSections(candidates, "waitlist"),
    })
  );
}

async function appointmentWords(
  supabase: SupabaseClient,
  appointment: AppointmentCandidate
): Promise<texts.WaitlistAppointmentWords> {
  let examName: string | null = null;
  if (appointment.appointment_type === "exam" && appointment.exam_type_id) {
    const { data } = await supabase.from("exam_types").select("name").eq("id", appointment.exam_type_id).maybeSingle();
    examName = (data?.name as string | undefined) ?? null;
  }
  return texts.waitlistAppointmentWords(appointment.appointment_type, examName);
}
