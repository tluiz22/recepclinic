import type { DbClient } from "../clients";
import { unwrap, unwrapOne } from "../errors";
import { logTrail } from "../agenda/appointments";
import { getApprovedTemplate, getWhatsappConnection } from "./connection";
import { getGuidance } from "./customMessages";
import { isCustomerServiceWindowOpen, recordOutboundMessage, type DeliveryUpdate, type SendOutcome } from "./messages";
import { PREPARATION_TRIGGER_TYPES } from "./preparation";

// Orientações gerais da consulta (cliente, 08/out/2026), com as regras do
// preparo do exame (preparation.ts): saem **uma única vez**, depois que a
// confirmação da marcação de uma consulta (não retorno nem exame) chega ao
// celular; nunca na remarcação nem no lembrete. O botão "Reenviar
// orientações" vale para consulta ativa e futura cuja última tentativa não
// chegou. Só com o envio ligado em Configurações › WhatsApp e o texto escrito
// na aba Mensagens; fora da matriz de acesso.
//
// Janela de 24h aberta → "Orientações gerais para a consulta:" e o texto;
// fechada → template com o link da página das orientações.

export const GUIDANCE_MESSAGE_TYPE = "consultation_guidance";

const NOT_DELIVERED = new Set(["failed", "skipped_no_template"]);
const ACTIVE = ["scheduled", "confirmed"];

export type GuidanceToSend = {
  clinicId: string;
  appointmentId: string;
  phone: string;
  contactName: string;
  patientName: string;
  /** Texto da clínica (formatação do WhatsApp). */
  text: string;
  /** Caminho da página pública das orientações (quem envia monta o endereço do site). */
  pagePath: string;
  /** Texto livre (janela aberta) ou template (fechada). */
  mode: "text" | "template";
  template: { name: string; language: string; body?: string | null } | null;
};

export type GuidanceSender = (guidance: GuidanceToSend) => Promise<SendOutcome>;

/** Situação registrada ("sent", "failed", "skipped_no_template") ou "not_connected" (nada registrado). */
export type GuidanceStatus = "sent" | "failed" | "skipped_no_template" | "not_connected";

export const guidancePagePath = (clinicId: string) => `/orientacoes/${clinicId}`;

type ConsultationRow = {
  id: string;
  status: string;
  scheduled_at: string;
  services: { category: string };
  patients: { full_name: string; contacts: { id: string; full_name: string; phone: string } };
};

async function loadConsultation(db: DbClient, clinicId: string, appointmentId: string, now: Date): Promise<ConsultationRow | null> {
  const row = unwrap(
    await db
      .from("appointments")
      .select("id, status, scheduled_at, services ( category ), patients ( full_name, contacts ( id, full_name, phone ) )")
      .eq("clinic_id", clinicId)
      .eq("id", appointmentId)
      .maybeSingle(),
    "Atendimento",
  ) as unknown as ConsultationRow | null;
  if (!row || row.services.category !== "consultation" || !ACTIVE.includes(row.status) || Date.parse(row.scheduled_at) <= now.getTime()) {
    return null;
  }
  return row;
}

/** Envio ligado e texto escrito: o texto; senão null. */
async function enabledGuidance(db: DbClient, clinicId: string): Promise<string | null> {
  const settings = unwrapOne(await db.from("clinic_settings").select("guidance_enabled").eq("clinic_id", clinicId).maybeSingle(), "Configuração da clínica");
  if (!settings.guidance_enabled) return null;
  return (await getGuidance(db, clinicId))?.trim() || null;
}

/** Envia as orientações e registra. */
async function deliverGuidance(db: DbClient, clinicId: string, row: ConsultationRow, text: string, sender: GuidanceSender, now: Date): Promise<GuidanceStatus> {
  const connection = await getWhatsappConnection(db, clinicId);
  if (connection?.status !== "connected") return "not_connected";

  const contact = row.patients.contacts;
  const windowOpen = await isCustomerServiceWindowOpen(db, clinicId, contact.phone, now);
  const template = windowOpen ? null : await getApprovedTemplate(db, clinicId, "consultation_guidance");

  let status: GuidanceStatus;
  let messageId: string | null = null;
  let body: string | null = null;
  if (!windowOpen && !template) {
    // Registrado como tentativa: o botão "Reenviar orientações" aparece.
    status = "skipped_no_template";
  } else {
    let outcome: SendOutcome;
    try {
      outcome = await sender({
        clinicId,
        appointmentId: row.id,
        phone: contact.phone,
        contactName: contact.full_name,
        patientName: row.patients.full_name,
        text,
        pagePath: guidancePagePath(clinicId),
        mode: windowOpen ? "text" : "template",
        template,
      });
    } catch (error) {
      outcome = { sent: false, reason: error instanceof Error ? error.message : String(error) };
    }
    status = outcome.sent ? "sent" : "failed";
    messageId = outcome.sent ? outcome.messageId : null;
    body = outcome.body ?? null;
  }

  await recordOutboundMessage(
    db,
    clinicId,
    {
      phone: contact.phone,
      contactId: contact.id,
      appointmentId: row.id,
      messageType: GUIDANCE_MESSAGE_TYPE,
      templateName: template?.name ?? null,
      body,
      status,
      waMessageId: messageId,
    },
    now,
  );
  return status;
}

/**
 * Chamado quando uma mensagem chega ao celular (como o preparo): se é a
 * confirmação de uma consulta ativa e futura sem orientações já enviadas,
 * com o envio ligado e o texto escrito, envia.
 */
export async function sendGuidanceAfterDelivery(
  db: DbClient,
  clinicId: string,
  delivered: DeliveryUpdate,
  sender: GuidanceSender,
  now: Date = new Date(),
): Promise<GuidanceStatus | null> {
  if (!delivered.updated || !delivered.reachedPhone) return null;
  const { appointmentId, messageType } = delivered.message;
  if (!appointmentId || !PREPARATION_TRIGGER_TYPES.includes(messageType)) return null;
  const text = await enabledGuidance(db, clinicId);
  if (!text) return null;

  const previous = unwrap(
    await db
      .from("whatsapp_messages")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("appointment_id", appointmentId)
      .eq("direction", "outbound")
      .eq("message_type", GUIDANCE_MESSAGE_TYPE)
      .limit(1),
    "Mensagens do WhatsApp",
  );
  if (previous.length > 0) return null;

  const row = await loadConsultation(db, clinicId, appointmentId, now);
  return row ? deliverGuidance(db, clinicId, row, text, sender, now) : null;
}

/** Quais destes atendimentos mostram "Reenviar orientações": a última tentativa não chegou. */
export async function listGuidanceResendable(db: DbClient, clinicId: string, appointmentIds: string[]): Promise<Set<string>> {
  if (appointmentIds.length === 0) return new Set();
  const rows = unwrap(
    await db
      .from("whatsapp_messages")
      .select("appointment_id, status")
      .eq("clinic_id", clinicId)
      .eq("direction", "outbound")
      .eq("message_type", GUIDANCE_MESSAGE_TYPE)
      .in("appointment_id", appointmentIds)
      .order("created_at"),
    "Mensagens do WhatsApp",
  );
  const latest = new Map<string, string | null>();
  for (const row of rows) latest.set(row.appointment_id!, row.status);
  return new Set(appointmentIds.filter((id) => NOT_DELIVERED.has(latest.get(id) ?? "")));
}

// Aviso na tela depois do botão.
export type GuidanceResendOutcome = "sent" | "failed" | "no_template" | "not_connected" | "not_enabled" | "not_eligible";

export const GUIDANCE_RESEND_MESSAGES: Record<GuidanceResendOutcome, { text: string; ok: boolean }> = {
  sent: { text: "Orientações reenviadas.", ok: true },
  failed: { text: "As orientações não foram enviadas: o WhatsApp recusou o envio. Veja a trilha do atendimento.", ok: false },
  no_template: { text: "As orientações não foram enviadas: o template das orientações gerais não está aprovado.", ok: false },
  not_connected: { text: "As orientações não foram enviadas: o WhatsApp da clínica não está conectado.", ok: false },
  not_enabled: { text: "O envio das orientações gerais está desligado em Configurações › WhatsApp.", ok: false },
  not_eligible: { text: "Nada a reenviar: as orientações já foram entregues, a consulta foi cancelada ou já passou.", ok: false },
};

/** "Reenviar orientações" da tela. Quem reenviou fica na trilha mesmo se falhar. */
export async function resendGuidance(
  db: DbClient,
  clinicId: string,
  appointmentId: string,
  actorId: string | null,
  sender: GuidanceSender,
  now: Date = new Date(),
): Promise<GuidanceResendOutcome> {
  const text = await enabledGuidance(db, clinicId);
  if (!text) return "not_enabled";
  const row = await loadConsultation(db, clinicId, appointmentId, now);
  // Tela desatualizada ou clique duplo: as orientações já foram entregues.
  if (!row || !(await listGuidanceResendable(db, clinicId, [appointmentId])).has(appointmentId)) return "not_eligible";

  const status = await deliverGuidance(db, clinicId, row, text, sender, now);
  if (status === "not_connected") return "not_connected";
  await logTrail(db, clinicId, appointmentId, "guidance_resent", "admin", actorId);
  if (status === "skipped_no_template") return "no_template";
  return status === "sent" ? "sent" : "failed";
}
