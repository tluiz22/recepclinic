import { billingContractTerms, billingTermsVersion, billingTermsVersionFor } from "../billingContractText";
import { BILLING_OPT_IN_VERSION } from "../billingOptIn";
import { isCalendarDate } from "../clinicTime";
import { formatCnpj, normalizeCnpj } from "../cnpj";
import { formatCpf, normalizeCpf } from "../cpf";
import { parseMoneyCents } from "../forms";
import { INVALID_PHONE_MESSAGE, normalizePhone } from "../phone";
import type { DbClient } from "./clients";
import { contractChangeEmail, EmailNotConfiguredError, type EmailSender } from "../email";
import { formatCentsBRL } from "../money";
import { cleanText, DataError, fromDbError, unwrap, Validation } from "./errors";

// Faturamento do SaaS, F12.1 (planejamento-faturamento-saas.md; cliente,
// 28/out/2026): conta de cobrança da clínica e trilha. O Suporte cria e altera
// a conta inteira; o Administrador da clínica, só os contatos e o opt-in do
// WhatsApp (só ele dá ou retira). Tudo grava por funções do banco, que travam
// a conta e registram na trilha (billing_audit_log).
//
// F12.2: contrato com versões (rascunho → ativo; mudança = nova versão) e o
// preço padrão por nota fiscal, só do Suporte. Sem Asaas até a F12.4.
//
// F12.2b: aceite do contrato pelo Administrador (texto versionado em
// billingContractText.ts) e, na mudança com o mesmo texto, aviso de 30 dias
// por e-mail (o uso continuado vale como aceite).

export type BillingAccount = {
  payerName: string;
  /** CNPJ (14) ou CPF (11), sem máscara. */
  payerDocument: string;
  financeEmail: string;
  /** E.164, ou null. */
  financePhone: string | null;
  whatsappOptIn: { at: Date; version: string } | null;
  /** F12.4: cliente no Asaas (null = ainda não criado). */
  asaasCustomerId: string | null;
  /** F12.2e: "Agora não" no passo do WhatsApp financeiro. */
  whatsappPromptDismissedAt: Date | null;
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
  asaas_customer_id: string | null;
  whatsapp_prompt_dismissed_at: string | null;
  updated_at: string;
};

export async function getBillingAccount(db: DbClient, clinicId: string): Promise<BillingAccount | null> {
  const row = unwrap(
    await db
      .from("billing_accounts")
      .select("payer_name, payer_document, finance_email, finance_phone, whatsapp_opt_in_at, whatsapp_opt_in_version, asaas_customer_id, whatsapp_prompt_dismissed_at, updated_at")
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
    asaasCustomerId: row.asaas_customer_id,
    whatsappPromptDismissedAt: row.whatsapp_prompt_dismissed_at ? new Date(row.whatsapp_prompt_dismissed_at) : null,
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

/** F12.2e: "Agora não" no passo do WhatsApp financeiro (só o Administrador). */
export async function dismissBillingWhatsappPrompt(db: DbClient, clinicId: string): Promise<void> {
  const { error } = await db.rpc("dismiss_billing_whatsapp_prompt", { p_clinic_id: clinicId });
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
  contract_accepted: "Contrato aceito pelo Administrador",
  contract_notice_sent: "Novos termos enviados por e-mail",
  contract_notice_failed: "E-mail dos novos termos não saiu",
  asaas_customer_linked: "Cliente ligado no Asaas",
  asaas_subscription_created: "Assinatura criada no Asaas",
  charge_created: "Cobrança gerada",
  charge_updated: "Situação da cobrança mudou",
  asaas_sync_failed: "Falha ao falar com o Asaas",
  notice_sent: "Aviso de cobrança enviado",
  notice_failed: "Aviso de cobrança não saiu",
  clinic_suspended: "Clínica suspensa",
  suspension_released: "Motivo da suspensão liberado",
  contract_canceled: "Assinatura cancelada pelo Administrador",
  asaas_cancel_done: "Cancelamento aplicado no Asaas",
  asaas_cancel_failed: "Cancelamento não aplicado no Asaas",
} as const;

/** Suporte: clínicas que cancelaram a assinatura e não têm contrato ativo (selo na lista de clínicas; F12.2f). */
export async function listCanceledClinicIds(db: DbClient): Promise<Set<string>> {
  const rows = unwrap(await db.from("billing_contracts").select("clinic_id, status, canceled_at"), "Contrato") as { clinic_id: string; status: string; canceled_at: string | null }[];
  const active = new Set(rows.filter((r) => r.status === "active").map((r) => r.clinic_id));
  return new Set(rows.filter((r) => r.canceled_at && !active.has(r.clinic_id)).map((r) => r.clinic_id));
}

/** F12.2f (cliente, 03/nov/2026): motivos do cancelamento; "Outro" pede o comentário. */
export const CANCEL_REASONS = {
  price: "Preço",
  low_usage: "Não usamos o suficiente",
  missing_feature: "Faltou uma função",
  whatsapp_issues: "Problemas no WhatsApp ou no bot",
  other_system: "Vamos usar outro sistema",
  clinic_closed: "A clínica fechou ou pausou",
  other: "Outro",
} as const;
export type CancelReason = keyof typeof CANCEL_REASONS;

export type CancelResult = { kind: "cancel" | "withdrawal"; contractId: string; accessUntil: string; nextDue: string };

/**
 * Só o Administrador da clínica: cancela a assinatura (F12.2f). Até 7 dias do
 * aceite é arrependimento (devolução e fim do acesso na hora); depois, o acesso
 * vai até a véspera do próximo vencimento e essa mensalidade continua devida.
 */
export async function cancelBillingSubscription(db: DbClient, clinicId: string, input: { reason: string; comment: string | null }): Promise<CancelResult> {
  const v = new Validation();
  v.check(input.reason in CANCEL_REASONS, "motivo", "Escolha o motivo do cancelamento.");
  v.check(input.reason !== "other" || !!input.comment?.trim(), "comentario", "Conte o motivo do cancelamento.");
  v.check((input.comment ?? "").length <= 1000, "comentario", "Comentário longo demais (até 1.000 caracteres).");
  v.throwIfInvalid("Cancelamento");
  const { data, error } = await db.rpc("cancel_billing_subscription", { p_clinic_id: clinicId, p_reason: input.reason, p_comment: input.comment ?? "" });
  if (error) throw fromDbError(error, "Cancelamento");
  const row = data as { kind: "cancel" | "withdrawal"; contract_id: string; access_until: string; next_due: string };
  return { kind: row.kind, contractId: row.contract_id, accessUntil: row.access_until, nextDue: row.next_due };
}

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
  /** Versão do texto do contrato (null no rascunho). */
  termsVersion: string | null;
  /** null no rascunho e no descartado. */
  acceptance: ContractAcceptance | null;
  acceptedAt: Date | null;
  acceptedBy: string | null;
  acceptedIp: string | null;
  /** F12.2e: a frase da autorização da cobrança recorrente marcada no aceite. */
  recurringConsent: string | null;
  /** F12.2f: cancelamento pelo Administrador (null = não cancelado). */
  cancel: {
    at: Date;
    by: string | null;
    kind: "cancel" | "withdrawal";
    reason: CancelReason;
    comment: string | null;
    nextDue: string | null;
    asaasSyncedAt: Date | null;
    asaasError: string | null;
  } | null;
  noticeSentAt: Date | null;
  /** F12.4: assinatura no Asaas, última sincronização e o erro da última tentativa. */
  asaasSubscriptionId: string | null;
  asaasSyncedAt: Date | null;
  asaasSyncError: string | null;
};

export type ContractAcceptance = "pending" | "explicit" | "tacit";

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
  terms_version: string | null;
  acceptance: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
  accepted_ip: string | null;
  recurring_consent: string | null;
  canceled_at: string | null;
  canceled_by: string | null;
  cancel_kind: string | null;
  cancel_reason: string | null;
  cancel_comment: string | null;
  cancel_next_due: string | null;
  asaas_cancel_synced_at: string | null;
  asaas_cancel_error: string | null;
  notice_sent_at: string | null;
  asaas_subscription_id: string | null;
  asaas_synced_at: string | null;
  asaas_sync_error: string | null;
};

/** Contratos da clínica, o mais novo primeiro. O Administrador vê só o vigente e os encerrados. */
export async function listBillingContracts(db: DbClient, clinicId: string): Promise<BillingContract[]> {
  const rows = unwrap(
    await db
      .from("billing_contracts")
      .select(
        "id, version, status, billing_mode, monthly_cents, setup_cents, payment_method, first_due_date, invoice_unit_price_cents, invoice_monthly_allowance, plan_snapshot, notes, starts_on, ends_on, activated_at, terms_version, acceptance, accepted_at, accepted_by, accepted_ip, recurring_consent, canceled_at, canceled_by, cancel_kind, cancel_reason, cancel_comment, cancel_next_due, asaas_cancel_synced_at, asaas_cancel_error, notice_sent_at, asaas_subscription_id, asaas_synced_at, asaas_sync_error",
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
    termsVersion: row.terms_version,
    acceptance: row.acceptance as ContractAcceptance | null,
    acceptedAt: row.accepted_at ? new Date(row.accepted_at) : null,
    acceptedBy: row.accepted_by,
    acceptedIp: row.accepted_ip,
    recurringConsent: row.recurring_consent,
    cancel: row.canceled_at
      ? {
          at: new Date(row.canceled_at),
          by: row.canceled_by,
          kind: row.cancel_kind as "cancel" | "withdrawal",
          reason: row.cancel_reason as CancelReason,
          comment: row.cancel_comment,
          nextDue: row.cancel_next_due,
          asaasSyncedAt: row.asaas_cancel_synced_at ? new Date(row.asaas_cancel_synced_at) : null,
          asaasError: row.asaas_cancel_error,
        }
      : null,
    noticeSentAt: row.notice_sent_at ? new Date(row.notice_sent_at) : null,
    asaasSubscriptionId: row.asaas_subscription_id,
    asaasSyncedAt: row.asaas_synced_at ? new Date(row.asaas_synced_at) : null,
    asaasSyncError: row.asaas_sync_error,
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

/**
 * Ativa o rascunho com o texto atual do contrato; a versão vigente é encerrada
 * na véspera do início da nova. Devolve a versão ativada: com aceite tácito
 * (mudança com o mesmo texto), o servidor envia os novos termos por e-mail.
 */
export async function activateBillingContract(db: DbClient, clinicId: string): Promise<BillingContract> {
  // O texto com nota fiscal só para o contrato que cobra nota (cliente, 03/nov/2026).
  // Sem rascunho visível, o banco responde (sem permissão ou sem rascunho).
  const draft = (await listBillingContracts(db, clinicId)).find((c) => c.status === "draft");
  const terms = draft ? billingTermsVersionFor(draft) : billingTermsVersion(false);
  const { error } = await db.rpc("activate_billing_contract", { p_clinic_id: clinicId, p_terms_version: terms });
  if (error) throw fromDbError(error, "Contrato");
  const active = (await listBillingContracts(db, clinicId)).find((c) => c.status === "active");
  if (!active) throw new DataError("not_found", "Contrato: não encontrado");
  return active;
}

/**
 * Só o Administrador da clínica: aceita na tela o contrato com o texto mostrado
 * (F12.2b); `termsVersion` é a versão do texto que a tela mostrou (o banco
 * confere com a do contrato).
 */
export async function acceptBillingContract(
  db: DbClient,
  clinicId: string,
  contractId: string,
  termsVersion: string,
  ip: string | null,
  recurringConsent: string,
): Promise<void> {
  // Texto que não está mais aqui não se aceita: o Suporte ativa uma nova versão.
  if (!billingContractTerms(termsVersion)) {
    throw new DataError("invalid", "Aceite do contrato: este contrato usa um texto que não está mais disponível. Fale com o Suporte do RecepClinic.");
  }
  const { error } = await db.rpc("accept_billing_contract", {
    p_clinic_id: clinicId,
    p_contract_id: contractId,
    p_terms_version: termsVersion,
    p_ip: ip ?? "",
    p_recurring_consent: recurringConsent,
  });
  if (error) throw fromDbError(error, "Aceite do contrato");
}

export type ContractNoticeResult = { sent: true; to: string } | { sent: false; to: string | null; reason: string };

/**
 * Suporte: manda ao e-mail financeiro os novos termos da versão com aceite
 * tácito e registra o envio (ou a falha) na trilha.
 */
export async function sendBillingContractNotice(
  db: DbClient,
  clinic: { id: string; name: string },
  contract: BillingContract,
  { sendEmail, link }: { sendEmail: EmailSender; link: string },
): Promise<ContractNoticeResult> {
  const account = await getBillingAccount(db, clinic.id);
  const to = account?.financeEmail ?? null;
  let reason: string | null = null;
  if (!to) reason = "sem conta de cobrança";
  else {
    try {
      await sendEmail(contractChangeEmail(to, { clinicName: clinic.name, contract: { version: contract.version, startsOn: contract.startsOn, terms: contractTermLines(contract) }, link }));
    } catch (err) {
      reason = err instanceof EmailNotConfiguredError ? "envio de e-mail não configurado" : err instanceof Error ? err.message : "erro desconhecido";
    }
  }
  const { error } = await db.rpc("record_billing_contract_notice", { p_clinic_id: clinic.id, p_contract_id: contract.id, p_sent_to: to ?? "", p_error: reason ?? "" });
  if (error) throw fromDbError(error, "Aviso do contrato");
  return reason === null ? { sent: true, to: to! } : { sent: false, to, reason };
}

/** Linhas dos termos para o e-mail ("Mensalidade: R$ 349,00"). */
export function contractTermLines(contract: BillingContract): string[] {
  const date = (value: string) => value.split("-").reverse().join("/");
  return [
    `Mensalidade: ${formatCentsBRL(contract.monthlyCents)}`,
    `Implantação: ${contract.setupCents === 0 ? "isenta" : formatCentsBRL(contract.setupCents)}`,
    ...(contract.paymentMethod ? [`Forma de pagamento: ${PAYMENT_METHODS[contract.paymentMethod]}`] : []),
    ...(contract.invoiceUnitPriceCents !== null
      ? [`Preço por nota fiscal: ${formatCentsBRL(contract.invoiceUnitPriceCents)}`, `Franquia de notas: ${describeAllowance(contract.invoiceMonthlyAllowance)}`]
      : []),
    `Início: ${date(contract.startsOn)}`,
    `1º vencimento: ${date(contract.firstDueDate)}`,
  ];
}

export const CONTRACT_ACCEPTANCE = {
  pending: { label: "Aguardando aceite", variant: "warning" },
  explicit: { label: "Aceito", variant: "success" },
  tacit: { label: "Aceito pelo uso", variant: "success" },
} as const;

/** Data mínima de início de uma mudança com aceite tácito: hoje (Brasília) + 30 dias. */
export function noticeStartDate(today: string): string {
  const day = new Date(`${today}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 30);
  return day.toISOString().slice(0, 10);
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

// ---------------------------------------------------------------------------
// Cobranças (F12.4): espelho do Asaas, só leitura (o servidor grava)
// ---------------------------------------------------------------------------

export const CHARGE_STATUS = {
  pending: { label: "Em aberto", variant: "info" },
  paid: { label: "Paga", variant: "success" },
  overdue: { label: "Vencida", variant: "danger" },
  refunded: { label: "Estornada", variant: "warning" },
  canceled: { label: "Cancelada", variant: "neutral" },
  other: { label: "Em análise", variant: "neutral" },
} as const;

export const CHARGE_KINDS = { monthly: "Mensalidade", setup: "Implantação", other: "Outra" } as const;

export type BillingCharge = {
  id: string;
  kind: keyof typeof CHARGE_KINDS;
  dueDate: string;
  valueCents: number;
  billingType: string | null;
  status: keyof typeof CHARGE_STATUS;
  rawStatus: string | null;
  paidAt: Date | null;
  invoiceUrl: string | null;
  asaasPaymentId: string | null;
};

/** Cobranças da clínica, a de vencimento mais novo primeiro (Suporte e Administrador). */
export async function listBillingCharges(db: DbClient, clinicId: string, limit = 24): Promise<BillingCharge[]> {
  const rows = unwrap(
    await db
      .from("billing_charges")
      .select("id, kind, due_date, value_cents, billing_type, status, raw_status, paid_at, invoice_url, asaas_payment_id")
      .eq("clinic_id", clinicId)
      .order("due_date", { ascending: false })
      .limit(limit),
    "Cobranças",
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as BillingCharge["kind"],
    dueDate: row.due_date,
    valueCents: row.value_cents,
    billingType: row.billing_type,
    status: row.status as BillingCharge["status"],
    rawStatus: row.raw_status,
    paidAt: row.paid_at ? new Date(row.paid_at) : null,
    invoiceUrl: row.invoice_url,
    asaasPaymentId: row.asaas_payment_id,
  }));
}

/** Suporte: a clínica já pode ser suspensa por inadimplência (15º dia de atraso de uma cobrança do Asaas)? */
export async function canSuspendForNonPayment(db: DbClient, clinicId: string): Promise<boolean> {
  const { data, error } = await db.rpc("billing_can_suspend_for_non_payment", { p_clinic_id: clinicId });
  if (error) throw fromDbError(error, "Suspensão");
  return data === true;
}
