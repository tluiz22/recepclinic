import type { Enums } from "../../supabase/database.types";
import type { DbClient } from "../clients";
import { unwrapOne } from "../errors";
import { getApprovedTemplate } from "./connection";
import { resetConversationAfterNotice } from "./conversations";
import { recordOutboundMessage, type SendOutcome } from "./messages";
import type { ClinicSender } from "./send";
import { appointmentParams, defaultTemplate, fillTemplate, paramCount } from "./templates";

// Avisos ao paciente (F6.2), como no piloto: marcado, remarcado e cancelado,
// pela Agenda do painel e pela página /agendar. Sempre por template (podem
// sair fora da janela de 24h). "Melhor esforço": a ação já aconteceu; o aviso
// que não sai fica registrado e nunca desfaz nem trava a ação. Sem o
// WhatsApp conectado, nada é registrado (como no lembrete).

export type NoticeKind = "confirmation" | "reschedule" | "cancellation";

export const NOTICE_MESSAGE_TYPES: Record<NoticeKind, string> = {
  confirmation: "appointment_confirmation",
  reschedule: "appointment_reschedule",
  cancellation: "appointment_cancellation",
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
    const params = appointmentParams(sender.clinicLabel, {
      contactName: contact.full_name,
      patientName: row.patients.full_name,
      serviceName: row.services.name,
      professionalName: row.agendas.professionals?.display_name ?? null,
      scheduledAt: new Date(row.scheduled_at),
      timeZone: settings.timezone,
      locationName: row.locations.name,
      isHomeVisit: row.locations.type === "home_visit",
      address: row.home_visit_address ?? row.locations.address,
    });

    let outcome: SendOutcome | null = null;
    if (template) {
      try {
        outcome = await sender.template(contact.phone, kind, template, params);
      } catch (error) {
        outcome = { sent: false, reason: error instanceof Error ? error.message : String(error) };
      }
    }
    const known = defaultTemplate(kind)!;
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

