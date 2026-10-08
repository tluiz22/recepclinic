import type { Enums } from "../../supabase/database.types";
import type { DbClient } from "../clients";
import { unwrapOne } from "../errors";
import { getApprovedTemplate } from "./connection";
import { resetConversationAfterNotice } from "./conversations";
import { recordOutboundMessage, type SendOutcome } from "./messages";
import type { ClinicSender } from "./send";
import { appointmentParams, cleanParam, defaultTemplate, fillTemplate, firstName, formatAppointmentWhen, paramCount } from "./templates";

// Avisos ao paciente (F6.2), como no piloto: marcado, remarcado e cancelado,
// pela Agenda do painel e pela página /agendar. Sempre por template (podem
// sair fora da janela de 24h). "Melhor esforço": a ação já aconteceu; o aviso
// que não sai fica registrado e nunca desfaz nem trava a ação. Sem o
// WhatsApp conectado, nada é registrado (como no lembrete).

/** `clinic_cancellation`: cancelamento pela clínica com o link de remarcação (F6.5). */
export type NoticeKind = "confirmation" | "reschedule" | "cancellation" | "clinic_cancellation";

export const NOTICE_MESSAGE_TYPES: Record<NoticeKind, string> = {
  confirmation: "appointment_confirmation",
  reschedule: "appointment_reschedule",
  cancellation: "appointment_cancellation",
  clinic_cancellation: "appointment_mass_cancellation",
};

export type NoticeStatus = "sent" | "failed" | "skipped_no_template" | "not_connected";

/** Frase curta para o aviso de salvo da tela. */
export const NOTICE_RESULT_TEXT: Record<NoticeStatus, string> = {
  sent: "Aviso enviado ao paciente pelo WhatsApp.",
  failed: "O aviso pelo WhatsApp não saiu: o WhatsApp recusou o envio (veja a trilha).",
  skipped_no_template: "O aviso pelo WhatsApp não saiu: o template ainda não está aprovado.",
  not_connected: "Sem aviso pelo WhatsApp: o WhatsApp da clínica não está conectado.",
};

type NoticeRow = {
  id: string;
  scheduled_at: string;
  home_visit_address: string | null;
  services: { name: string; category: Enums<"service_category"> };
  agendas: { professionals: { display_name: string } | null };
  locations: { name: string; type: Enums<"location_type">; address: string | null };
  patients: { full_name: string; contacts: { id: string; full_name: string; phone: string } };
};

const NOTICE_COLUMNS =
  "id, scheduled_at, home_visit_address, services ( name, category ), agendas ( professionals ( display_name ) ), locations ( name, type, address ), patients ( full_name, contacts ( id, full_name, phone ) )";

/** Envia o aviso de um atendimento e registra. Nunca lança: erro vira "failed" no log. */
export async function sendAppointmentNotice(
  db: DbClient,
  clinicId: string,
  appointmentId: string,
  kind: NoticeKind,
  sender: ClinicSender | null,
  now: Date = new Date(),
  /** Só no `clinic_cancellation`: o endereço do link de remarcação. */
  rebookingUrl?: string,
): Promise<NoticeStatus> {
  if (!sender) return "not_connected";
  try {
    const [row, template, settings] = await Promise.all([
      db
        .from("appointments")
        .select(NOTICE_COLUMNS)
        .eq("clinic_id", clinicId)
        .eq("id", appointmentId)
        .maybeSingle()
        .then((r) => unwrapOne(r, "Atendimento") as unknown as NoticeRow),
      getApprovedTemplate(db, clinicId, kind),
      db
        .from("clinic_settings")
        .select("timezone")
        .eq("clinic_id", clinicId)
        .maybeSingle()
        .then((r) => unwrapOne(r, "Configuração da clínica")),
    ]);
    const contact = row.patients.contacts;
    const appointmentData = {
      contactName: contact.full_name,
      patientName: row.patients.full_name,
      serviceName: row.services.name,
      professionalName: row.agendas.professionals?.display_name ?? null,
      scheduledAt: new Date(row.scheduled_at),
      timeZone: settings.timezone,
      locationName: row.locations.name,
      isHomeVisit: row.locations.type === "home_visit",
      address: row.home_visit_address ?? row.locations.address,
    };
    // Cancelamento pela clínica: {{3}} paciente, {{4}} serviço, {{5}} data, {{6}} link.
    const params =
      kind === "clinic_cancellation"
        ? [
            firstName(contact.full_name),
            sender.clinicLabel,
            firstName(row.patients.full_name),
            row.services.name,
            formatAppointmentWhen(appointmentData.scheduledAt, appointmentData.timeZone),
            rebookingUrl ?? "",
          ].map(cleanParam)
        : appointmentParams(sender.clinicLabel, appointmentData);

    let outcome: SendOutcome | null = null;
    if (template) {
      try {
        outcome = await sender.template(contact.phone, kind, template, params);
      } catch (error) {
        outcome = { sent: false, reason: error instanceof Error ? error.message : String(error) };
      }
    }
    const known = { body: template?.body ?? defaultTemplate(kind)!.body };
    const status: NoticeStatus = !outcome ? "skipped_no_template" : outcome.sent ? "sent" : "failed";
    await recordOutboundMessage(
      db,
      clinicId,
      {
        phone: contact.phone,
        contactId: contact.id,
        appointmentId: row.id,
        messageType: NOTICE_MESSAGE_TYPES[kind],
        templateName: template?.name ?? null,
        body: outcome?.body ?? fillTemplate(known.body, params.slice(0, paramCount(known.body))),
        status,
        waMessageId: outcome?.sent ? outcome.messageId : null,
      },
      now,
    );
    // O "ok" do paciente depois do aviso recomeça a conversa (piloto).
    await resetConversationAfterNotice(db, clinicId, contact.phone);
    return status;
  } catch (error) {
    console.error(`[whatsapp aviso] ${kind} de ${appointmentId}:`, error instanceof Error ? error.message : String(error));
    return "failed";
  }
}

/** Primeiro atendimento (pela data) de uma lista: o único avisado nas ações de série (cliente, 07/out). */
export function firstByDate<T extends { id: string; scheduledAt: Date }>(appointments: T[]): T | null {
  return appointments.reduce<T | null>((first, a) => (!first || a.scheduledAt < first.scheduledAt ? a : first), null);
}

export type ClinicCancellationNotice = { appointmentId: string; status: NoticeStatus };

/**
 * Cancelamento pela clínica (F6.5): cada paciente recebe o aviso com o link de
 * remarcação; sem link (clínica sem o bot, D11), o aviso de cancelamento da
 * F6.2. Devolve a situação de cada um (a tela mostra quem não recebeu).
 */
export async function notifyClinicCancellations(
  db: DbClient,
  clinicId: string,
  canceled: { appointmentId: string; rebookingLinkId: string | null }[],
  sender: ClinicSender | null,
  now: Date = new Date(),
): Promise<ClinicCancellationNotice[]> {
  const result: ClinicCancellationNotice[] = [];
  for (const { appointmentId, rebookingLinkId } of canceled) {
    const status = rebookingLinkId
      ? await sendAppointmentNotice(db, clinicId, appointmentId, "clinic_cancellation", sender, now, `${sender?.baseUrl ?? ""}/agendar/${rebookingLinkId}`)
      : await sendAppointmentNotice(db, clinicId, appointmentId, "cancellation", sender, now);
    result.push({ appointmentId, status });
  }
  return result;
}

/** Aviso de salvo do cancelamento pela clínica: quantos foram e quantos avisos saíram. */
export function clinicCancellationSummary(notices: ClinicCancellationNotice[]): string {
  const sent = notices.filter((n) => n.status === "sent").length;
  const missed = notices.length - sent;
  const head = notices.length === 1 ? "1 atendimento cancelado." : `${notices.length} atendimentos cancelados.`;
  if (!missed) return `${head} ${notices.length === 1 ? "O paciente recebeu" : "Todos receberam"} o aviso pelo WhatsApp.`;
  const sentText = sent === 1 ? "1 aviso enviado pelo WhatsApp" : `${sent} avisos enviados pelo WhatsApp`;
  const missedText = missed === 1 ? "1 não saiu" : `${missed} não saíram`;
  return `${head} ${sentText}; ${missedText}: avise abaixo.`;
}
