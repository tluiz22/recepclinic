// Toque nos botões do lembrete (Fase 19): Confirmar presença · Remarcar ·
// Cancelar. O payload (`reminder:<ação>:<appointment_id>`, ver
// `reminderButtonPayload` em `../notifications.ts`) diz qual atendimento —
// um responsável-convênio recebe um lembrete por criança.
//
// Tratado pelo roteador ANTES da máquina de estados: o toque vale em
// qualquer estado da conversa. Confirmar vale até com o bot pausado
// (atendimento humano); Remarcar e Cancelar respeitam a pausa — o bot não
// responde e a secretária vê o toque no app.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTextMessage } from "../client";
import { formatWhen } from "../formatDateTime";
import { startFunnel } from "../funnel";
import { logAppointmentEvent } from "../../audit";
import { REMINDER_ACTIONS, type ReminderAction } from "../notifications";
import type { WaMessage } from "../types";
import { sendAndLog, type AppointmentCandidate } from "./shared";
import { startCancelForAppointment } from "./cancel";
import { startRescheduleForAppointment } from "./reschedule";
import * as texts from "./messages";

export interface ReminderTap {
  action: ReminderAction;
  appointmentId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseReminderTap(waMsg: WaMessage): ReminderTap | null {
  const [prefix, action, appointmentId] = (waMsg.button?.payload ?? "").split(":");
  if (prefix !== "reminder" || !REMINDER_ACTIONS.includes(action as ReminderAction)) return null;
  if (!appointmentId || !UUID_RE.test(appointmentId)) return null;
  return { action: action as ReminderAction, appointmentId };
}

// Resultado para o roteador: "inactive" = toque inválido/atrasado, já
// respondido — o roteador cai no menu (se o bot não estiver pausado).
export type ReminderTapResult = "handled" | "inactive";

const RESPONSE_BY_ACTION: Record<ReminderAction, string> = {
  confirm: "confirmed",
  reschedule: "reschedule",
  cancel: "cancel",
};

export async function handleReminderTap(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  waMsg: WaMessage,
  tap: ReminderTap,
  botPaused: boolean
): Promise<ReminderTapResult> {
  const appointment = await fetchActiveReminderAppointment(supabase, tap.appointmentId, guardianId);

  if (!appointment) {
    // Com o bot pausado, só o Confirmar responde (ver cabeçalho).
    if (!botPaused || tap.action === "confirm") {
      const body = texts.reminderInactiveText();
      await sendAndLog(supabase, guardianId, "bot_reminder_inactive", body, () =>
        sendTextMessage({ to: guardianPhone, body })
      );
    }
    return "inactive";
  }

  // Registro do toque, gravado mesmo com o bot pausado (o paciente
  // respondeu de fato): na linha do atendimento e na própria mensagem
  // recebida, já registrada pelo webhook — essa segunda sobrevive à
  // remarcação, que zera `reminder_response` (métricas, etapa 5).
  const now = new Date().toISOString();
  const confirmNow = tap.action === "confirm" && !appointment.patient_confirmed_at;
  const { error } = await supabase
    .from("appointments")
    .update({
      reminder_response: RESPONSE_BY_ACTION[tap.action],
      reminder_response_at: now,
      ...(confirmNow ? { patient_confirmed_at: now, patient_confirmed_by: null } : {}),
    })
    .eq("id", appointment.id);
  if (error) {
    console.error("[whatsapp bot] erro ao gravar resposta ao lembrete:", error.message);
  } else if (confirmNow) {
    await logAppointmentEvent(supabase, {
      appointmentId: appointment.id,
      type: "presence_confirmed",
      channel: "whatsapp_bot",
    });
  }
  if (waMsg.id) {
    await supabase
      .from("whatsapp_messages")
      .update({ appointment_id: appointment.id, message_type: `reminder_${tap.action}` })
      .eq("wa_message_id", waMsg.id);
  }

  const whenLabel = formatWhen(new Date(appointment.scheduled_at));

  if (tap.action === "confirm") {
    const body = confirmNow
      ? texts.reminderPresenceConfirmedText(appointment.patient_name, whenLabel)
      : texts.reminderPresenceAlreadyConfirmedText(appointment.patient_name, whenLabel);
    await sendAndLog(supabase, guardianId, "bot_reminder_confirmed", body, () =>
      sendTextMessage({ to: guardianPhone, body })
    );
    return "handled";
  }

  if (botPaused) return "handled";

  const category = appointment.appointment_type === "exam" ? "exame" : "consulta";
  if (tap.action === "cancel") {
    await startFunnel(supabase, guardianPhone, guardianId, "cancel", { category, source: "reminder" });
    await startCancelForAppointment(supabase, guardianPhone, guardianId, appointment);
  } else {
    await startFunnel(supabase, guardianPhone, guardianId, "reschedule", { category, source: "reminder" });
    await startRescheduleForAppointment(supabase, guardianPhone, guardianId, appointment);
  }
  return "handled";
}

interface ReminderAppointment extends AppointmentCandidate {
  patient_confirmed_at: string | null;
}

// Atendimento do toque, só se ainda vale: deste responsável, ativo, futuro e
// com o lembrete ainda de pé — `reminder_sent_at` nulo = foi remarcado
// depois deste lembrete (a remarcação zera, etapa 1), toque de uma data
// antiga.
async function fetchActiveReminderAppointment(
  supabase: SupabaseClient,
  appointmentId: string,
  guardianId: string | null
): Promise<ReminderAppointment | null> {
  if (!guardianId) return null;

  const { data: row } = await supabase
    .from("appointments")
    .select(
      "id, status, scheduled_at, reminder_sent_at, patient_confirmed_at, clinic_location_id, appointment_type, exam_type_id, home_visit_address, origin_appointment_id, patient_id, patients!inner(full_name, birthdate, guardian_id)"
    )
    .eq("id", appointmentId)
    .maybeSingle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patient = (row?.patients ?? null) as any;
  if (
    !row ||
    patient?.guardian_id !== guardianId ||
    !["scheduled", "confirmed"].includes(row.status) ||
    new Date(row.scheduled_at).getTime() <= Date.now() ||
    !row.reminder_sent_at
  ) {
    return null;
  }

  return {
    id: row.id,
    patient_id: row.patient_id,
    patient_name: patient?.full_name ?? "Paciente",
    birthdate: patient?.birthdate ?? "",
    scheduled_at: row.scheduled_at,
    clinic_location_id: row.clinic_location_id,
    appointment_type: row.appointment_type,
    exam_type_id: row.exam_type_id ?? null,
    home_visit_address: row.home_visit_address ?? null,
    origin_appointment_id: row.origin_appointment_id ?? null,
    patient_confirmed_at: row.patient_confirmed_at ?? null,
  };
}
