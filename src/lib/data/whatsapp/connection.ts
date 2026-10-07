import type { DbClient } from "../clients";
import { cleanText, DataError, unwrap, Validation } from "../errors";
import { fetchPhoneNumberInfo, GraphRequestError, registerPhoneNumber, subscribeAppToWaba, type Fetcher, type PhoneNumberInfo } from "./graph";

// Conexão do WhatsApp e templates por clínica (D3a, D3b), F3.9a.
//
// Nesta fase o Suporte cadastra a conexão, o token da Meta e os templates
// (pelo Embedded Signup, o Administrador da clínica, na F8). A equipe vê a
// situação, sem o token. O bot (credencial da clínica) lê a conexão, o token
// (guardado no Vault) e os templates aprovados da própria clínica. Descobrir a
// clínica pelo número que recebeu a mensagem é da plataforma
// (resolveClinicByPhoneNumberId, platform.ts).

export type ConnectionStatus = "pending" | "connected" | "disconnected";

export type WhatsappConnection = {
  phoneNumberId: string;
  wabaId: string;
  displayPhone: string | null;
  status: ConnectionStatus;
  connectedAt: Date | null;
};

export type WhatsappConnectionInput = {
  phoneNumberId: string;
  wabaId: string;
  displayPhone?: string | null;
  status: ConnectionStatus;
};

const CONNECTION_STATUSES: ConnectionStatus[] = ["pending", "connected", "disconnected"];

/** Conexão da clínica (null = ainda não cadastrada). */
export async function getWhatsappConnection(db: DbClient, clinicId: string): Promise<WhatsappConnection | null> {
  const row = unwrap(
    await db
      .from("whatsapp_connections")
      .select("phone_number_id, waba_id, display_phone, status, connected_at")
      .eq("clinic_id", clinicId)
      .maybeSingle(),
    "Conexão do WhatsApp",
  );
  if (!row) return null;
  return {
    phoneNumberId: row.phone_number_id,
    wabaId: row.waba_id,
    displayPhone: row.display_phone,
    status: row.status as ConnectionStatus,
    connectedAt: row.connected_at ? new Date(row.connected_at) : null,
  };
}

/**
 * Suporte: cadastra ou corrige a conexão. Passar a "conectada" grava quando;
 * o número da Meta é único entre as clínicas.
 */
export async function saveWhatsappConnection(
  db: DbClient,
  clinicId: string,
  input: WhatsappConnectionInput,
  now: Date = new Date(),
): Promise<void> {
  const v = new Validation();
  const phoneNumberId = cleanText(input.phoneNumberId) ?? "";
  const wabaId = cleanText(input.wabaId) ?? "";
  v.check(phoneNumberId.length > 0, "phoneNumberId", "Informe o identificador do número na Meta");
  v.check(wabaId.length > 0, "wabaId", "Informe a conta do WhatsApp Business");
  v.check(CONNECTION_STATUSES.includes(input.status), "status", "Situação inválida");
  v.throwIfInvalid("Conexão do WhatsApp");

  const current = await getWhatsappConnection(db, clinicId);
  const connectedAt =
    input.status === "connected" ? (current?.status === "connected" ? current.connectedAt : now) : (current?.connectedAt ?? null);

  unwrap(
    await db.from("whatsapp_connections").upsert(
      {
        clinic_id: clinicId,
        phone_number_id: phoneNumberId,
        waba_id: wabaId,
        display_phone: cleanText(input.displayPhone),
        status: input.status,
        connected_at: connectedAt?.toISOString() ?? null,
      },
      { onConflict: "clinic_id" },
    ),
    "Conexão do WhatsApp",
  );
}

/** Suporte: grava ou troca o token da Meta (vai para o Vault, ninguém da equipe lê). */
export async function setWhatsappAccessToken(db: DbClient, clinicId: string, token: string): Promise<void> {
  const clean = cleanText(token);
  if (!clean) throw new DataError("invalid", "Token do WhatsApp: informe o token", { token: "Informe o token" });
  unwrap(await db.rpc("set_whatsapp_access_token", { p_clinic_id: clinicId, p_token: clean }), "Token do WhatsApp");
}

/** Bot (credencial da clínica): token da própria clínica, para enviar (null = sem token). */
export async function getWhatsappAccessToken(db: DbClient): Promise<string | null> {
  return unwrap(await db.rpc("get_whatsapp_access_token"), "Token do WhatsApp") ?? null;
}

/** O bot pode enviar? Conexão conectada e com token. */
export type SendingSetup = { phoneNumberId: string; accessToken: string };

export async function getSendingSetup(db: DbClient, clinicId: string): Promise<SendingSetup | null> {
  const connection = await getWhatsappConnection(db, clinicId);
  if (connection?.status !== "connected") return null;
  const accessToken = await getWhatsappAccessToken(db);
  return accessToken ? { phoneNumberId: connection.phoneNumberId, accessToken } : null;
}

export type ConnectionCheck =
  | { ok: true; info: PhoneNumberInfo; subscribed: boolean; subscribeError: string | null }
  | { ok: false; problem: "no_connection" | "no_token" | "meta_error"; message: string };

/**
 * Suporte, "Testar conexão" (F6.1): com a credencial da clínica (só ela lê o
 * token), pergunta à Meta pelo número e inscreve o app na conta (WABA), para
 * os eventos chegarem ao webhook. Não muda a situação da conexão.
 */
export async function checkWhatsappConnection(db: DbClient, clinicId: string, fetcher: Fetcher = fetch): Promise<ConnectionCheck> {
  const connection = await getWhatsappConnection(db, clinicId);
  if (!connection) return { ok: false, problem: "no_connection", message: "Cadastre a conexão antes de testar." };
  const token = await getWhatsappAccessToken(db);
  if (!token) return { ok: false, problem: "no_token", message: "Grave o token da Meta antes de testar." };
  let info: PhoneNumberInfo;
  try {
    info = await fetchPhoneNumberInfo(connection.phoneNumberId, token, fetcher);
  } catch (error) {
    if (error instanceof GraphRequestError) return { ok: false, problem: "meta_error", message: error.message };
    throw error;
  }
  try {
    await subscribeAppToWaba(connection.wabaId, token, fetcher);
    return { ok: true, info, subscribed: true, subscribeError: null };
  } catch (error) {
    if (error instanceof GraphRequestError) return { ok: true, info, subscribed: false, subscribeError: error.message };
    throw error;
  }
}

/**
 * Suporte, "Registrar o número" (F6.1): registra o número da conexão na Cloud
 * API com o PIN de 6 dígitos. null = registrado; senão, o motivo.
 */
export async function registerWhatsappNumber(db: DbClient, clinicId: string, pin: string, fetcher: Fetcher = fetch): Promise<string | null> {
  if (!/^\d{6}$/.test(pin)) return "O PIN tem 6 números.";
  const connection = await getWhatsappConnection(db, clinicId);
  if (!connection) return "Cadastre a conexão antes de registrar o número.";
  const token = await getWhatsappAccessToken(db);
  if (!token) return "Grave o token da Meta antes de registrar o número.";
  try {
    await registerPhoneNumber(connection.phoneNumberId, pin, token, fetcher);
    return null;
  } catch (error) {
    if (error instanceof GraphRequestError) return error.message;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Templates (D3b)
// ---------------------------------------------------------------------------

export const TEMPLATE_KEYS = [
  "confirmation",
  "confirmation_return",
  "reschedule",
  "cancellation",
  "reminder",
  "exam_preparation",
  "waitlist_offer",
  "daily_summary_consultations",
  "daily_summary_exams",
  "daily_summary_consultations_today",
  "daily_summary_exams_today",
] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number];
export type TemplateStatus = "pending" | "approved" | "rejected" | "disabled";

export type WhatsappTemplate = {
  id: string;
  key: TemplateKey;
  name: string;
  language: string;
  status: TemplateStatus;
  metaTemplateId: string | null;
  /** Motivo da recusa pela Meta (F6.2). */
  rejectionReason: string | null;
};

export type WhatsappTemplateInput = {
  key: TemplateKey;
  name: string;
  language?: string;
  status: TemplateStatus;
  metaTemplateId?: string | null;
};

const TEMPLATE_STATUSES: TemplateStatus[] = ["pending", "approved", "rejected", "disabled"];
const TEMPLATE_COLUMNS = "id, template_key, name, language, status, meta_template_id, rejection_reason";

type TemplateRow = {
  id: string;
  template_key: string;
  name: string;
  language: string;
  status: string;
  meta_template_id: string | null;
  rejection_reason: string | null;
};

const toTemplate = (row: TemplateRow): WhatsappTemplate => ({
  id: row.id,
  key: row.template_key as TemplateKey,
  name: row.name,
  language: row.language,
  status: row.status as TemplateStatus,
  metaTemplateId: row.meta_template_id,
  rejectionReason: row.rejection_reason,
});

export async function listWhatsappTemplates(db: DbClient, clinicId: string): Promise<WhatsappTemplate[]> {
  const rows = unwrap(
    await db.from("whatsapp_templates").select(TEMPLATE_COLUMNS).eq("clinic_id", clinicId).order("template_key"),
    "Templates do WhatsApp",
  );
  return rows.map(toTemplate);
}

/** Suporte: cadastra ou corrige o template de uma chave (um por chave na clínica). */
export async function saveWhatsappTemplate(db: DbClient, clinicId: string, input: WhatsappTemplateInput): Promise<void> {
  const v = new Validation();
  const name = cleanText(input.name) ?? "";
  const language = cleanText(input.language) ?? "pt_BR";
  v.check(TEMPLATE_KEYS.includes(input.key), "key", "Template desconhecido");
  v.check(name.length > 0, "name", "Informe o nome do template na Meta");
  v.check(TEMPLATE_STATUSES.includes(input.status), "status", "Situação inválida");
  v.throwIfInvalid("Template do WhatsApp");

  unwrap(
    await db.from("whatsapp_templates").upsert(
      {
        clinic_id: clinicId,
        template_key: input.key,
        name,
        language,
        status: input.status,
        meta_template_id: cleanText(input.metaTemplateId),
      },
      { onConflict: "clinic_id,template_key" },
    ),
    "Template do WhatsApp",
  );
}

/** Template pronto para envio (aprovado na Meta); null = não enviar por template. */
export async function getApprovedTemplate(
  db: DbClient,
  clinicId: string,
  key: TemplateKey,
): Promise<{ name: string; language: string } | null> {
  const row = unwrap(
    await db
      .from("whatsapp_templates")
      .select("name, language")
      .eq("clinic_id", clinicId)
      .eq("template_key", key)
      .eq("status", "approved")
      .maybeSingle(),
    "Template do WhatsApp",
  );
  return row ? { name: row.name, language: row.language } : null;
}
