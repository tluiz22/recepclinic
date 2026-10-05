import type { DbClient } from "../clients";
import { unwrap } from "../errors";
import { hasFeature } from "../features";
import { logTrail } from "../agenda/appointments";
import { getApprovedTemplate, getWhatsappConnection } from "./connection";
import { isCustomerServiceWindowOpen, recordOutboundMessage, type DeliveryUpdate, type SendOutcome } from "./messages";

// Preparo do exame (Fase 18 do piloto), F3.9b. Regra do cliente (piloto,
// 03/out/2026): as orientações saem **uma única vez**, depois que a
// confirmação da marcação do exame chega ao celular (a Meta avisa a entrega,
// updateDeliveryStatus) — nunca junto do lembrete, nem de novo na remarcação
// ou na presença confirmada. O botão "Reenviar preparo do exame" vale para
// exame ativo e futuro cuja última tentativa não chegou.
//
// Janela de 24h aberta → texto com o preparo e o link da página do preparo;
// fechada → template com o nome do exame e o link. Exame sem preparo
// cadastrado não envia nada. Só com o item "Exames e procedimentos" liberado
// e o WhatsApp conectado. O envio de verdade é de quem chama (F6/F7).

export const PREPARATION_MESSAGE_TYPE = "exam_preparation";
/** Mensagens cuja entrega dispara o preparo. */
export const PREPARATION_TRIGGER_TYPES = ["appointment_confirmation"];

const NOT_DELIVERED = new Set(["failed", "skipped_no_template"]);
const ACTIVE = ["scheduled", "confirmed"];

export type PreparationToSend = {
  clinicId: string;
  appointmentId: string;
  phone: string;
  contactName: string;
  patientName: string;
  examName: string;
  /** Orientações cadastradas no serviço (formatação do WhatsApp). */
  instructions: string;
  /** Caminho da página pública do preparo (quem envia monta o endereço do site). */
  pagePath: string;
  /** Texto livre (janela aberta) ou template (fechada). */
  mode: "text" | "template";
  template: { name: string; language: string } | null;
};

export type PreparationSender = (preparation: PreparationToSend) => Promise<SendOutcome>;

/** Situação registrada ("sent", "failed", "skipped_no_template") ou "not_connected" (nada registrado). */
export type PreparationStatus = "sent" | "failed" | "skipped_no_template" | "not_connected";

type ExamRow = {
  id: string;
  status: string;
  scheduled_at: string;
  service_id: string;
  services: { name: string; category: string; preparation_instructions: string | null };
  patients: { full_name: string; contacts: { id: string; full_name: string; phone: string } };
};

const EXAM_COLUMNS =
  "id, status, scheduled_at, service_id, services ( name, category, preparation_instructions ), patients ( full_name, contacts ( id, full_name, phone ) )";

async function loadExam(db: DbClient, clinicId: string, appointmentId: string, now: Date): Promise<ExamRow | null> {
  const row = unwrap(
    await db.from("appointments").select(EXAM_COLUMNS).eq("clinic_id", clinicId).eq("id", appointmentId).maybeSingle(),
    "Atendimento",
  ) as unknown as ExamRow | null;
  if (!row || row.services.category !== "exam" || !ACTIVE.includes(row.status) || Date.parse(row.scheduled_at) <= now.getTime()) {
    return null;
  }
  return row;
}

/** Envia o preparo e registra; null = não é exame ativo e futuro com preparo cadastrado. */
async function deliverPreparation(
  db: DbClient,
  clinicId: string,
  row: ExamRow,
  sender: PreparationSender,
  now: Date,
): Promise<PreparationStatus | null> {
  const instructions = row.services.preparation_instructions?.trim();
  if (!instructions) return null;
  const connection = await getWhatsappConnection(db, clinicId);
  if (connection?.status !== "connected") return "not_connected";

  const contact = row.patients.contacts;
  const windowOpen = await isCustomerServiceWindowOpen(db, clinicId, contact.phone, now);
  const template = windowOpen ? null : await getApprovedTemplate(db, clinicId, "exam_preparation");

  let status: PreparationStatus;
  let messageId: string | null = null;
  let body: string | null = null;
  if (!windowOpen && !template) {
    // Registrado como tentativa: o botão "Reenviar preparo" aparece.
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
        examName: row.services.name,
        instructions,
        pagePath: `/preparo/${row.service_id}`,
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
      messageType: PREPARATION_MESSAGE_TYPE,
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
 * Chamado quando uma mensagem chega ao celular (updateDeliveryStatus com
 * `reachedPhone`): se é a confirmação de um exame ativo e futuro sem preparo
 * já enviado (envio único; o que falhou é reenviado pelo botão), envia.
 */
export async function sendPreparationAfterDelivery(
  db: DbClient,
  clinicId: string,
  delivered: DeliveryUpdate,
  sender: PreparationSender,
  now: Date = new Date(),
): Promise<PreparationStatus | null> {
  if (!delivered.updated || !delivered.reachedPhone) return null;
  const { appointmentId, messageType } = delivered.message;
  if (!appointmentId || !PREPARATION_TRIGGER_TYPES.includes(messageType)) return null;
  if (!(await hasFeature(db, clinicId, "exams"))) return null;

  const previous = unwrap(
    await db
      .from("whatsapp_messages")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("appointment_id", appointmentId)
      .eq("direction", "outbound")
      .eq("message_type", PREPARATION_MESSAGE_TYPE)
      .limit(1),
    "Mensagens do WhatsApp",
  );
  if (previous.length > 0) return null;

  const row = await loadExam(db, clinicId, appointmentId, now);
  return row ? deliverPreparation(db, clinicId, row, sender, now) : null;
}

/** Quais destes atendimentos mostram "Reenviar preparo": a última tentativa não chegou. */
export async function listPreparationResendable(db: DbClient, clinicId: string, appointmentIds: string[]): Promise<Set<string>> {
  if (appointmentIds.length === 0) return new Set();
  const rows = unwrap(
    await db
      .from("whatsapp_messages")
      .select("appointment_id, status")
      .eq("clinic_id", clinicId)
      .eq("direction", "outbound")
      .eq("message_type", PREPARATION_MESSAGE_TYPE)
      .in("appointment_id", appointmentIds)
      .order("created_at"),
    "Mensagens do WhatsApp",
  );
  const latest = new Map<string, string | null>();
  for (const row of rows) latest.set(row.appointment_id!, row.status);
  return new Set(appointmentIds.filter((id) => NOT_DELIVERED.has(latest.get(id) ?? "")));
}

// Aviso na tela depois do botão (`?preparo=`). Achado 4 da F1: só os códigos
// próprios.
export type PreparationResendOutcome = "sent" | "failed" | "no_template" | "not_connected" | "not_enabled" | "not_eligible";

export const PREPARATION_RESEND_MESSAGES: Record<PreparationResendOutcome, { text: string; ok: boolean }> = {
  sent: { text: "Preparo do exame reenviado.", ok: true },
  failed: { text: "O preparo não foi enviado: o WhatsApp recusou o envio. Veja a trilha do atendimento.", ok: false },
  no_template: { text: "O preparo não foi enviado: o template do preparo do exame não está aprovado.", ok: false },
  not_connected: { text: "O preparo não foi enviado: o WhatsApp da clínica não está conectado.", ok: false },
  not_enabled: { text: "Exames não estão liberados para a clínica.", ok: false },
  not_eligible: { text: "Nada a reenviar: o preparo já foi entregue, o atendimento foi cancelado ou já passou.", ok: false },
};

export function parsePreparationResendOutcome(value: string | null): PreparationResendOutcome | null {
  return value !== null && Object.hasOwn(PREPARATION_RESEND_MESSAGES, value) ? (value as PreparationResendOutcome) : null;
}

/** "Reenviar preparo do exame" da tela. Quem reenviou fica na trilha mesmo se falhar. */
export async function resendPreparation(
  db: DbClient,
  clinicId: string,
  appointmentId: string,
  actorId: string | null,
  sender: PreparationSender,
  now: Date = new Date(),
): Promise<PreparationResendOutcome> {
  if (!(await hasFeature(db, clinicId, "exams"))) return "not_enabled";
  const row = await loadExam(db, clinicId, appointmentId, now);
  // Tela desatualizada ou clique duplo: o preparo já foi entregue.
  if (!row || !(await listPreparationResendable(db, clinicId, [appointmentId])).has(appointmentId)) return "not_eligible";

  const status = await deliverPreparation(db, clinicId, row, sender, now);
  // Preparo tirado do serviço depois da falha: nada foi enviado.
  if (status === null) return "not_eligible";
  if (status === "not_connected") return "not_connected";
  await logTrail(db, clinicId, appointmentId, "preparation_resent", "admin", actorId);
  if (status === "skipped_no_template") return "no_template";
  return status === "sent" ? "sent" : "failed";
}
