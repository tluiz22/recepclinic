import { BILLING_OPT_IN_VERSION } from "../billingOptIn";
import { isCalendarDate } from "../clinicTime";
import { formatCnpj, normalizeCnpj } from "../cnpj";
import { formatCpf, normalizeCpf } from "../cpf";
import { parseMoneyCents } from "../forms";
import { INVALID_PHONE_MESSAGE, normalizePhone } from "../phone";
import type { DbClient } from "./clients";
import { cleanText, DataError, fromDbError, unwrap, Validation } from "./errors";

// Faturamento do SaaS, F12.1 (planejamento-faturamento-saas.md; cliente,
// 28/out/2026): conta de cobrança da clínica e trilha. O Suporte cria e altera
// a conta inteira; o Administrador da clínica, só os contatos e o opt-in do
// WhatsApp (só ele dá ou retira). Tudo grava por funções do banco, que travam
// a conta e registram na trilha (billing_audit_log).
//
// F12.2: contrato com versões (rascunho → ativo; mudança = nova versão) e o
// preço padrão por nota fiscal, só do Suporte. Sem Asaas até a F12.4.

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
  contract_draft_saved: "Rascunho do contrato salvo",
  contract_draft_discarded: "Rascunho do contrato descartado",
  contract_activated: "Contrato ativado",
  contract_ended: "Fim da versão do contrato marcado",
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
  billing_mode: "modo de cobrança",
  monthly_cents: "mensalidade",
  setup_cents: "implantação",
  payment_method: "forma de pagamento",
  first_due_date: "1º vencimento",
  invoice_unit_price_cents: "preço por nota",
  invoice_monthly_allowance: "franquia",
  starts_on: "início",
  notes: "observações",
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

// ---------------------------------------------------------------------------
// Contrato (F12.2)
// ---------------------------------------------------------------------------

export const BILLING_MODES = {
  asaas: "Automático (Asaas)",
  manual: "Manual (o Suporte cobra por fora)",
} as const;

export const PAYMENT_METHODS = {
  pix: "Pix",
  credit_card: "Cartão de crédito",
} as const;

export const CONTRACT_STATUS = {
  draft: { label: "Rascunho", variant: "warning" },
  active: { label: "Vigente", variant: "success" },
  ended: { label: "Encerrado", variant: "neutral" },
  canceled: { label: "Descartado", variant: "neutral" },
} as const;

export type BillingMode = keyof typeof BILLING_MODES;
export type PaymentMethod = keyof typeof PAYMENT_METHODS;
export type ContractStatus = keyof typeof CONTRACT_STATUS;

/** Retrato do plano de referência quando o contrato foi feito (informativo). */
export type PlanSnapshot = { kind?: string; label?: string; tableMonthlyCents?: number; professionals?: number };

export type BillingContract = {
  id: string;
  version: number | null;
  status: ContractStatus;
  billingMode: BillingMode;
  monthlyCents: number;
  setupCents: number;
  paymentMethod: PaymentMethod | null;
  firstDueDate: string;
  /** null = o contrato não cobra nota fiscal (clínica sem a emissão de nota). */
  invoiceUnitPriceCents: number | null;
  /** null = ilimitada (ou sem nota fiscal). */
  invoiceMonthlyAllowance: number | null;
  planSnapshot: PlanSnapshot;
  notes: string | null;
  startsOn: string;
  endsOn: string | null;
  activatedAt: Date | null;
};

type ContractRow = {
  id: string;
  version: number | null;
  status: string;
  billing_mode: string;
  monthly_cents: number;
  setup_cents: number;
  payment_method: string | null;
  first_due_date: string;
  invoice_unit_price_cents: number | null;
  invoice_monthly_allowance: number | null;
  plan_snapshot: unknown;
  notes: string | null;
  starts_on: string;
  ends_on: string | null;
  activated_at: string | null;
};

/** Contratos da clínica, o mais novo primeiro. O Administrador vê só o vigente e os encerrados. */
export async function listBillingContracts(db: DbClient, clinicId: string): Promise<BillingContract[]> {
  const rows = unwrap(
    await db
      .from("billing_contracts")
      .select(
        "id, version, status, billing_mode, monthly_cents, setup_cents, payment_method, first_due_date, invoice_unit_price_cents, invoice_monthly_allowance, plan_snapshot, notes, starts_on, ends_on, activated_at",
      )
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false }),
    "Contrato",
  ) as ContractRow[];
  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    status: row.status as ContractStatus,
    billingMode: row.billing_mode as BillingMode,
    monthlyCents: row.monthly_cents,
    setupCents: row.setup_cents,
    paymentMethod: row.payment_method as PaymentMethod | null,
    firstDueDate: row.first_due_date,
    invoiceUnitPriceCents: row.invoice_unit_price_cents,
    invoiceMonthlyAllowance: row.invoice_monthly_allowance,
    planSnapshot: (row.plan_snapshot as PlanSnapshot | null) ?? {},
    notes: row.notes,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    activatedAt: row.activated_at ? new Date(row.activated_at) : null,
  }));
}

export const CONTRACT_MESSAGES = {
  mode: "Escolha o modo de cobrança.",
  monthly: "Mensalidade: informe o valor em reais (ex.: 299 ou 299,90).",
  setup: "Implantação: informe o valor em reais, ou 0 se for isenta.",
  paymentMethod: "Escolha a forma de pagamento.",
  firstDueDate: "Informe o 1º vencimento, no início do contrato ou depois.",
  startsOn: "Informe a data de início.",
  invoicePrice: "Preço por nota: informe o valor em reais (ex.: 0,80), ou 0.",
  allowance: "Franquia: informe a quantidade de notas por mês (0 ou mais), ou marque ilimitada.",
  notes: "Observações: até 1.000 caracteres.",
} as const;

export type ContractDraftInput = {
  billingMode: string;
  monthly: string;
  setup: string;
  paymentMethod?: string | null;
  firstDueDate: string;
  startsOn: string;
  /** Só com a emissão de nota fiscal liberada para a clínica (item "finance"). */
  invoicePrice?: string | null;
  /** "ilimitada" ou "limitada". */
  allowanceKind?: string | null;
  allowance?: string | null;
  notes?: string | null;
};

const MAX_CENTS = 10_000_000;

/**
 * Suporte: cria ou altera o rascunho do contrato (nova versão, se já há um
 * vigente). Preço por nota e franquia só entram com `invoicing` (a clínica tem
 * a emissão de nota fiscal; cliente, 30/out/2026); o banco confere de novo.
 */
export async function saveBillingContractDraft(
  db: DbClient,
  clinicId: string,
  input: ContractDraftInput,
  planSnapshot: PlanSnapshot,
  { invoicing }: { invoicing: boolean },
): Promise<void> {
  const v = new Validation();
  const mode = input.billingMode in BILLING_MODES ? (input.billingMode as BillingMode) : null;
  v.check(mode !== null, "billing_mode", CONTRACT_MESSAGES.mode);
  const monthly = parseMoneyCents(input.monthly);
  v.check(Number.isFinite(monthly) && monthly > 0 && monthly <= MAX_CENTS, "monthly", CONTRACT_MESSAGES.monthly);
  const setup = parseMoneyCents(input.setup);
  v.check(Number.isFinite(setup) && setup >= 0 && setup <= MAX_CENTS, "setup", CONTRACT_MESSAGES.setup);
  const method = mode === "asaas" && input.paymentMethod && input.paymentMethod in PAYMENT_METHODS ? (input.paymentMethod as PaymentMethod) : null;
  v.check(mode !== "asaas" || method !== null, "payment_method", CONTRACT_MESSAGES.paymentMethod);
  v.check(isCalendarDate(input.startsOn), "starts_on", CONTRACT_MESSAGES.startsOn);
  v.check(isCalendarDate(input.firstDueDate) && (!isCalendarDate(input.startsOn) || input.firstDueDate >= input.startsOn), "first_due_date", CONTRACT_MESSAGES.firstDueDate);
  const price = invoicing ? parseMoneyCents(input.invoicePrice ?? "") : null;
  v.check(price === null || (Number.isFinite(price) && price >= 0 && price <= 100_000), "invoice_price", CONTRACT_MESSAGES.invoicePrice);
  const unlimited = input.allowanceKind === "ilimitada";
  const allowanceText = (input.allowance ?? "").trim();
  const allowance = !invoicing || unlimited ? null : /^\d{1,6}$/.test(allowanceText) ? Number(allowanceText) : Number.NaN;
  v.check(
    !invoicing || ((unlimited || input.allowanceKind === "limitada") && (allowance === null || (allowance >= 0 && allowance <= 100_000))),
    "allowance",
    CONTRACT_MESSAGES.allowance,
  );
  const notes = cleanText(input.notes);
  v.check(notes === null || notes.length <= 1000, "notes", CONTRACT_MESSAGES.notes);
  v.throwIfInvalid("Contrato");

  const { error } = await db.rpc("save_billing_contract_draft", {
    p_clinic_id: clinicId,
    p_billing_mode: mode!,
    p_monthly_cents: monthly,
    p_setup_cents: setup,
    p_payment_method: method ?? "",
    p_first_due_date: input.firstDueDate,
    p_invoice_unit_price_cents: price as number,
    p_invoice_monthly_allowance: allowance as number,
    p_starts_on: input.startsOn,
    p_plan_snapshot: planSnapshot,
    p_notes: notes ?? "",
  });
  if (error) throw fromDbError(error, "Contrato");
}

export async function discardBillingContractDraft(db: DbClient, clinicId: string): Promise<void> {
  const { error } = await db.rpc("discard_billing_contract_draft", { p_clinic_id: clinicId });
  if (error) throw fromDbError(error, "Contrato");
}

/** Ativa o rascunho; a versão vigente é encerrada na véspera do início da nova. */
export async function activateBillingContract(db: DbClient, clinicId: string): Promise<void> {
  const { error } = await db.rpc("activate_billing_contract", { p_clinic_id: clinicId });
  if (error) throw fromDbError(error, "Contrato");
}

/** Preço padrão por nota (Suporte); null = ainda não definido. */
export async function getDefaultInvoicePrice(db: DbClient): Promise<number | null> {
  const row = unwrap(await db.from("billing_settings").select("default_invoice_unit_price_cents").maybeSingle(), "Preço padrão por nota") as {
    default_invoice_unit_price_cents: number | null;
  } | null;
  return row?.default_invoice_unit_price_cents ?? null;
}

export async function setDefaultInvoicePrice(db: DbClient, priceText: string): Promise<void> {
  const cents = parseMoneyCents(priceText);
  if (!Number.isFinite(cents) || cents < 0 || cents > 100_000) {
    throw new DataError("invalid", `Preço padrão por nota: ${CONTRACT_MESSAGES.invoicePrice}`, { default_invoice_price: CONTRACT_MESSAGES.invoicePrice });
  }
  const { error } = await db.rpc("set_billing_default_invoice_price", { p_cents: cents });
  if (error) throw fromDbError(error, "Preço padrão por nota");
}

/**
 * Contrato que vale hoje e o próximo (versão já ativada com início futuro).
 * Ao ativar a nova versão, a anterior fica "encerrada" com fim na véspera do
 * início da nova, mas segue valendo até lá.
 */
export function contractsInForce(contracts: BillingContract[], today: string): { current: BillingContract | null; next: BillingContract | null } {
  const signed = contracts.filter((c) => c.status === "active" || c.status === "ended");
  const current = signed.find((c) => c.startsOn <= today && (c.endsOn === null || c.endsOn >= today)) ?? null;
  const next = signed.find((c) => c.status === "active" && c.startsOn > today) ?? null;
  return { current, next };
}

/** "50 notas por mês" ou "ilimitada". */
export function describeAllowance(allowance: number | null): string {
  if (allowance === null) return "ilimitada";
  return `${allowance} ${allowance === 1 ? "nota" : "notas"} por mês`;
}
