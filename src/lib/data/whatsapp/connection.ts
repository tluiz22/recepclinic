import { randomInt } from "node:crypto";
import type { DbClient } from "../clients";
import { cleanText, DataError, unwrap, Validation } from "../errors";
import {
  exchangeSignupCode,
  fetchPhoneNumberInfo,
  GraphRequestError,
  registerPhoneNumber,
  requestCoexistenceSync,
  subscribeAppToWaba,
  type Fetcher,
  type PhoneNumberInfo,
} from "./graph";

// Conexão do WhatsApp e templates por clínica (D3a, D3b), F3.9a.
//
// O Suporte cadastra a conexão, o token da Meta e os templates à mão (de
// reserva); na F8.1, o Administrador da clínica conecta pela janela da Meta
// (Embedded Signup, connectWithSignup). A equipe vê a situação, sem o token. O bot (credencial da clínica) lê a conexão, o token
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
  /** App WhatsApp Business + API no mesmo número: a recepção responde pelo app (F6.4). */
  coexistence: boolean;
  /** Quem conectou: o Suporte à mão ou a clínica pela janela da Meta (F8.1). */
  connectedVia: "support" | "embedded_signup";
  /** Coexistência: sincronizações pedidas à Meta (null = falta; a Meta dá 24 horas). */
  contactsSyncedAt: Date | null;
  historySyncedAt: Date | null;
};

export type WhatsappConnectionInput = {
  phoneNumberId: string;
  wabaId: string;
  displayPhone?: string | null;
  status: ConnectionStatus;
  coexistence?: boolean;
};

const CONNECTION_STATUSES: ConnectionStatus[] = ["pending", "connected", "disconnected"];

/** Conexão da clínica (null = ainda não cadastrada). */
export async function getWhatsappConnection(db: DbClient, clinicId: string): Promise<WhatsappConnection | null> {
  const row = unwrap(
    await db
      .from("whatsapp_connections")
      .select("phone_number_id, waba_id, display_phone, status, connected_at, coexistence, connected_via, contacts_synced_at, history_synced_at")
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
    coexistence: row.coexistence,
    connectedVia: row.connected_via as WhatsappConnection["connectedVia"],
    contactsSyncedAt: row.contacts_synced_at ? new Date(row.contacts_synced_at) : null,
    historySyncedAt: row.history_synced_at ? new Date(row.history_synced_at) : null,
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
        coexistence: input.coexistence ?? false,
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
// Embedded Signup (F8.1)
// ---------------------------------------------------------------------------

/** Fim da janela da Meta: número novo só na API, coexistência ou só a conta (sem número). */
export type SignupEvent = "FINISH" | "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" | "FINISH_ONLY_WABA";

export type SignupInput = { code: string; wabaId: string; phoneNumberId: string; event: string };

export type SignupDeps = {
  appId: string;
  appSecret: string;
  fetcher?: Fetcher;
  /** PIN do número novo (6 números); sorteado quando não vem. */
  newPin?: () => string;
};

export type SignupResult = {
  coexistence: boolean;
  displayPhone: string | null;
  /** Coexistência: sincronizações que a Meta recusou (dá para tentar de novo em 24 horas). */
  syncProblems: string[];
};

const META_ID = /^\d{5,30}$/;
const SIGNUP_EVENTS: SignupEvent[] = ["FINISH", "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", "FINISH_ONLY_WABA"];

const randomPin = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

/**
 * Conecta o número escolhido na janela da Meta: troca o código pelo token
 * (vale 30 segundos), confere o número, inscreve o app na conta e, no número
 * novo, registra na Cloud API com o PIN sorteado; na coexistência, o número
 * já está registrado e a Meta exige as sincronizações dos contatos e do
 * histórico (o conteúdo que chega no webhook é descartado; cliente, 24/out).
 * Grava tudo de uma vez (connect_whatsapp: só o Administrador ou o Suporte).
 */
export async function connectWithSignup(db: DbClient, clinicId: string, input: SignupInput, deps: SignupDeps): Promise<SignupResult> {
  const fetcher = deps.fetcher ?? fetch;
  if (input.event === "FINISH_ONLY_WABA") {
    throw new DataError("invalid", "Conexão do WhatsApp: a conta foi conectada sem número", {
      signup: "A Meta conectou só a conta, sem número. Abra a janela de novo e escolha o número da clínica.",
    });
  }
  const code = cleanText(input.code) ?? "";
  const wabaId = cleanText(input.wabaId) ?? "";
  const phoneNumberId = cleanText(input.phoneNumberId) ?? "";
  if (!code || !META_ID.test(wabaId) || !META_ID.test(phoneNumberId) || !SIGNUP_EVENTS.includes(input.event as SignupEvent)) {
    throw new DataError("invalid", "Conexão do WhatsApp: resposta da Meta incompleta", {
      signup: "A janela da Meta não devolveu o número e a conta. Tente de novo.",
    });
  }

  const token = await exchangeSignupCode(deps.appId, deps.appSecret, code, fetcher);
  const info = await fetchPhoneNumberInfo(phoneNumberId, token, fetcher);
  const coexistence = input.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" || info.isOnBizApp;
  await subscribeAppToWaba(wabaId, token, fetcher);

  let pin: string | null = null;
  if (!coexistence) {
    pin = (deps.newPin ?? randomPin)();
    await registerPhoneNumber(phoneNumberId, pin, token, fetcher);
  }

  const syncProblems: string[] = [];
  const synced = { contacts: false, history: false };
  if (coexistence) {
    for (const [kind, syncType] of [["contacts", "smb_app_state_sync"], ["history", "history"]] as const) {
      try {
        await requestCoexistenceSync(phoneNumberId, syncType, token, fetcher);
        synced[kind] = true;
      } catch (error) {
        if (!(error instanceof GraphRequestError)) throw error;
        syncProblems.push(error.message);
      }
    }
  }

  unwrap(
    await db.rpc("connect_whatsapp", {
      p_clinic_id: clinicId,
      p_phone_number_id: phoneNumberId,
      p_waba_id: wabaId,
      p_display_phone: info.displayPhoneNumber ?? "",
      p_coexistence: coexistence,
      p_token: token,
      p_pin: pin ?? undefined,
      p_contacts_synced: synced.contacts,
      p_history_synced: synced.history,
    }),
    "Conexão do WhatsApp",
  );
  return { coexistence, displayPhone: info.displayPhoneNumber, syncProblems };
}

/** A Meta dá 24 horas, depois da conexão, para as sincronizações da coexistência. */
export const COEXISTENCE_SYNC_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Coexistência com sincronização faltando e ainda dentro das 24 horas. */
export function pendingCoexistenceSync(connection: WhatsappConnection | null, now: Date = new Date()): boolean {
  if (!connection?.coexistence || connection.status !== "connected" || connection.connectedVia !== "embedded_signup" || !connection.connectedAt) return false;
  if (connection.contactsSyncedAt && connection.historySyncedAt) return false;
  return now.getTime() - connection.connectedAt.getTime() < COEXISTENCE_SYNC_WINDOW_MS;
}

/**
 * Nova tentativa das sincronizações que faltam (dentro das 24 horas). O token
 * só é lido pela credencial da clínica (`serviceDb`); a marca é gravada com o
 * login de quem pediu (`db`). Devolve os problemas que restaram.
 */
export async function retryCoexistenceSync(db: DbClient, serviceDb: DbClient, clinicId: string, fetcher: Fetcher = fetch): Promise<string[]> {
  const connection = await getWhatsappConnection(db, clinicId);
  if (!pendingCoexistenceSync(connection)) return [];
  const token = await getWhatsappAccessToken(serviceDb);
  if (!token) return ["A conexão está sem o token da Meta."];
  const problems: string[] = [];
  const steps = [
    ["contacts", "smb_app_state_sync", connection!.contactsSyncedAt],
    ["history", "history", connection!.historySyncedAt],
  ] as const;
  for (const [kind, syncType, done] of steps) {
    if (done) continue;
    try {
      await requestCoexistenceSync(connection!.phoneNumberId, syncType, token, fetcher);
      unwrap(await db.rpc("mark_whatsapp_synced", { p_clinic_id: clinicId, p_kind: kind }), "Conexão do WhatsApp");
    } catch (error) {
      if (!(error instanceof GraphRequestError)) throw error;
      problems.push(error.message);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Templates (D3b)
// ---------------------------------------------------------------------------

export const TEMPLATE_KEYS = [
  "confirmation",
  "confirmation_return",
  "reschedule",
  "cancellation",
  "clinic_cancellation",
  "reminder",
  "exam_preparation",
  "consultation_guidance",
  "waitlist_offer",
  "daily_summary_consultations",
  "daily_summary_exams",
  "daily_summary_consultations_today",
  "daily_summary_exams_today",
  "nfse_document",
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
  /** 1 = a padrão do RecepClinic; maior = texto próprio da clínica (F6.6). */
  version: number;
  /** Texto próprio da versão ({{1}}, {{2}}…); null = o padrão. */
  body: string | null;
  /** proposed: aguardando o Suporte; declined: o Suporte recusou; meta: enviada (situação em `status`). */
  stage: "proposed" | "declined" | "meta";
  proposedAt: Date | null;
  supportNote: string | null;
};

export type WhatsappTemplateInput = {
  key: TemplateKey;
  name: string;
  language?: string;
  status: TemplateStatus;
  metaTemplateId?: string | null;
};

const TEMPLATE_STATUSES: TemplateStatus[] = ["pending", "approved", "rejected", "disabled"];
const TEMPLATE_COLUMNS = "id, template_key, name, language, status, meta_template_id, rejection_reason, version, body, stage, proposed_at, support_note";

type TemplateRow = {
  id: string;
  template_key: string;
  name: string;
  language: string;
  status: string;
  meta_template_id: string | null;
  rejection_reason: string | null;
  version: number;
  body: string | null;
  stage: string;
  proposed_at: string | null;
  support_note: string | null;
};

const toTemplate = (row: TemplateRow): WhatsappTemplate => ({
  id: row.id,
  key: row.template_key as TemplateKey,
  name: row.name,
  language: row.language,
  status: row.status as TemplateStatus,
  metaTemplateId: row.meta_template_id,
  rejectionReason: row.rejection_reason,
  version: row.version,
  body: row.body,
  stage: row.stage as WhatsappTemplate["stage"],
  proposedAt: row.proposed_at ? new Date(row.proposed_at) : null,
  supportNote: row.support_note,
});

export async function listWhatsappTemplates(db: DbClient, clinicId: string): Promise<WhatsappTemplate[]> {
  const rows = unwrap(
    await db.from("whatsapp_templates").select(TEMPLATE_COLUMNS).eq("clinic_id", clinicId).order("template_key").order("version"),
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
        version: 1,
      },
      { onConflict: "clinic_id,template_key,version" },
    ),
    "Template do WhatsApp",
  );
}

/** Template em uso: nome, idioma e o texto próprio (null = o padrão). */
export type ApprovedTemplate = { name: string; language: string; body: string | null };

/**
 * Template pronto para envio: a versão aprovada mais nova (a personalizada,
 * quando aprovada, troca sozinha; recusada, segue a anterior; F6.6). null =
 * não enviar por template.
 */
export async function getApprovedTemplate(db: DbClient, clinicId: string, key: TemplateKey): Promise<ApprovedTemplate | null> {
  const row = unwrap(
    await db
      .from("whatsapp_templates")
      .select("name, language, body")
      .eq("clinic_id", clinicId)
      .eq("template_key", key)
      .eq("stage", "meta")
      .eq("status", "approved")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "Template do WhatsApp",
  );
  return row ? { name: row.name, language: row.language, body: row.body } : null;
}
