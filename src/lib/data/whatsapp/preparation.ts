import type { DbClient } from "../clients";
import { unwrap, unwrapAllIn } from "../errors";
import { hasFeature } from "../features";
import { logTrail } from "../agenda/appointments";
import { preparationPath } from "../../publicId";
import { getApprovedTemplate, getWhatsappConnection } from "./connection";
import { SERVICE_FILES_BUCKET } from "../config/preparationFile";
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
//
// Arquivo do preparo (C7; cliente, 28/out/2026): o exame com arquivo manda,
// depois que o preparo chega ao celular, uma segunda mensagem só com ele
// (janela aberta: documento; fechada: o modelo rc_preparo_arquivo_v1, com o
// arquivo no topo). Também uma vez só; o "Reenviar preparo" cobre o que não
// chegou (o preparo, e o arquivo vem depois; ou só o arquivo).

export const PREPARATION_MESSAGE_TYPE = "exam_preparation";
export const PREPARATION_FILE_MESSAGE_TYPE = "exam_preparation_file";
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
  template: { name: string; language: string; body?: string | null } | null;
};

export type PreparationSender = (preparation: PreparationToSend) => Promise<SendOutcome>;

export type PreparationFileToSend = {
  phone: string;
  examName: string;
  file: { bytes: Uint8Array; filename: string; mimeType: string };
  /** Documento direto (janela aberta) ou o modelo com o arquivo no topo (fechada). */
  mode: "document" | "template";
  template: { name: string; language: string; body?: string | null } | null;
};

export type PreparationFileSender = (file: PreparationFileToSend) => Promise<SendOutcome>;

/** Texto do arquivo (legenda do documento e corpo do modelo). */
export const preparationFileCaption = (examName: string) => `Orientações de preparo do exame ${examName} em anexo.`;

/** Situação registrada ("sent", "failed", "skipped_no_template") ou "not_connected" (nada registrado). */
export type PreparationStatus = "sent" | "failed" | "skipped_no_template" | "not_connected";

type ExamRow = {
  id: string;
  status: string;
  scheduled_at: string;
  service_id: string;
  services: {
    name: string;
    category: string;
    preparation_instructions: string | null;
    preparation_file_path: string | null;
    preparation_file_name: string | null;
    preparation_file_type: string | null;
  };
  patients: { full_name: string; contacts: { id: string; full_name: string; phone: string } };
};

const EXAM_COLUMNS =
  "id, status, scheduled_at, service_id, services ( name, category, preparation_instructions, preparation_file_path, preparation_file_name, preparation_file_type ), patients ( full_name, contacts ( id, full_name, phone ) )";

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
  let outcome: SendOutcome | null = null;
  let messageId: string | null = null;
  let body: string | null = null;
  if (!windowOpen && !template) {
    // Registrado como tentativa: o botão "Reenviar preparo" aparece.
    status = "skipped_no_template";
  } else {
    try {
      outcome = await sender({
        clinicId,
        appointmentId: row.id,
        phone: contact.phone,
        contactName: contact.full_name,
        patientName: row.patients.full_name,
        examName: row.services.name,
        instructions,
        pagePath: preparationPath(row.service_id),
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
      retry: { outcome, context: { scheduledAt: new Date(row.scheduled_at).toISOString() } },
    },
    now,
  );
  return status;
}

/** Envia o arquivo do preparo e registra; null = o exame não tem arquivo. */
async function deliverPreparationFile(
  db: DbClient,
  clinicId: string,
  row: ExamRow,
  sender: PreparationFileSender,
  now: Date,
): Promise<PreparationStatus | null> {
  const { preparation_file_path: path, preparation_file_name: filename, preparation_file_type: mimeType } = row.services;
  if (!path || !filename || !mimeType) return null;
  const connection = await getWhatsappConnection(db, clinicId);
  if (connection?.status !== "connected") return "not_connected";

  const contact = row.patients.contacts;
  const windowOpen = await isCustomerServiceWindowOpen(db, clinicId, contact.phone, now);
  const template = windowOpen ? null : await getApprovedTemplate(db, clinicId, "exam_preparation_file");
  const caption = preparationFileCaption(row.services.name);

  let status: PreparationStatus;
  let outcome: SendOutcome | null = null;
  if (!windowOpen && !template) {
    status = "skipped_no_template";
  } else {
    try {
      const { data, error } = await db.storage.from(SERVICE_FILES_BUCKET).download(path);
      if (error || !data) throw new Error("arquivo do preparo não encontrado no armazenamento");
      outcome = await sender({
        phone: contact.phone,
        examName: row.services.name,
        file: { bytes: new Uint8Array(await data.arrayBuffer()), filename, mimeType },
        mode: windowOpen ? "document" : "template",
        template,
      });
    } catch (error) {
      outcome = { sent: false, reason: error instanceof Error ? error.message : String(error) };
    }
    status = outcome.sent ? "sent" : "failed";
  }

  await recordOutboundMessage(
    db,
    clinicId,
    {
      phone: contact.phone,
      contactId: contact.id,
      appointmentId: row.id,
      messageType: PREPARATION_FILE_MESSAGE_TYPE,
      templateName: template?.name ?? null,
      body: outcome?.body ?? `[${filename}] ${caption}`,
      status,
      waMessageId: outcome?.sent ? outcome.messageId : null,
      retry: { outcome, context: { scheduledAt: new Date(row.scheduled_at).toISOString() } },
    },
    now,
  );
  return status;
}

/**
 * Preparo entregue (C7): se o exame tem arquivo e ele ainda não foi enviado,
 * o arquivo sai agora, depois do texto.
 */
export async function sendPreparationFileAfterDelivery(
  db: DbClient,
  clinicId: string,
  delivered: DeliveryUpdate,
  sender: PreparationFileSender,
  now: Date = new Date(),
): Promise<PreparationStatus | null> {
  if (!delivered.updated || !delivered.reachedPhone) return null;
  const { appointmentId, messageType } = delivered.message;
  if (!appointmentId || messageType !== PREPARATION_MESSAGE_TYPE) return null;
  if (!(await hasFeature(db, clinicId, "exams"))) return null;
  const previous = unwrap(
    await db
      .from("whatsapp_messages")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("appointment_id", appointmentId)
      .eq("direction", "outbound")
      .eq("message_type", PREPARATION_FILE_MESSAGE_TYPE)
      .limit(1),
    "Mensagens do WhatsApp",
  );
  if (previous.length > 0) return null;
  const row = await loadExam(db, clinicId, appointmentId, now);
  return row ? deliverPreparationFile(db, clinicId, row, sender, now) : null;
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

/**
 * O que falta reenviar de cada atendimento: o preparo (a última tentativa não
 * chegou; o arquivo vem depois dele) ou só o arquivo (C7).
 */
async function resendNeeds(db: DbClient, clinicId: string, appointmentIds: string[]): Promise<Map<string, "preparation" | "file">> {
  const needs = new Map<string, "preparation" | "file">();
  if (appointmentIds.length === 0) return needs;
  const rows = await unwrapAllIn(
    appointmentIds,
    (chunk, from, to) =>
      db
        .from("whatsapp_messages")
        .select("appointment_id, message_type, status")
        .eq("clinic_id", clinicId)
        .eq("direction", "outbound")
        .in("message_type", [PREPARATION_MESSAGE_TYPE, PREPARATION_FILE_MESSAGE_TYPE])
        .in("appointment_id", chunk)
        .order("created_at")
        .order("id")
        .range(from, to),
    "Mensagens do WhatsApp",
  );
  const latest = new Map<string, string | null>();
  for (const row of rows) latest.set(`${row.message_type}:${row.appointment_id}`, row.status);
  for (const id of appointmentIds) {
    if (NOT_DELIVERED.has(latest.get(`${PREPARATION_MESSAGE_TYPE}:${id}`) ?? "")) needs.set(id, "preparation");
    else if (NOT_DELIVERED.has(latest.get(`${PREPARATION_FILE_MESSAGE_TYPE}:${id}`) ?? "")) needs.set(id, "file");
  }
  return needs;
}

/** Quais destes atendimentos mostram "Reenviar preparo": o preparo ou o arquivo (C7) não chegou. */
export async function listPreparationResendable(db: DbClient, clinicId: string, appointmentIds: string[]): Promise<Set<string>> {
  return new Set((await resendNeeds(db, clinicId, appointmentIds)).keys());
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
  senders: { preparation: PreparationSender; file: PreparationFileSender },
  now: Date = new Date(),
): Promise<PreparationResendOutcome> {
  if (!(await hasFeature(db, clinicId, "exams"))) return "not_enabled";
  const row = await loadExam(db, clinicId, appointmentId, now);
  // Tela desatualizada ou clique duplo: o preparo (e o arquivo) já foram entregues.
  const need = row ? (await resendNeeds(db, clinicId, [appointmentId])).get(appointmentId) : undefined;
  if (!row || !need) return "not_eligible";

  // O preparo, e o arquivo sai depois da entrega (webhook); ou só o arquivo que não chegou (C7).
  const status =
    need === "preparation" ? await deliverPreparation(db, clinicId, row, senders.preparation, now) : await deliverPreparationFile(db, clinicId, row, senders.file, now);
  // Preparo tirado do serviço depois da falha: nada foi enviado.
  if (status === null) return "not_eligible";
  if (status === "not_connected") return "not_connected";
  await logTrail(db, clinicId, appointmentId, "preparation_resent", "admin", actorId);
  if (status === "skipped_no_template") return "no_template";
  return status === "sent" ? "sent" : "failed";
}
