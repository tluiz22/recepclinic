// Case 6 · Marcar exame (Fase 6) — estados EXAM_TYPE_SELECT e EXAM_FOR_WHOM
// da máquina de estados do bot.
//
// Não há pergunta de local (todo exame usa o único local
// `clinic_locations.type='exam'`) nem de modalidade. Depois de escolher o
// exame, pergunta "O exame é para você ou para outra pessoa?" (Fase 21):
//   - "Outra pessoa" → mesmo fluxo de identificação de paciente do case 1 ·
//     Agendar (`enterPatientSelect`, em booking.ts), com os textos em
//     "paciente";
//   - "Para mim" → o adulto é o próprio responsável (`is_guardian_self`).
//     Já cadastrado assim → segue direto para o link. Na 1ª vez pede a data
//     de nascimento e confere 18+ (menor → recusa e volta ao menu), o nome
//     (só quando o telefone ainda não tem cadastro) e a confirmação dos
//     dados antes de cadastrar.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendInteractiveButtonsMessage, sendInteractiveListMessage, sendTextMessage } from "../client";
import {
  endFlow,
  formatBirthdateLabel,
  logFunnelStep,
  parseBirthdateInput,
  resolveByListOrDigit,
  sendAndLog,
  updateConversationState,
  type Selection,
} from "./shared";
import {
  enterPatientSelect,
  finishBookingWithPatient,
  sendBookingLinkError,
  type BookingContext,
} from "./booking";
import { filterExamTypesWithSchedule } from "../../scheduling/examScheduleAvailability";
import { todayFortaleza } from "../../scheduling/returnVisitDeadline";
import { isAdult } from "../../age";
import * as texts from "./messages";

export const EXAM_STATES: ReadonlySet<string> = new Set(["EXAM_TYPE_SELECT", "EXAM_FOR_WHOM"]);

interface ExamTypeCandidate {
  id: string;
  name: string;
  // Valor na descrição da linha da lista (valor no início da jornada).
  price_cents?: number | null;
}

interface ExamContext {
  exam_type_candidates?: ExamTypeCandidate[];
  // EXAM_FOR_WHOM: o exame/local já escolhidos, repassados ao fluxo de
  // identificação ou ao link.
  booking?: BookingContext;
  awaiting?: "for_whom" | "self_birthdate" | "self_name" | "self_confirm";
  self_birthdate?: string;
  self_name?: string;
  // "Não" na confirmação: pede o nome de novo mesmo com o telefone já
  // cadastrado (o nome sugerido era o do responsável).
  self_ask_name?: boolean;
}

// MENU opção "Marcar exame" → lista os exam_types ativos com disponibilidade
// cadastrada (regra geral da Fase 11: sem dia/horário cadastrado, o exame
// nem aparece pra escolher).
export async function startExam(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null
): Promise<void> {
  const { data: allExamTypes } = await supabase
    .from("exam_types")
    .select("id, name, scheduling_mode, price_cents")
    .eq("is_active", true)
    .order("name");

  const examTypes = await filterExamTypesWithSchedule(supabase, allExamTypes ?? []);

  if (!examTypes.length) {
    const body = texts.noExamTypesAvailableText();
    await sendAndLog(supabase, guardianId, "bot_exam_no_types", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await endFlow(supabase, guardianPhone, guardianId, "blocked", { reason: "no_exam_types" });
    return;
  }

  await sendExamTypeQuestion(supabase, guardianPhone, guardianId, examTypes);
  const context: ExamContext = { exam_type_candidates: examTypes };
  await updateConversationState(supabase, guardianPhone, "EXAM_TYPE_SELECT", { context });
}

async function sendExamTypeQuestion(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  examTypes: ExamTypeCandidate[]
): Promise<void> {
  const body = texts.examTypeChoiceBodyText();
  await sendAndLog(supabase, guardianId, "bot_exam_type_choice", body, () =>
    sendInteractiveListMessage({
      to: guardianPhone,
      bodyText: body,
      buttonText: "Escolher opção",
      sections: texts.examTypeSections(examTypes),
    })
  );
}

export async function handleExamState(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  state: string,
  rawContext: Record<string, unknown>,
  selection: Selection
): Promise<void> {
  const context = rawContext as ExamContext;

  if (state === "EXAM_FOR_WHOM") {
    await handleForWhom(supabase, guardianPhone, guardianId, context, selection);
    return;
  }

  const candidates = context.exam_type_candidates ?? [];
  const match = resolveByListOrDigit(selection, candidates, (c) => `exam_type_${c.id}`);

  if (!match) {
    const body = texts.notUnderstoodText();
    await sendAndLog(supabase, guardianId, "bot_not_understood", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await sendExamTypeQuestion(supabase, guardianPhone, guardianId, candidates);
    return;
  }

  const { data: examLocation } = await supabase
    .from("clinic_locations")
    .select("id, name")
    .eq("type", "exam")
    .eq("is_active", true)
    .maybeSingle();

  if (!examLocation) {
    console.error("[whatsapp bot] nenhum clinic_locations com type='exam' ativo");
    const body = texts.noExamTypesAvailableText();
    await sendAndLog(supabase, guardianId, "bot_exam_no_types", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    await endFlow(supabase, guardianPhone, guardianId, "error", { reason: "no_exam_location" });
    return;
  }

  const bookingContext: BookingContext = {
    appointment_type: "exam",
    clinic_location_id: examLocation.id,
    clinic_location_label: examLocation.name,
    exam_type_id: match.id,
    exam_type_name: match.name,
  };
  await sendForWhomQuestion(supabase, guardianPhone, guardianId);
  await updateConversationState(supabase, guardianPhone, "EXAM_FOR_WHOM", {
    context: { booking: bookingContext, awaiting: "for_whom" } satisfies ExamContext,
  });
}

// --- EXAM_FOR_WHOM (Fase 21) ------------------------------------------------

async function sendForWhomQuestion(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null
): Promise<void> {
  const body = texts.examForWhomBodyText();
  await sendAndLog(supabase, guardianId, "bot_exam_for_whom", body, () =>
    sendInteractiveButtonsMessage({ to: guardianPhone, bodyText: body, buttons: texts.examForWhomButtons() })
  );
}

async function sendText(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  kind: string,
  body: string
): Promise<void> {
  await sendAndLog(supabase, guardianId, kind, body, () => sendTextMessage({ to: guardianPhone, body }));
}

async function handleForWhom(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  context: ExamContext,
  selection: Selection
): Promise<void> {
  const booking = context.booking;
  if (!booking) {
    await sendBookingLinkError(supabase, guardianPhone, guardianId);
    return;
  }

  const text = selection.text.trim();

  switch (context.awaiting) {
    case "for_whom": {
      const normalized = text.toLowerCase();
      const isSelf = selection.id === texts.EXAM_FOR_WHOM_ID.self || normalized === "1" || normalized === "para mim";
      const isOther =
        selection.id === texts.EXAM_FOR_WHOM_ID.other || normalized === "2" || normalized === "outra pessoa";

      // Funil (Fase 23 · etapa 6): etapa "Disseram para quem".
      if (isOther || isSelf) {
        await logFunnelStep(supabase, guardianPhone, guardianId, "exam_for_whom", { answer: isSelf ? "self" : "other" });
      }
      if (isOther) {
        await updateConversationState(supabase, guardianPhone, "BOOK_PATIENT_SELECT", { context: booking });
        await enterPatientSelect(supabase, guardianPhone, guardianId, booking);
        return;
      }
      if (isSelf) {
        await startSelf(supabase, guardianPhone, guardianId, booking);
        return;
      }

      await sendText(supabase, guardianPhone, guardianId, "bot_not_understood", texts.notUnderstoodText());
      await sendForWhomQuestion(supabase, guardianPhone, guardianId);
      return;
    }

    case "self_birthdate": {
      const isoBirthdate = parseBirthdateInput(text);
      if (!isoBirthdate) {
        await sendText(supabase, guardianPhone, guardianId, "bot_invalid_birthdate", texts.invalidBirthdateText());
        return;
      }

      if (!isAdult(isoBirthdate, todayFortaleza())) {
        await sendText(supabase, guardianPhone, guardianId, "bot_exam_self_minor", texts.examSelfMinorText());
        await endFlow(supabase, guardianPhone, guardianId, "blocked", { reason: "exam_self_minor" });
        return;
      }

      // Telefone já cadastrado: a pessoa é o próprio responsável, o nome já
      // é conhecido — só confirma.
      const guardianName =
        guardianId && !context.self_ask_name
          ? ((await supabase.from("guardians").select("full_name").eq("id", guardianId).maybeSingle()).data
              ?.full_name ?? null)
          : null;

      if (guardianName) {
        await askSelfConfirm(supabase, guardianPhone, guardianId, context, guardianName, isoBirthdate);
        return;
      }

      await sendText(supabase, guardianPhone, guardianId, "bot_exam_self_ask_name", texts.examSelfAskNameText());
      await updateConversationState(supabase, guardianPhone, "EXAM_FOR_WHOM", {
        context: { ...context, awaiting: "self_name", self_birthdate: isoBirthdate } satisfies ExamContext,
      });
      return;
    }

    case "self_name": {
      if (!text || !context.self_birthdate) {
        await sendText(supabase, guardianPhone, guardianId, "bot_exam_self_ask_name", texts.examSelfAskNameText());
        return;
      }
      await askSelfConfirm(supabase, guardianPhone, guardianId, context, text, context.self_birthdate);
      return;
    }

    case "self_confirm": {
      const name = context.self_name;
      const birthdate = context.self_birthdate;
      if (!name || !birthdate) {
        await askSelfBirthdate(supabase, guardianPhone, guardianId, context);
        return;
      }

      const answer = text.toLowerCase();
      if (answer.startsWith("s")) {
        await createSelfPatientAndFinish(supabase, guardianPhone, guardianId, booking, name, birthdate);
        return;
      }
      if (answer.startsWith("n")) {
        // Recomeça pela data de nascimento e pede o nome também.
        await askSelfBirthdate(supabase, guardianPhone, guardianId, { ...context, self_ask_name: true });
        return;
      }

      await sendText(supabase, guardianPhone, guardianId, "bot_not_understood", texts.notUnderstoodYesNoText());
      await sendText(
        supabase,
        guardianPhone,
        guardianId,
        "bot_exam_self_confirm",
        texts.confirmSelfPatientText(name, formatBirthdateLabel(birthdate))
      );
      return;
    }
  }
}

// "Para mim": já cadastrado como próprio responsável → link direto (um
// cadastro excluído na tela é reativado, como o responsável no cadastro).
async function startSelf(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  booking: BookingContext
): Promise<void> {
  if (guardianId) {
    const { data: selfPatient } = await supabase
      .from("patients")
      .select("id, full_name, is_active")
      .eq("guardian_id", guardianId)
      .eq("is_guardian_self", true)
      .maybeSingle();

    if (selfPatient) {
      if (!selfPatient.is_active) {
        await supabase.from("patients").update({ is_active: true }).eq("id", selfPatient.id);
      }
      await finishBookingWithPatient(supabase, guardianPhone, guardianId, booking, selfPatient.id, selfPatient.full_name);
      return;
    }
  }

  await askSelfBirthdate(supabase, guardianPhone, guardianId, { booking });
}

async function askSelfBirthdate(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  context: ExamContext
): Promise<void> {
  await sendText(supabase, guardianPhone, guardianId, "bot_exam_self_ask_birthdate", texts.examSelfAskBirthdateText());
  await updateConversationState(supabase, guardianPhone, "EXAM_FOR_WHOM", {
    context: {
      booking: context.booking,
      self_ask_name: context.self_ask_name,
      awaiting: "self_birthdate",
    } satisfies ExamContext,
  });
}

async function askSelfConfirm(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  context: ExamContext,
  name: string,
  birthdate: string
): Promise<void> {
  await sendText(
    supabase,
    guardianPhone,
    guardianId,
    "bot_exam_self_confirm",
    texts.confirmSelfPatientText(name, formatBirthdateLabel(birthdate))
  );
  await updateConversationState(supabase, guardianPhone, "EXAM_FOR_WHOM", {
    context: { ...context, awaiting: "self_confirm", self_name: name, self_birthdate: birthdate } satisfies ExamContext,
  });
}

// Cadastra o adulto como próprio responsável: no cadastro do telefone, se já
// existe (ex.: mãe que já é responsável por um filho), ou num responsável
// novo com o nome dele. O nome do responsável já cadastrado não é trocado
// pelo bot (o telefone pode ser compartilhado, ex. prefeitura) — só pela
// tela, em Editar paciente.
async function createSelfPatientAndFinish(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  booking: BookingContext,
  name: string,
  birthdate: string
): Promise<void> {
  let guardianIdToUse = guardianId;

  if (!guardianIdToUse) {
    const { data: newGuardian, error } = await supabase
      .from("guardians")
      .insert({ full_name: name, phone: guardianPhone })
      .select("id")
      .single();
    if (error || !newGuardian) {
      console.error("[whatsapp bot] erro ao cadastrar responsável (próprio paciente):", error?.message);
      await sendBookingLinkError(supabase, guardianPhone, guardianId);
      return;
    }
    guardianIdToUse = newGuardian.id;
  }

  const { data: newPatient, error: patientError } = await supabase
    .from("patients")
    .insert({ full_name: name, birthdate, guardian_id: guardianIdToUse, is_guardian_self: true })
    .select("id")
    .single();

  if (patientError || !newPatient) {
    console.error("[whatsapp bot] erro ao cadastrar paciente (próprio responsável):", patientError?.message);
    await sendBookingLinkError(supabase, guardianPhone, guardianIdToUse);
    return;
  }

  await finishBookingWithPatient(supabase, guardianPhone, guardianIdToUse, booking, newPatient.id, name);
}
