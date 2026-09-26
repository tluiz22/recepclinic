// Case 3 · Remarcar (Fase 3b) — estado RESCHEDULE_SELECT da máquina de
// estados do bot.
//
// Mesma ideia de identificação usada no case 1 (nunca listar tudo às cegas
// para um responsável-convênio com muitas crianças vinculadas): até 3
// consultas/exames futuros viram lista de escolha; mais de 3, pergunta a
// data de nascimento da criança para filtrar. Ao identificar, gera uma
// linha em `booking_links` (`mode=reschedule`) com o mesmo local/tipo do
// agendamento atual — só a data/horário são escolhidos na página.
//
// "category" (consulta vs exame, ver shared.ts) acompanha o contexto a
// conversa inteira — Consultas > Remarcar nunca deve listar/mencionar um
// exame, e vice-versa, mesmo sendo o mesmo fluxo por baixo dos panos.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendInteractiveListMessage, sendTextMessage } from "../client";
import { formatWhen } from "../formatDateTime";
import {
  buildAppUrl,
  fetchUpcomingAppointments,
  parseBirthdateInput,
  resolveByListOrDigit,
  sendAndLog,
  updateConversationState,
  type AppointmentCandidate,
  type AppointmentCategory,
  type Selection,
} from "./shared";
import * as texts from "./messages";

export const RESCHEDULE_STATES: ReadonlySet<string> = new Set(["RESCHEDULE_SELECT", "RESCHEDULE_HOME_ADDRESS"]);

interface RescheduleContext {
  category: AppointmentCategory;
  awaiting?:
    | "appointment_choice"
    | "birthdate_search"
    | "confirm_appointment"
    | "home_address_confirm_current"
    | "home_address_input"
    | "home_address_confirm_new";
  candidates?: AppointmentCandidate[];
  // Reaproveitado também pra carregar a consulta durante a reconfirmação de
  // endereço (Fase 16) — mesmo objeto, papel análogo (a consulta "em mãos"
  // enquanto falta um último passo antes de gerar o link).
  pending_appointment?: AppointmentCandidate;
  // Endereço candidato ainda não confirmado (o gravado na consulta, ou o
  // texto recém-digitado) — só existe entre perguntar e confirmar/corrigir.
  pending_home_address?: string;
}

// Consultas > Remarcar ou Exames > Remarcar → identifica a(s) consulta(s)/
// exame(s) futuro(s) desse responsável, já filtrado pela categoria certa
// (nunca mistura consulta com exame).
export async function startReschedule(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  category: AppointmentCategory
): Promise<void> {
  if (!guardianId) {
    const body = texts.rescheduleNoGuardianText();
    await sendAndLog(supabase, guardianId, "bot_reschedule_no_guardian", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await updateConversationState(supabase, guardianPhone, "WELCOME", { context: {} });
    return;
  }

  const candidates = await fetchUpcomingAppointments(supabase, guardianId, category);
  await presentCandidates(supabase, guardianPhone, guardianId, category, candidates);
}

export async function handleRescheduleState(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  rawContext: Record<string, unknown>,
  selection: Selection
): Promise<void> {
  const context = rawContext as unknown as RescheduleContext;

  if (context.awaiting === "appointment_choice") {
    const candidates = context.candidates ?? [];
    const match = resolveByListOrDigit(selection, candidates, (c) => `reschedule_${c.id}`);
    if (!match) {
      const body = texts.notUnderstoodText();
      await sendAndLog(supabase, guardianId, "bot_not_understood", body, () =>
        sendTextMessage({ to: guardianPhone, body })
      );
      await sendAppointmentChoice(supabase, guardianPhone, guardianId, context.category, candidates);
      return;
    }
    await finishReschedule(supabase, guardianPhone, guardianId, match);
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
      await sendAndLog(supabase, guardianId, "bot_reschedule_no_match", body, () =>
        sendTextMessage({ to: guardianPhone, body })
      );
      await updateConversationState(supabase, guardianPhone, "WELCOME", { context: {} });
      return;
    }

    if (matches.length === 1) {
      const pending = matches[0];
      const body = texts.confirmAppointmentText(
        pending.patient_name,
        formatWhen(new Date(pending.scheduled_at)),
        context.category
      );
      await sendAndLog(supabase, guardianId, "bot_reschedule_confirm", body, () =>
        sendTextMessage({ to: guardianPhone, body })
      );
      await updateConversationState(supabase, guardianPhone, "RESCHEDULE_SELECT", {
        context: {
          category: context.category,
          awaiting: "confirm_appointment",
          pending_appointment: pending,
        } satisfies RescheduleContext,
      });
      return;
    }

    // Mais de uma consulta para a mesma data de nascimento (ex.: gêmeos).
    await sendAppointmentChoice(supabase, guardianPhone, guardianId, context.category, matches);
    await updateConversationState(supabase, guardianPhone, "RESCHEDULE_SELECT", {
      context: { category: context.category, awaiting: "appointment_choice", candidates: matches } satisfies RescheduleContext,
    });
    return;
  }

  if (context.awaiting === "confirm_appointment") {
    const pending = context.pending_appointment;
    if (!pending) {
      const body = texts.couldNotIdentifyAppointmentText(context.category);
      await sendAndLog(supabase, guardianId, "bot_reschedule_error", body, () =>
        sendTextMessage({ to: guardianPhone, body })
      );
      await updateConversationState(supabase, guardianPhone, "WELCOME", { context: {} });
      return;
    }

    const answer = selection.text.trim().toLowerCase();
    if (answer.startsWith("s")) {
      await finishReschedule(supabase, guardianPhone, guardianId, pending);
      return;
    }
    if (answer.startsWith("n")) {
      const body = texts.couldNotIdentifyAppointmentText(context.category);
      await sendAndLog(supabase, guardianId, "bot_reschedule_error", body, () =>
        sendTextMessage({ to: guardianPhone, body })
      );
      await updateConversationState(supabase, guardianPhone, "WELCOME", { context: {} });
      return;
    }

    const notUnderstood = texts.notUnderstoodYesNoText();
    await sendAndLog(supabase, guardianId, "bot_not_understood", notUnderstood, () =>
      sendTextMessage({ to: guardianPhone, body: notUnderstood })
    );
    const body = texts.confirmAppointmentText(
      pending.patient_name,
      formatWhen(new Date(pending.scheduled_at)),
      context.category
    );
    await sendAndLog(supabase, guardianId, "bot_reschedule_confirm", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    return;
  }

  // --- endereço do atendimento domiciliar (Fase 16) ----------------------

  const appointment = context.pending_appointment;
  if (!appointment || !guardianId) {
    if (context.awaiting?.startsWith("home_address")) {
      await sendRescheduleLinkError(supabase, guardianPhone, guardianId);
    }
    return;
  }

  if (context.awaiting === "home_address_confirm_current") {
    const answer = selection.text.trim().toLowerCase();
    if (answer.startsWith("s")) {
      await finishRescheduleWithAddress(supabase, guardianPhone, guardianId, appointment, context.pending_home_address ?? "", {
        updateDefault: false,
      });
      return;
    }
    if (answer.startsWith("n")) {
      await askRescheduleHomeAddress(supabase, guardianPhone, guardianId, context.category, appointment);
      return;
    }

    const notUnderstood = texts.notUnderstoodYesNoText();
    await sendAndLog(supabase, guardianId, "bot_not_understood", notUnderstood, () =>
      sendTextMessage({ to: guardianPhone, body: notUnderstood })
    );
    const body = texts.homeAddressConfirmCurrentText(context.pending_home_address ?? "");
    await sendAndLog(supabase, guardianId, "bot_reschedule_home_address_confirm_current", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    return;
  }

  if (context.awaiting === "home_address_input") {
    const address = selection.text.trim();
    if (!address) {
      await askRescheduleHomeAddress(supabase, guardianPhone, guardianId, context.category, appointment);
      return;
    }

    const body = texts.homeAddressConfirmNewText(address);
    await sendAndLog(supabase, guardianId, "bot_reschedule_home_address_confirm_new", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await updateConversationState(supabase, guardianPhone, "RESCHEDULE_HOME_ADDRESS", {
      context: { ...context, awaiting: "home_address_confirm_new", pending_home_address: address } satisfies RescheduleContext,
    });
    return;
  }

  if (context.awaiting === "home_address_confirm_new") {
    const answer = selection.text.trim().toLowerCase();
    if (answer.startsWith("s")) {
      await finishRescheduleWithAddress(supabase, guardianPhone, guardianId, appointment, context.pending_home_address ?? "", {
        updateDefault: true,
      });
      return;
    }
    if (answer.startsWith("n")) {
      await askRescheduleHomeAddress(supabase, guardianPhone, guardianId, context.category, appointment);
      return;
    }

    const notUnderstood = texts.notUnderstoodYesNoText();
    await sendAndLog(supabase, guardianId, "bot_not_understood", notUnderstood, () =>
      sendTextMessage({ to: guardianPhone, body: notUnderstood })
    );
    const body = texts.homeAddressConfirmNewText(context.pending_home_address ?? "");
    await sendAndLog(supabase, guardianId, "bot_reschedule_home_address_confirm_new", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
  }
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
    const body = texts.rescheduleNoAppointmentsText(category);
    await sendAndLog(supabase, guardianId, "bot_reschedule_no_appointments", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await updateConversationState(supabase, guardianPhone, "WELCOME", { context: {} });
    return;
  }

  if (candidates.length <= 3) {
    await sendAppointmentChoice(supabase, guardianPhone, guardianId, category, candidates);
    await updateConversationState(supabase, guardianPhone, "RESCHEDULE_SELECT", {
      context: { category, awaiting: "appointment_choice", candidates } satisfies RescheduleContext,
    });
    return;
  }

  const body = texts.askBirthdateText();
  await sendAndLog(supabase, guardianId, "bot_reschedule_ask_birthdate", body, () =>
    sendTextMessage({ to: guardianPhone, body })
  );
  // Guarda a lista completa no contexto — a busca por data de nascimento
  // filtra em memória, sem precisar consultar o banco de novo.
  await updateConversationState(supabase, guardianPhone, "RESCHEDULE_SELECT", {
    context: { category, awaiting: "birthdate_search", candidates } satisfies RescheduleContext,
  });
}

async function sendAppointmentChoice(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  category: AppointmentCategory,
  candidates: AppointmentCandidate[]
): Promise<void> {
  const body = texts.appointmentChoiceBodyText("remarcar", category);
  await sendAndLog(supabase, guardianId, "bot_reschedule_choice", body, () =>
    sendInteractiveListMessage({
      to: guardianPhone,
      bodyText: body,
      buttonText: "Escolher opção",
      sections: texts.appointmentListSections(candidates, "reschedule"),
    })
  );
}

async function finishReschedule(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  appointment: AppointmentCandidate
): Promise<void> {
  if (!guardianId) {
    await sendRescheduleLinkError(supabase, guardianPhone, guardianId);
    return;
  }

  // Remarcar consulta/retorno também deixa a data escolhida decidir o
  // consultório físico (pode não ser o mesmo de antes) — mesma lógica do
  // agendamento novo. Exame continua preso ao único local type='exam'.
  const isExam = appointment.appointment_type === "exam";
  let locationCategory: "clinic" | "home_visit" | null = null;
  if (!isExam) {
    const { data: currentLocation } = await supabase
      .from("clinic_locations")
      .select("type")
      .eq("id", appointment.clinic_location_id)
      .maybeSingle();
    locationCategory = currentLocation?.type === "home_visit" ? "home_visit" : "clinic";
  }

  // Domiciliar: reconfirma o endereço antes de gerar o link (regra do
  // cliente, Fase 16) — o link só é criado depois, em `finishRescheduleWithAddress`.
  if (locationCategory === "home_visit") {
    await enterRescheduleHomeAddress(supabase, guardianPhone, guardianId, "consulta", appointment);
    return;
  }

  await createRescheduleLink(supabase, guardianPhone, guardianId, appointment, locationCategory, null);
}

// --- endereço do atendimento domiciliar ao remarcar (Fase 16) -------------

// Sempre reconfirma, nunca reaproveita o endereço gravado sem perguntar de
// novo (decisão do cliente) — se houver um, pergunta "ainda é esse?"; sem
// um gravado (achado raro, ex.: consulta muito antiga), pede direto.
async function enterRescheduleHomeAddress(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string,
  category: AppointmentCategory,
  appointment: AppointmentCandidate
): Promise<void> {
  if (appointment.home_visit_address) {
    const body = texts.homeAddressConfirmCurrentText(appointment.home_visit_address);
    await sendAndLog(supabase, guardianId, "bot_reschedule_home_address_confirm_current", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await updateConversationState(supabase, guardianPhone, "RESCHEDULE_HOME_ADDRESS", {
      context: {
        category,
        awaiting: "home_address_confirm_current",
        pending_appointment: appointment,
        pending_home_address: appointment.home_visit_address,
      } satisfies RescheduleContext,
    });
    return;
  }

  await askRescheduleHomeAddress(supabase, guardianPhone, guardianId, category, appointment);
}

async function askRescheduleHomeAddress(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string,
  category: AppointmentCategory,
  appointment: AppointmentCandidate
): Promise<void> {
  const body = texts.homeAddressAskText();
  await sendAndLog(supabase, guardianId, "bot_reschedule_home_address_ask", body, () =>
    sendTextMessage({ to: guardianPhone, body })
  );
  await updateConversationState(supabase, guardianPhone, "RESCHEDULE_HOME_ADDRESS", {
    context: {
      category,
      awaiting: "home_address_input",
      pending_appointment: appointment,
      pending_home_address: undefined,
    } satisfies RescheduleContext,
  });
}

// Endereço confirmado: atualiza o "padrão" do responsável (só quando mudou
// de fato — confirmar o que já estava gravado não precisa regravar nada) e
// segue pra criação do link, agora com o endereço em mãos.
async function finishRescheduleWithAddress(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string,
  appointment: AppointmentCandidate,
  address: string,
  options: { updateDefault: boolean }
): Promise<void> {
  if (options.updateDefault) {
    const { error } = await supabase
      .from("guardians")
      .update({ default_home_address: address })
      .eq("id", guardianId);
    if (error) {
      console.error("[whatsapp bot] erro ao atualizar endereço padrão do responsável:", error.message);
    }
  }

  await createRescheduleLink(supabase, guardianPhone, guardianId, appointment, "home_visit", address);
}

async function createRescheduleLink(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string,
  appointment: AppointmentCandidate,
  locationCategory: "clinic" | "home_visit" | null,
  homeVisitAddress: string | null
): Promise<void> {
  const isExam = appointment.appointment_type === "exam";
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const { data: link, error } = await supabase
    .from("booking_links")
    .insert({
      guardian_id: guardianId,
      patient_id: appointment.patient_id,
      clinic_location_id: isExam ? appointment.clinic_location_id : null,
      location_category: locationCategory,
      appointment_type: appointment.appointment_type,
      exam_type_id: appointment.exam_type_id,
      home_visit_address: homeVisitAddress,
      mode: "reschedule",
      appointment_id: appointment.id,
      guardian_phone: guardianPhone,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error || !link) {
    console.error("[whatsapp bot] erro ao criar booking_link de remarcação:", error?.message);
    await sendRescheduleLinkError(supabase, guardianPhone, guardianId);
    return;
  }

  const category: AppointmentCategory = isExam ? "exame" : "consulta";
  const url = buildAppUrl(`/agendar/${link.id}`);
  const body = texts.rescheduleLinkText(appointment.patient_name, url, category);
  await sendAndLog(supabase, guardianId, "bot_reschedule_link", body, () =>
    sendTextMessage({ to: guardianPhone, body })
  );
  await updateConversationState(supabase, guardianPhone, "WELCOME", { context: {} });
}

async function sendRescheduleLinkError(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null
): Promise<void> {
  const body = texts.rescheduleLinkErrorText();
  await sendAndLog(supabase, guardianId, "bot_reschedule_link_error", body, () =>
    sendTextMessage({ to: guardianPhone, body })
  );
  await updateConversationState(supabase, guardianPhone, "WELCOME", { context: {} });
}
