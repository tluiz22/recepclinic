import { BILLING_OPT_IN_VERSION } from "../billingOptIn";
import { formatCnpj, normalizeCnpj } from "../cnpj";
import { formatCpf, normalizeCpf } from "../cpf";
import { INVALID_PHONE_MESSAGE, normalizePhone } from "../phone";
import type { DbClient } from "./clients";
import { cleanText, fromDbError, unwrap, Validation } from "./errors";

// Faturamento do SaaS, F12.1 (planejamento-faturamento-saas.md; cliente,
// 28/out/2026): conta de cobrança da clínica e trilha. O Suporte cria e altera
// a conta inteira; o Administrador da clínica, só os contatos e o opt-in do
// WhatsApp (só ele dá ou retira). Tudo grava por funções do banco, que travam
// a conta e registram na trilha (billing_audit_log).

export type BillingAccount = {
  payerName: string;
  /** CNPJ (14) ou CPF (11), sem máscara. */
  payerDocument: string;
  financeEmail: string;
  /** E.164, ou null. */
  financePhone: string | null;
  whatsappOptIn: { at: Date; version: string } | null;
  updatedAt: Date;
};

export const BILLING_MESSAGES = {
  payerName: "Informe o nome ou a razão social do pagador.",
  payerDocument: "CNPJ ou CPF do pagador inválido.",
  email: "Informe um e-mail financeiro válido.",
  phone: INVALID_PHONE_MESSAGE,
} as const;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type AccountRow = {
  payer_name: string;
  payer_document: string;
  finance_email: string;
  finance_phone: string | null;
  whatsapp_opt_in_at: string | null;
  whatsapp_opt_in_version: string | null;
  updated_at: string;
};

export async function getBillingAccount(db: DbClient, clinicId: string): Promise<BillingAccount | null> {
  const row = unwrap(
    await db
      .from("billing_accounts")
      .select("payer_name, payer_document, finance_email, finance_phone, whatsapp_opt_in_at, whatsapp_opt_in_version, updated_at")
      .eq("clinic_id", clinicId)
      .maybeSingle(),
    "Conta de cobrança",
  ) as AccountRow | null;
  if (!row) return null;
  return {
    payerName: row.payer_name,
    payerDocument: row.payer_document,
    financeEmail: row.finance_email,
    financePhone: row.finance_phone,
    whatsappOptIn: row.whatsapp_opt_in_at ? { at: new Date(row.whatsapp_opt_in_at), version: row.whatsapp_opt_in_version ?? "" } : null,
    updatedAt: new Date(row.updated_at),
  };
}

type ContactsInput = { financeEmail: string; financePhone?: string | null };

function checkContacts(v: Validation, input: ContactsInput) {
  const email = (input.financeEmail ?? "").trim().toLowerCase();
  v.check(EMAIL.test(email) && email.length <= 200, "finance_email", BILLING_MESSAGES.email);
  const phoneText = cleanText(input.financePhone);
  const phone = phoneText ? normalizePhone(phoneText) : null;
  v.check(!phoneText || phone !== null, "finance_phone", BILLING_MESSAGES.phone);
  return { email, phone };
}

export type BillingAccountInput = ContactsInput & { payerName: string; payerDocument: string };

/** Suporte: cria ou altera a conta de cobrança. Trocar o telefone retira o opt-in. */
export async function saveBillingAccount(db: DbClient, clinicId: string, input: BillingAccountInput): Promise<void> {
  const v = new Validation();
  const payerName = cleanText(input.payerName);
  v.check(payerName !== null && payerName.length <= 200, "payer_name", BILLING_MESSAGES.payerName);
  const document = normalizeCnpj(input.payerDocument) ?? normalizeCpf(input.payerDocument);
  v.check(document !== null, "payer_document", BILLING_MESSAGES.payerDocument);
  const { email, phone } = checkContacts(v, input);
  v.throwIfInvalid("Conta de cobrança");

  const { error } = await db.rpc("save_billing_account", {
    p_clinic_id: clinicId,
    p_payer_name: payerName!,
    p_payer_document: document!,
    p_finance_email: email,
    p_finance_phone: phone ?? "",
  });
  if (error) throw fromDbError(error, "Conta de cobrança");
}

/** Administrador da clínica (ou Suporte): só os contatos financeiros. */
export async function saveBillingContacts(db: DbClient, clinicId: string, input: ContactsInput): Promise<void> {
  const v = new Validation();
  const { email, phone } = checkContacts(v, input);
  v.throwIfInvalid("Contatos financeiros");

  const { error } = await db.rpc("save_billing_contacts", { p_clinic_id: clinicId, p_finance_email: email, p_finance_phone: phone ?? "" });
  if (error) throw fromDbError(error, "Contatos financeiros");
}

/** Só o Administrador da clínica: autoriza (com o texto da versão atual) ou retira o WhatsApp financeiro. */
export async function setBillingWhatsappOptIn(db: DbClient, clinicId: string, optIn: boolean): Promise<void> {
  const { error } = await db.rpc("set_billing_whatsapp_opt_in", { p_clinic_id: clinicId, p_opt_in: optIn, p_text_version: BILLING_OPT_IN_VERSION });
  if (error) throw fromDbError(error, "WhatsApp financeiro");
}

export const BILLING_ACTIONS = {
  account_created: "Conta de cobrança criada",
  account_updated: "Conta de cobrança alterada",
  contacts_updated: "Contatos financeiros alterados",
  whatsapp_opt_in: "WhatsApp financeiro autorizado",
  whatsapp_opt_out: "WhatsApp financeiro retirado",
} as const;

export type BillingAuditEntry = {
  action: keyof typeof BILLING_ACTIONS;
  /** clinic = alguém da clínica; support = Suporte RecepClinic. */
  actorKind: "clinic" | "support" | "system" | "webhook";
  actorId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  createdAt: Date;
};

/** Trilha do faturamento, a mais nova primeiro. */
export async function listBillingAudit(db: DbClient, clinicId: string, limit = 50): Promise<BillingAuditEntry[]> {
  const rows = unwrap(
    await db
      .from("billing_audit_log")
      .select("action, actor_kind, actor_id, before, after, reason, created_at")
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false })
      .limit(limit),
    "Trilha do faturamento",
  ) as { action: string; actor_kind: string; actor_id: string | null; before: unknown; after: unknown; reason: string | null; created_at: string }[];
  return rows.map((row) => ({
    action: row.action as BillingAuditEntry["action"],
    actorKind: row.actor_kind as BillingAuditEntry["actorKind"],
    actorId: row.actor_id,
    before: (row.before as Record<string, unknown> | null) ?? null,
    after: (row.after as Record<string, unknown> | null) ?? null,
    reason: row.reason,
    createdAt: new Date(row.created_at),
  }));
}

const FIELD_LABELS: Record<string, string> = {
  payer_name: "pagador",
  payer_document: "CNPJ/CPF",
  finance_email: "e-mail",
  finance_phone: "telefone",
  whatsapp_opt_in_at: "WhatsApp",
};

/** Campos que mudaram numa entrada da trilha ("e-mail, telefone"). */
export function changedFields(entry: Pick<BillingAuditEntry, "before" | "after">): string[] {
  if (!entry.before || !entry.after) return [];
  return Object.keys(FIELD_LABELS).filter((key) => JSON.stringify(entry.before![key] ?? null) !== JSON.stringify(entry.after![key] ?? null)).map((key) => FIELD_LABELS[key]);
}

/** CNPJ ou CPF formatado para a tela. */
export function formatPayerDocument(document: string): string {
  return document.length === 14 ? formatCnpj(document) : formatCpf(document);
}
