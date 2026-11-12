import type { Enums } from "../../supabase/database.types";
import type { DbClient } from "../clients";
import { unwrapOne } from "../errors";
import { getApprovedTemplate } from "./connection";
import { resetConversationAfterNotice } from "./conversations";
import { recordOutboundMessage, type SendOutcome } from "./messages";
import type { ClinicSender } from "./send";
import { appointmentParams, cleanParam, defaultTemplate, fillTemplate, firstName, formatAppointmentWhen, paramCount, serviceLine } from "./templates";
import { logError } from "../../log";
import { bookingPath, shortId } from "../../publicId";
import { portalLinkUrl } from "../../portal";
import { appointmentRecipient, BOOKER_COLUMNS, type RecipientContact } from "./recipient";

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
  failed: "O aviso pelo WhatsApp não saiu: o WhatsApp recusou o envio (veja o histórico).",
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
  patients: { full_name: string; contacts: RecipientContact };
  booker: RecipientContact | null;
};

const NOTICE_COLUMNS = `id, scheduled_at, home_visit_address, services ( name, category ), agendas ( professionals ( display_name ) ), locations ( name, type, address ), patients ( full_name, contacts ( id, full_name, phone ) ), ${BOOKER_COLUMNS}`;

/** Confirmação ao paciente ligada para quem marcou (BE-9; ligada por padrão). Na dúvida (erro ao ler), confirma. */
export async function confirmationEnabled(db: DbClient, clinicId: string, by: "portal" | "reception"): Promise<boolean> {
  const column = by === "portal" ? "confirm_portal_booking" : "confirm_reception_booking";
  const { data } = await db.from("clinic_settings").select(column).eq("clinic_id", clinicId).maybeSingle();
  return (data as Record<string, boolean> | null)?.[column] ?? true;
}

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
  /** Outro destinatário (quem cancelou pelo portal); sem ele, quem marcou (D14). */
  to?: RecipientContact,
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
    const contact = to ?? appointmentRecipient(row);
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
        retry: { outcome, context: { scheduledAt: new Date(row.scheduled_at).toISOString() } },
      },
      now,
    );
    // O "ok" do paciente depois do aviso recomeça a conversa (piloto).
    await resetConversationAfterNotice(db, clinicId, contact.phone);
    return status;
  } catch (error) {
    logError("whatsapp aviso", error, { clinica: clinicId, aviso: kind, atendimento: appointmentId });
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
  canceled: { appointmentId: string; rebookingLinkId: string | null; portalLinkId?: string | null }[],
  sender: ClinicSender | null,
  now: Date = new Date(),
): Promise<ClinicCancellationNotice[]> {
  const result: ClinicCancellationNotice[] = [];
  for (const { appointmentId, rebookingLinkId, portalLinkId } of canceled) {
    // O link do portal (F3-3) quando há; senão, o de /agendar.
    // Sem quem envie (WhatsApp não carregou), o aviso fica "não conectado" igual, mas com o mesmo modelo.
    const url = portalLinkId
      ? sender
        ? portalLinkUrl(sender.baseUrl, shortId(portalLinkId))
        : ""
      : rebookingLinkId
        ? `${sender?.baseUrl ?? ""}${bookingPath(rebookingLinkId)}`
        : null;
    const status = url !== null
      ? await sendAppointmentNotice(db, clinicId, appointmentId, "clinic_cancellation", sender, now, url)
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

// ---------------------------------------------------------------------------
// Aviso ao outro responsável (VR4, D14; textos do cliente, 11/nov/2026)
// ---------------------------------------------------------------------------

export type OtherResponsibleKind = "rescheduled_by_other" | "canceled_by_other";

/**
 * Quem marcou recebe o aviso quando outro responsável remarca ou cancela (portal; o bot depois da F3f). Só com o modelo
 * aprovado na Meta (mensagem paga a mais só neste caso); sem ele, nada sai e nada é registrado. `actor`: quem mexeu,
 * como aparece ("Ana (mãe)"). Nunca lança.
 */
export async function sendOtherResponsibleNotice(
  db: DbClient,
  clinicId: string,
  input: { appointmentId: string; kind: OtherResponsibleKind; booker: RecipientContact; actor: string },
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
        .eq("id", input.appointmentId)
        .maybeSingle()
        .then((r) => unwrapOne(r, "Atendimento") as unknown as NoticeRow),
      getApprovedTemplate(db, clinicId, input.kind),
      db.from("clinic_settings").select("timezone").eq("clinic_id", clinicId).maybeSingle().then((r) => unwrapOne(r, "Configuração da clínica")),
    ]);
    if (!template) return "skipped_no_template";
    const params = [
      firstName(input.booker.full_name),
      sender.clinicLabel,
      input.actor,
      firstName(row.patients.full_name),
      serviceLine(row.services.name, row.agendas.professionals?.display_name ?? null),
      formatAppointmentWhen(new Date(row.scheduled_at), settings.timezone),
    ].map(cleanParam);
    let outcome: SendOutcome;
    try {
      outcome = await sender.template(input.booker.phone, input.kind, template, params);
    } catch (error) {
      outcome = { sent: false, reason: error instanceof Error ? error.message : String(error) };
    }
    const status: NoticeStatus = outcome.sent ? "sent" : "failed";
    await recordOutboundMessage(
      db,
      clinicId,
      {
        phone: input.booker.phone,
        contactId: input.booker.id,
        appointmentId: row.id,
        messageType: `appointment_${input.kind}`,
        templateName: template.name,
        body: outcome.body ?? fillTemplate(template.body ?? defaultTemplate(input.kind)!.body, params),
        status,
        waMessageId: outcome.sent ? outcome.messageId : null,
        retry: { outcome, context: { scheduledAt: new Date(row.scheduled_at).toISOString() } },
      },
      now,
    );
    return status;
  } catch (error) {
    logError("aviso ao outro responsável não enviado", error, { clinica: clinicId, atendimento: input.appointmentId });
    return "failed";
  }
}

