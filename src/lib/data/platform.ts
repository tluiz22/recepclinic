import { createClient } from "@supabase/supabase-js";
import type { AsaasCustomerAddress } from "../asaas/billingApi";
import { isUuid } from "../clinicAccess";
import { platformEnv, type PlatformEnv } from "../env";
import type { Database } from "../supabase/database.types";
import type { DbClient } from "./clients";
import type { ErrorRecord } from "../log";

// Único ponto do código novo com a service role (D1, F3.3), que ignora o RLS.
// O cliente não sai deste arquivo: só funções estreitas da plataforma.
//
// Nas portas públicas ela só descobre de qual clínica é a requisição; o resto
// segue com createClinicServiceClient(clinicId). Rotinas administrativas da
// plataforma: achar o login de um e-mail e gerar o link de convite (F4.4a; a
// clínica em si é criada com o login do Suporte, que fica no registro).

type ServiceEnv = Pick<PlatformEnv, "supabaseUrl" | "supabaseServiceRoleKey">;

function platformClient(env: ServiceEnv): DbClient {
  return createClient<Database>(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export class PlatformLookupError extends Error {
  constructor(what: string, cause: unknown) {
    super(`Falha ao descobrir a clínica (${what})`, { cause });
    this.name = "PlatformLookupError";
  }
}

function clinicIdOrNull(what: string, result: { data: string | null; error: unknown }): string | null {
  if (result.error) throw new PlatformLookupError(what, result.error);
  return result.data ?? null;
}

/** Webhook do WhatsApp: clínica do número que recebeu a mensagem (desconectado = nenhuma). */
export async function resolveClinicByPhoneNumberId(
  phoneNumberId: string,
  env: ServiceEnv = platformEnv(),
): Promise<string | null> {
  if (!phoneNumberId.trim()) return null;
  return clinicIdOrNull(
    "número do WhatsApp",
    await platformClient(env).rpc("resolve_whatsapp_clinic", { p_phone_number_id: phoneNumberId }),
  );
}

/** Webhook do WhatsApp: clínicas conectadas da conta (WABA), para a situação dos templates (F6.2). */
export async function resolveClinicsByWabaId(wabaId: string, env: ServiceEnv = platformEnv()): Promise<string[]> {
  if (!wabaId.trim()) return [];
  const result = await platformClient(env).rpc("resolve_whatsapp_clinics_by_waba", { p_waba_id: wabaId });
  if (result.error) throw new PlatformLookupError("conta do WhatsApp", result.error);
  return (result.data ?? []) as string[];
}

/** Rotina da conversa parada (F6.3): clínicas com conversa parada desde antes de `before`. */
export async function listClinicsWithIdleConversations(before: Date, env: ServiceEnv = platformEnv()): Promise<string[]> {
  const result = await platformClient(env).rpc("list_clinics_with_idle_conversations", { p_before: before.toISOString() });
  if (result.error) throw new PlatformLookupError("conversas paradas", result.error);
  return (result.data ?? []) as string[];
}

/** Rotinas do agendador (F7): clínicas ativas; cada uma roda depois com a própria credencial. */
export async function listActiveClinics(env: ServiceEnv = platformEnv()): Promise<string[]> {
  const result = await platformClient(env).rpc("list_active_clinics");
  if (result.error) throw new PlatformLookupError("clínicas ativas", result.error);
  return (result.data ?? []) as string[];
}

/** Rotinas da agenda (séries): também as clínicas em implantação (F8.2b), que não recebem envios. */
export async function listClinicsInService(env: ServiceEnv = platformEnv()): Promise<string[]> {
  const result = await platformClient(env).rpc("list_clinics_in_service");
  if (result.error) throw new PlatformLookupError("clínicas em atividade", result.error);
  return (result.data ?? []) as string[];
}

/** /agendar/[token]: clínica do link de agendamento (vencido ou usado também resolve). */
export async function resolveClinicByBookingLink(
  linkId: string,
  env: ServiceEnv = platformEnv(),
): Promise<string | null> {
  if (!isUuid(linkId)) return null;
  return clinicIdOrNull(
    "link de agendamento",
    await platformClient(env).rpc("resolve_booking_link_clinic", { p_link_id: linkId }),
  );
}

/** Link do portal mandado pelo bot (F3a, /s/{token}): a clínica do link. */
export async function resolveClinicByPortalLink(linkId: string, env: ServiceEnv = platformEnv()): Promise<string | null> {
  if (!isUuid(linkId)) return null;
  return clinicIdOrNull("link do portal", await platformClient(env).rpc("resolve_portal_link_clinic", { p_link_id: linkId }));
}

/** Portal de agendamento (F2a): clínica do apelido do endereço (agendar.recepclinic.com.br/{apelido}). */
export async function resolveClinicByPortalSlug(slug: string, env: ServiceEnv = platformEnv()): Promise<string | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 60) return null;
  return clinicIdOrNull("portal de agendamento", await platformClient(env).rpc("resolve_portal_clinic", { p_slug: slug }));
}

/** /preparo/[id]: clínica do serviço (exame) cujo preparo é mostrado. */
export async function resolveClinicByService(
  serviceId: string,
  env: ServiceEnv = platformEnv(),
): Promise<string | null> {
  if (!isUuid(serviceId)) return null;
  return clinicIdOrNull(
    "serviço",
    await platformClient(env).rpc("resolve_service_clinic", { p_service_id: serviceId }),
  );
}

/** /formulario/[código]: clínica do pedido de informações (F4.4a), pelo hash do código. */
export async function resolveClinicByOnboardingToken(
  tokenHash: string,
  env: ServiceEnv = platformEnv(),
): Promise<string | null> {
  if (!/^[0-9a-f]{64}$/.test(tokenHash)) return null;
  return clinicIdOrNull(
    "pedido de informações",
    await platformClient(env).rpc("resolve_onboarding_request_clinic", { p_token_hash: tokenHash }),
  );
}

/** /importar/[código]: clínica do pedido da agenda atual (F10.1a), pelo hash do código. */
export async function resolveClinicByAgendaImportToken(
  tokenHash: string,
  env: ServiceEnv = platformEnv(),
): Promise<string | null> {
  if (!/^[0-9a-f]{64}$/.test(tokenHash)) return null;
  return clinicIdOrNull(
    "pedido da agenda atual",
    await platformClient(env).rpc("resolve_agenda_import_clinic", { p_token_hash: tokenHash }),
  );
}

// ---------------------------------------------------------------------------
// Logins (F4.4a): convite de quem ainda não tem acesso
// ---------------------------------------------------------------------------

export class PlatformAuthError extends Error {
  constructor(what: string, cause: unknown) {
    super(`Falha no login da plataforma (${what})`, { cause });
    this.name = "PlatformAuthError";
  }
}

/** Login já existente com este e-mail (null = ainda não tem). */
export async function findUserIdByEmail(email: string, env: ServiceEnv = platformEnv()): Promise<string | null> {
  const { data, error } = await platformClient(env).rpc("find_user_id_by_email", { p_email: email });
  if (error) throw new PlatformAuthError("busca por e-mail", error);
  return data ?? null;
}

/**
 * Link para criar a senha (o e-mail é nosso, não do Supabase): convite para
 * quem ainda não tem login (cria o login) ou, para quem foi convidado e não
 * criou a senha, um novo link pelo mesmo caminho da recuperação.
 */
export async function createPasswordLink(
  email: string,
  kind: "invite" | "resend",
  env: ServiceEnv = platformEnv(),
): Promise<{ userId: string; tokenHash: string; type: "invite" | "recovery" }> {
  const type = kind === "invite" ? "invite" : "recovery";
  const { data, error } = await platformClient(env).auth.admin.generateLink({ type, email });
  if (error || !data.user) throw new PlatformAuthError(kind === "invite" ? "convite" : "novo link do convite", error);
  return { userId: data.user.id, tokenHash: data.properties.hashed_token, type };
}

/**
 * Senhas dos logins das clínicas de demonstração (Vendas › Demonstração,
 * cliente, 02/nov/2026). O scripts/demo-clinicas.mjs cria a senha e guarda no
 * app_metadata do login (só a service role escreve ali); fora do código, porque
 * o repositório é público. Só e-mails demo.*@recepclinic.com.br.
 */
export async function loadDemoPasswords(emails: readonly string[], env: ServiceEnv = platformEnv()): Promise<Map<string, string>> {
  const client = platformClient(env);
  const passwords = new Map<string, string>();
  for (const email of emails.filter((e) => /^demo\.[a-z]+@recepclinic\.com\.br$/.test(e))) {
    const id = await findUserIdByEmail(email, env);
    if (!id) continue;
    const { data, error } = await client.auth.admin.getUserById(id);
    if (error) throw new PlatformAuthError("senha da demonstração", error);
    const password = data.user?.app_metadata?.demo_password;
    if (typeof password === "string") passwords.set(email, password);
  }
  return passwords;
}

// ---------------------------------------------------------------------------
// Erros e saúde do sistema (F9.3): gravados e lidos só pela plataforma
// ---------------------------------------------------------------------------

/** Destino do logError (src/lib/log.ts): o registro já vem sem dados pessoais. */
export async function recordSystemError(record: ErrorRecord, env: ServiceEnv = platformEnv()): Promise<void> {
  const { error } = await platformClient(env)
    .from("system_errors")
    .insert({ scope: record.scope, clinic_id: record.clinicId, ids: record.ids, message: record.message });
  if (error) throw new PlatformLookupError("gravar o erro", error);
}

/** Fim de uma execução da rotina do agendador (cronRoute e conversas paradas). */
export async function recordCronHeartbeat(
  job: string,
  { clinics, errors }: { clinics: number; errors: number },
  now: Date = new Date(),
  env: ServiceEnv = platformEnv(),
): Promise<void> {
  const { error } = await platformClient(env)
    .from("cron_heartbeats")
    .upsert({ job, last_finished_at: now.toISOString(), clinics, errors });
  if (error) throw new PlatformLookupError("registrar a execução da rotina", error);
}

/** Para a /api/saude: o banco responde e a última execução de cada rotina. */
export async function loadCronHeartbeats(env: ServiceEnv = platformEnv()): Promise<{ job: string; lastFinishedAt: Date }[]> {
  const { data, error } = await platformClient(env).from("cron_heartbeats").select("job, last_finished_at");
  if (error) throw new PlatformLookupError("execuções das rotinas", error);
  return data.map((row) => ({ job: row.job, lastFinishedAt: new Date(row.last_finished_at) }));
}

/** Para a /api/saude/erros: quantos erros desde `since`. */
export async function countSystemErrorsSince(since: Date, env: ServiceEnv = platformEnv()): Promise<number> {
  const { count, error } = await platformClient(env)
    .from("system_errors")
    .select("id", { count: "exact", head: true })
    .gte("occurred_at", since.toISOString());
  if (error) throw new PlatformLookupError("erros recentes", error);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Faturamento do SaaS no Asaas (F12.4): o servidor lê o necessário de um
// contrato e grava o retorno do Asaas pelas funções do banco liberadas só à
// service role (20261120120000_cobranca_asaas.sql).
// ---------------------------------------------------------------------------

export type BillingSyncSnapshot = {
  clinicId: string;
  clinicName: string;
  contract: {
    id: string;
    version: number | null;
    status: string;
    billingMode: string;
    acceptance: string | null;
    paymentMethod: string | null;
    monthlyCents: number;
    setupCents: number;
    firstDueDate: string;
    subscriptionId: string | null;
    /** Assinatura da versão que esta substitui (mudança de versão). */
    replacedSubscriptionId: string | null;
  };
  account: {
    payerName: string;
    payerDocument: string;
    financeEmail: string;
    financePhone: string | null;
    customerId: string | null;
    /** Endereço do pagador (cliente, 07/nov/2026); null = não preenchido. */
    address: AsaasCustomerAddress | null;
  } | null;
};

export type BillingChargeInput = {
  contractId: string;
  paymentId: string;
  kind: "monthly" | "setup" | "other";
  dueDate: string;
  valueCents: number;
  billingType: string;
  rawStatus: string;
  paidAt: string | null;
  invoiceUrl: string | null;
};

export type BillingStore = {
  load(contractId: string): Promise<BillingSyncSnapshot | null>;
  linkCustomer(clinicId: string, customerId: string): Promise<void>;
  linkSubscription(contractId: string, subscriptionId: string): Promise<void>;
  upsertCharge(charge: BillingChargeInput): Promise<void>;
  recordSync(contractId: string, error: string | null): Promise<void>;
};

export function platformBillingStore(env: ServiceEnv = platformEnv()): BillingStore {
  const db = platformClient(env);
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { error } = await (db.rpc as unknown as (n: string, a: Record<string, unknown>) => Promise<{ error: unknown }>)(name, args);
    if (error) throw new PlatformLookupError(name, error);
  };
  return {
    async load(contractId) {
      if (!isUuid(contractId)) return null;
      const { data: contract, error } = await db
        .from("billing_contracts")
        .select("id, clinic_id, version, status, billing_mode, acceptance, payment_method, monthly_cents, setup_cents, first_due_date, asaas_subscription_id, replaces_contract_id")
        .eq("id", contractId)
        .maybeSingle();
      if (error) throw new PlatformLookupError("contrato", error);
      if (!contract) return null;
      const [{ data: clinic }, { data: account }, replaced] = await Promise.all([
        db.from("clinics").select("name").eq("id", contract.clinic_id).maybeSingle(),
        db
          .from("billing_accounts")
          .select("payer_name, payer_document, finance_email, finance_phone, asaas_customer_id, postal_code, street, address_number, address_complement, district")
          .eq("clinic_id", contract.clinic_id)
          .maybeSingle(),
        contract.replaces_contract_id
          ? db.from("billing_contracts").select("asaas_subscription_id").eq("id", contract.replaces_contract_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      return {
        clinicId: contract.clinic_id,
        clinicName: clinic?.name ?? "",
        contract: {
          id: contract.id,
          version: contract.version,
          status: contract.status,
          billingMode: contract.billing_mode,
          acceptance: contract.acceptance,
          paymentMethod: contract.payment_method,
          monthlyCents: contract.monthly_cents,
          setupCents: contract.setup_cents,
          firstDueDate: contract.first_due_date,
          subscriptionId: contract.asaas_subscription_id,
          replacedSubscriptionId: replaced.data?.asaas_subscription_id ?? null,
        },
        account: account
          ? {
              payerName: account.payer_name,
              payerDocument: account.payer_document,
              financeEmail: account.finance_email,
              financePhone: account.finance_phone,
              customerId: account.asaas_customer_id,
              address:
                account.postal_code && account.street && account.address_number && account.district
                  ? { postalCode: account.postal_code, street: account.street, number: account.address_number, complement: account.address_complement, district: account.district }
                  : null,
            }
          : null,
      };
    },
    linkCustomer: (clinicId, customerId) => rpc("billing_link_asaas_customer", { p_clinic_id: clinicId, p_customer_id: customerId }),
    linkSubscription: (contractId, subscriptionId) => rpc("billing_link_asaas_subscription", { p_contract_id: contractId, p_subscription_id: subscriptionId }),
    upsertCharge: (c) =>
      rpc("billing_upsert_asaas_charge", {
        p_contract_id: c.contractId,
        p_payment_id: c.paymentId,
        p_kind: c.kind,
        p_due_date: c.dueDate,
        p_value_cents: c.valueCents,
        p_billing_type: c.billingType,
        p_raw_status: c.rawStatus,
        p_paid_at: c.paidAt,
        p_invoice_url: c.invoiceUrl,
      }),
    recordSync: (contractId, error) => rpc("billing_record_asaas_sync", { p_contract_id: contractId, p_error: error ?? "" }),
  };
}

// Cancelamento da assinatura (F12.2f): o servidor ajusta o Asaas depois do
// cancelamento gravado pelo Administrador e a rotina diária suspende quem
// passou do último dia de acesso.
export type BillingCancelSnapshot = {
  contractId: string;
  kind: "cancel" | "withdrawal";
  billingMode: string;
  subscriptionId: string | null;
  nextDue: string | null;
  charges: { paymentId: string; kind: "monthly" | "setup" | "other"; status: string; dueDate: string }[];
};

export type BillingCancelStore = Pick<BillingStore, "upsertCharge"> & {
  loadCancel(contractId: string): Promise<BillingCancelSnapshot | null>;
  recordCancelSync(contractId: string, error: string | null): Promise<void>;
  cancelsToSync(): Promise<string[]>;
  suspendEnded(): Promise<number>;
};

export function platformBillingCancelStore(env: ServiceEnv = platformEnv()): BillingCancelStore {
  const db = platformClient(env);
  const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await (db.rpc as unknown as (n: string, a: Record<string, unknown>) => Promise<{ data: T; error: unknown }>)(name, args);
    if (error) throw new PlatformLookupError(name, error);
    return data;
  };
  return {
    upsertCharge: platformBillingStore(env).upsertCharge,
    async loadCancel(contractId) {
      if (!isUuid(contractId)) return null;
      const { data: contract, error } = await db
        .from("billing_contracts")
        .select("id, cancel_kind, billing_mode, asaas_subscription_id, cancel_next_due")
        .eq("id", contractId)
        .maybeSingle();
      if (error) throw new PlatformLookupError("contrato", error);
      if (!contract || !contract.cancel_kind) return null;
      const { data: charges, error: chargesError } = await db
        .from("billing_charges")
        .select("asaas_payment_id, kind, status, due_date")
        .eq("contract_id", contractId)
        .not("asaas_payment_id", "is", null);
      if (chargesError) throw new PlatformLookupError("cobranças", chargesError);
      return {
        contractId: contract.id,
        kind: contract.cancel_kind as "cancel" | "withdrawal",
        billingMode: contract.billing_mode,
        subscriptionId: contract.asaas_subscription_id,
        nextDue: contract.cancel_next_due,
        charges: (charges ?? []).map((c) => ({ paymentId: c.asaas_payment_id!, kind: c.kind as "monthly" | "setup" | "other", status: c.status, dueDate: c.due_date })),
      };
    },
    recordCancelSync: (contractId, error) => call<null>("billing_record_cancel_sync", { p_contract_id: contractId, p_error: error ?? "" }).then(() => undefined),
    cancelsToSync: async () => (await call<string[] | null>("billing_cancels_to_sync", {})) ?? [],
    suspendEnded: async () => (await call<number | null>("billing_suspend_ended_contracts", {})) ?? 0,
  };
}

// Troca de cartão pelo Administrador (F12.2g): o pedido (Checkout do Asaas) e
// a troca da assinatura no contrato.
export type CardChangeRequest = { checkoutId: string; requestedAt: Date; nextDue: string };

export type BillingCardChangeStore = Pick<BillingStore, "load" | "upsertCharge"> & {
  loadCardChange(contractId: string): Promise<CardChangeRequest | null>;
  recordCardChangeRequest(contractId: string, checkoutId: string, nextDue: string, actorId: string | null): Promise<void>;
  finishCardChange(contractId: string, newSubscriptionId: string | null, error: string | null): Promise<void>;
  openCharges(contractId: string): Promise<{ paymentId: string; kind: "monthly" | "setup" | "other"; status: string; dueDate: string }[]>;
  openCardChanges(): Promise<string[]>;
};

export function platformBillingCardChangeStore(env: ServiceEnv = platformEnv()): BillingCardChangeStore {
  const db = platformClient(env);
  const billing = platformBillingStore(env);
  const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await (db.rpc as unknown as (n: string, a: Record<string, unknown>) => Promise<{ data: T; error: unknown }>)(name, args);
    if (error) throw new PlatformLookupError(name, error);
    return data;
  };
  return {
    load: billing.load,
    upsertCharge: billing.upsertCharge,
    async loadCardChange(contractId) {
      if (!isUuid(contractId)) return null;
      const { data, error } = await db
        .from("billing_contracts")
        .select("card_change_checkout_id, card_change_requested_at, card_change_next_due")
        .eq("id", contractId)
        .maybeSingle();
      if (error) throw new PlatformLookupError("contrato", error);
      if (!data?.card_change_checkout_id || !data.card_change_requested_at || !data.card_change_next_due) return null;
      return { checkoutId: data.card_change_checkout_id, requestedAt: new Date(data.card_change_requested_at), nextDue: data.card_change_next_due };
    },
    recordCardChangeRequest: (contractId, checkoutId, nextDue, actorId) =>
      call<null>("billing_record_card_change_request", { p_contract_id: contractId, p_checkout_id: checkoutId, p_next_due: nextDue, p_actor: actorId }).then(() => undefined),
    finishCardChange: (contractId, newSubscriptionId, error) =>
      call<null>("billing_finish_card_change", { p_contract_id: contractId, p_new_subscription_id: newSubscriptionId, p_error: error ?? "" }).then(() => undefined),
    async openCharges(contractId) {
      const { data, error } = await db
        .from("billing_charges")
        .select("asaas_payment_id, kind, status, due_date")
        .eq("contract_id", contractId)
        .in("status", ["pending", "overdue"])
        .not("asaas_payment_id", "is", null);
      if (error) throw new PlatformLookupError("cobranças", error);
      return (data ?? []).map((c) => ({ paymentId: c.asaas_payment_id!, kind: c.kind as "monthly" | "setup" | "other", status: c.status, dueDate: c.due_date }));
    },
    openCardChanges: async () => (await call<string[] | null>("billing_card_changes_open", {})) ?? [],
  };
}

// Troca cartão → Pix (cliente, 07/nov/2026): o contrato muda depois do Asaas.
export type BillingPaymentMethodStore = Pick<BillingCardChangeStore, "load" | "upsertCharge" | "openCharges" | "loadCardChange" | "finishCardChange"> & {
  setPaymentMethod(contractId: string, method: "pix" | "credit_card", actorId: string | null, actorKind: "clinic" | "support"): Promise<boolean>;
};

export function platformBillingPaymentMethodStore(env: ServiceEnv = platformEnv()): BillingPaymentMethodStore {
  const db = platformClient(env);
  const change = platformBillingCardChangeStore(env);
  return {
    load: change.load,
    upsertCharge: change.upsertCharge,
    openCharges: change.openCharges,
    loadCardChange: change.loadCardChange,
    finishCardChange: change.finishCardChange,
    async setPaymentMethod(contractId, method, actorId, actorKind) {
      const { data, error } = await (db.rpc as unknown as (n: string, a: Record<string, unknown>) => Promise<{ data: boolean | null; error: unknown }>)(
        "billing_set_payment_method",
        { p_contract_id: contractId, p_method: method, p_actor: actorId, p_actor_kind: actorKind },
      );
      if (error) throw new PlatformLookupError("billing_set_payment_method", error);
      return data === true;
    },
  };
}

// F12.2i: o cartão da assinatura (passo Cartão da Assinatura).
export type CardRegistration = { registeredAt: Date | null; acceptedIp: string | null; setupPaymentId: string | null };

export type BillingCardRegisterStore = BillingCardChangeStore & {
  cardRegistration(contractId: string): Promise<CardRegistration | null>;
  recordCardRegistered(contractId: string, last4: string | null, source: "setup" | "checkout"): Promise<void>;
  contractsWithoutCard(): Promise<string[]>;
};

export function platformBillingCardRegisterStore(env: ServiceEnv = platformEnv()): BillingCardRegisterStore {
  const db = platformClient(env);
  const change = platformBillingCardChangeStore(env);
  const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await (db.rpc as unknown as (n: string, a: Record<string, unknown>) => Promise<{ data: T; error: unknown }>)(name, args);
    if (error) throw new PlatformLookupError(name, error);
    return data;
  };
  return {
    ...change,
    async cardRegistration(contractId) {
      if (!isUuid(contractId)) return null;
      const { data, error } = await db.from("billing_contracts").select("card_registered_at, accepted_ip").eq("id", contractId).maybeSingle();
      if (error) throw new PlatformLookupError("contrato", error);
      if (!data) return null;
      const { data: setup, error: setupError } = await db
        .from("billing_charges")
        .select("asaas_payment_id")
        .eq("contract_id", contractId)
        .eq("kind", "setup")
        .not("asaas_payment_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (setupError) throw new PlatformLookupError("cobranças", setupError);
      return {
        registeredAt: data.card_registered_at ? new Date(data.card_registered_at) : null,
        acceptedIp: typeof data.accepted_ip === "string" ? data.accepted_ip : null,
        setupPaymentId: setup?.asaas_payment_id ?? null,
      };
    },
    recordCardRegistered: (contractId, last4, source) =>
      call<null>("billing_record_card_registered", { p_contract_id: contractId, p_last4: last4 ?? "", p_source: source }).then(() => undefined),
    contractsWithoutCard: async () => (await call<string[] | null>("billing_contracts_without_card", {})) ?? [],
  };
}

// Fila de eventos do webhook do Asaas e conciliação (F12.5).
export type BillingProviderEvent = { id: string; providerEventId: string; event: string; resourceId: string | null; attempts: number };

export type BillingEventStore = BillingStore & {
  recordEvent(input: { providerEventId: string; event: string; resourceId: string | null; payload: Record<string, unknown> }): Promise<boolean>;
  openEvents(limit: number): Promise<BillingProviderEvent[]>;
  finishEvent(id: string, status: "processed" | "ignored" | "failed", error: string | null): Promise<void>;
  contractForPayment(subscriptionId: string | null, externalReference: string | null): Promise<string | null>;
  contractsToReconcile(): Promise<string[]>;
};

export function platformBillingEventStore(env: ServiceEnv = platformEnv()): BillingEventStore {
  const db = platformClient(env);
  const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await (db.rpc as unknown as (n: string, a: Record<string, unknown>) => Promise<{ data: T; error: unknown }>)(name, args);
    if (error) throw new PlatformLookupError(name, error);
    return data;
  };
  return {
    ...platformBillingStore(env),
    async recordEvent(input) {
      const id = await call<string | null>("billing_record_provider_event", {
        p_provider_event_id: input.providerEventId,
        p_event: input.event,
        p_resource_id: input.resourceId,
        p_payload: input.payload,
      });
      return id !== null;
    },
    async openEvents(limit) {
      const rows = await call<{ id: string; provider_event_id: string; event: string; resource_id: string | null; attempts: number }[]>("billing_open_provider_events", { p_limit: limit });
      return (rows ?? []).map((r) => ({ id: r.id, providerEventId: r.provider_event_id, event: r.event, resourceId: r.resource_id, attempts: r.attempts }));
    },
    finishEvent: (id, status, error) => call<null>("billing_finish_provider_event", { p_id: id, p_status: status, p_error: error ?? "" }).then(() => undefined),
    contractForPayment: (subscriptionId, externalReference) =>
      call<string | null>("billing_contract_for_payment", { p_subscription_id: subscriptionId, p_external_reference: externalReference }),
    contractsToReconcile: async () => (await call<string[] | null>("billing_contracts_to_reconcile", {})) ?? [],
  };
}

// Avisos de cobrança (F12.7): o servidor agenda, lê e marca pelo banco.
export type BillingNotice = {
  id: string;
  kind: "overdue_d3" | "overdue_d7" | "overdue_d14" | "payment_confirmed";
  clinicId: string;
  clinicName: string;
  financeEmail: string | null;
  chargeKind: string;
  chargeStatus: string;
  dueDate: string;
  valueCents: number;
  invoiceUrl: string | null;
  paidAt: string | null;
};

export type BillingNoticeStore = {
  scheduleOverdue(): Promise<number>;
  openNotices(limit: number): Promise<BillingNotice[]>;
  finishNotice(id: string, status: "sent" | "canceled" | "failed", sentTo: string | null, error: string | null): Promise<void>;
};

export function platformBillingNoticeStore(env: ServiceEnv = platformEnv()): BillingNoticeStore {
  const db = platformClient(env);
  const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await (db.rpc as unknown as (n: string, a: Record<string, unknown>) => Promise<{ data: T; error: unknown }>)(name, args);
    if (error) throw new PlatformLookupError(name, error);
    return data;
  };
  return {
    scheduleOverdue: async () => (await call<number | null>("billing_schedule_overdue_notices", {})) ?? 0,
    async openNotices(limit) {
      type Row = { id: string; kind: BillingNotice["kind"]; clinic_id: string; clinic_name: string; finance_email: string | null; charge_kind: string; charge_status: string; due_date: string; value_cents: number; invoice_url: string | null; paid_at: string | null };
      const rows = (await call<Row[] | null>("billing_open_notices", { p_limit: limit })) ?? [];
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        clinicId: r.clinic_id,
        clinicName: r.clinic_name,
        financeEmail: r.finance_email,
        chargeKind: r.charge_kind,
        chargeStatus: r.charge_status,
        dueDate: r.due_date,
        valueCents: r.value_cents,
        invoiceUrl: r.invoice_url,
        paidAt: r.paid_at,
      }));
    },
    finishNotice: (id, status, sentTo, error) => call<null>("billing_finish_notice", { p_id: id, p_status: status, p_sent_to: sentTo ?? "", p_error: error ?? "" }).then(() => undefined),
  };
}

// ---------------------------------------------------------------------------
// Emissores fiscais (N2): o servidor lê o emissor, a chave da subconta e grava
// o que o Asaas respondeu. Quem chama já conferiu a permissão com o login.
// ---------------------------------------------------------------------------
export type PlatformIssuerStore = ReturnType<typeof platformIssuerStore>;

export function platformIssuerStore(env: ServiceEnv = platformEnv()) {
  const db = platformClient(env);
  const check = (error: unknown, what: string) => {
    if (error) throw new Error(`Emissor fiscal: ${what}`, { cause: error });
  };
  return {
    async read(issuerId: string) {
      const { data, error } = await db.from("fiscal_issuers").select("*").eq("id", issuerId).maybeSingle();
      check(error, "leitura");
      return data;
    },
    async apiKey(issuerId: string): Promise<string | null> {
      const { data, error } = await db.rpc("get_fiscal_issuer_api_key", { p_issuer_id: issuerId });
      check(error, "chave");
      return (data as string | null) ?? null;
    },
    async linkAccount(issuerId: string, a: { accountId: string; walletId: string; apiKey: string; webhookToken: string; environment: string; actorId: string | null }) {
      const { error } = await db.rpc("platform_link_fiscal_issuer_account", {
        p_issuer_id: issuerId,
        p_account_id: a.accountId,
        p_wallet_id: a.walletId,
        p_api_key: a.apiKey,
        p_webhook_token: a.webhookToken,
        p_environment: a.environment,
        p_actor: a.actorId as string,
      });
      check(error, "subconta");
    },
    async setAccountStatus(issuerId: string, status: string) {
      const { error } = await db.rpc("platform_set_fiscal_issuer_account_status", { p_issuer_id: issuerId, p_status: status });
      check(error, "situação");
    },
    async setFiscalInfo(issuerId: string, r: { ok: boolean; message: string | null; municipalOptions: unknown; certificateSent: boolean; certificateValidUntil: Date | null; actorId: string | null }) {
      const { error } = await db.rpc("platform_set_fiscal_issuer_fiscal_info", {
        p_issuer_id: issuerId,
        p_ok: r.ok,
        p_message: r.message as string,
        p_municipal_options: r.municipalOptions as never,
        p_certificate_sent: r.certificateSent,
        p_certificate_valid_until: (r.certificateValidUntil ? r.certificateValidUntil.toISOString() : null) as string,
        p_actor: r.actorId as string,
      });
      check(error, "configuração fiscal");
    },
    async setMunicipalOptions(issuerId: string, options: unknown) {
      const { error } = await db.rpc("platform_set_fiscal_issuer_municipal_options", { p_issuer_id: issuerId, p_options: options as never });
      check(error, "regras do município");
    },
    async findByAccount(accountId: string): Promise<{ issuerId: string; clinicId: string; webhookToken: string } | null> {
      const { data, error } = await db.rpc("find_fiscal_issuer_by_account", { p_account_id: accountId });
      check(error, "webhook");
      const row = (data as { issuer_id: string; clinic_id: string; webhook_token: string }[] | null)?.[0];
      return row ? { issuerId: row.issuer_id, clinicId: row.clinic_id, webhookToken: row.webhook_token } : null;
    },
  };
}

// ---------------------------------------------------------------------------
// Notas pelo Asaas (N3b): resultado gravado pelo webhook e pela conciliação,
// eventos do webhook (uma vez cada) e a trilha da reposição de saldo.
// ---------------------------------------------------------------------------
export type AsaasInvoiceRecorder = {
  finishIssue(a: { invoiceId: string; outcome: "issued" | "rejected" | "pending"; asaasInvoiceId: string | null; asaasStatus: string | null; number?: string | null; validationCode?: string | null; message?: string | null }): Promise<string>;
  finishCancel(a: { invoiceId: string; outcome: "canceled" | "denied" | "pending"; asaasStatus: string | null; message?: string | null }): Promise<string>;
};

/** Grava pelo cliente dado (o login de quem usa o painel, ou a plataforma). */
export function asaasInvoiceRecorder(db: DbClient): AsaasInvoiceRecorder {
  return {
    async finishIssue(a) {
      const { data, error } = await db.rpc("finish_asaas_invoice", {
        p_invoice_id: a.invoiceId,
        p_outcome: a.outcome,
        p_asaas_invoice_id: a.asaasInvoiceId as string,
        p_asaas_status: a.asaasStatus as string,
        p_number: (a.number ?? null) as string,
        p_validation_code: (a.validationCode ?? null) as string,
        p_message: (a.message ?? null) as string,
      });
      if (error) throw new Error("Nota fiscal: resultado não gravado", { cause: error });
      return data as string;
    },
    async finishCancel(a) {
      const { data, error } = await db.rpc("finish_asaas_cancel", {
        p_invoice_id: a.invoiceId,
        p_outcome: a.outcome,
        p_asaas_status: a.asaasStatus as string,
        p_message: (a.message ?? null) as string,
      });
      if (error) throw new Error("Nota fiscal: cancelamento não gravado", { cause: error });
      return data as string;
    },
  };
}

export type PendingAsaasInvoice = { invoiceId: string; clinicId: string; issuerId: string; status: string; asaasInvoiceId: string | null };

export function platformAsaasNfse(env: ServiceEnv = platformEnv()) {
  const db = platformClient(env);
  const fail = (error: unknown, what: string) => {
    if (error) throw new Error(`Notas pelo Asaas: ${what}`, { cause: error });
  };
  return {
    recorder: asaasInvoiceRecorder(db),
    async listPending(before: Date): Promise<PendingAsaasInvoice[]> {
      const { data, error } = await db.rpc("list_pending_asaas_invoices", { p_before: before.toISOString() });
      fail(error, "pendentes");
      return ((data ?? []) as { invoice_id: string; clinic_id: string; issuer_id: string; status: string; asaas_invoice_id: string | null }[]).map((r) => ({
        invoiceId: r.invoice_id,
        clinicId: r.clinic_id,
        issuerId: r.issuer_id,
        status: r.status,
        asaasInvoiceId: r.asaas_invoice_id,
      }));
    },
    async invoice(invoiceId: string): Promise<PendingAsaasInvoice | null> {
      const { data, error } = await db.from("nfse_invoices").select("id, clinic_id, issuer_id, status, asaas_invoice_id, provider").eq("id", invoiceId).maybeSingle();
      fail(error, "nota");
      return data && data.provider === "asaas" && data.issuer_id
        ? { invoiceId: data.id, clinicId: data.clinic_id, issuerId: data.issuer_id, status: data.status, asaasInvoiceId: data.asaas_invoice_id }
        : null;
    },
    async findByAsaasId(issuerId: string, asaasInvoiceId: string): Promise<{ invoiceId: string; clinicId: string; status: string } | null> {
      const { data, error } = await db.rpc("find_asaas_invoice", { p_issuer_id: issuerId, p_asaas_invoice_id: asaasInvoiceId });
      fail(error, "nota pelo id do Asaas");
      const row = (data as { invoice_id: string; clinic_id: string; status: string }[] | null)?.[0];
      return row ? { invoiceId: row.invoice_id, clinicId: row.clinic_id, status: row.status } : null;
    },
    async recordEvent(e: { id: string; clinicId: string; issuerId: string; event: string; asaasInvoiceId: string | null }): Promise<boolean> {
      const { data, error } = await db.rpc("record_nfse_provider_event", {
        p_id: e.id,
        p_clinic_id: e.clinicId,
        p_issuer_id: e.issuerId,
        p_event: e.event,
        p_asaas_invoice_id: e.asaasInvoiceId as string,
      });
      fail(error, "evento");
      return data === true;
    },
    async finishEvent(id: string, problem: string | null): Promise<void> {
      const { error } = await db.rpc("finish_nfse_provider_event", { p_id: id, p_error: problem as string });
      fail(error, "evento processado");
    },
    async recordTopUp(issuerId: string, valueCents: number, transferId: string): Promise<void> {
      const { error } = await db.rpc("record_issuer_top_up", { p_issuer_id: issuerId, p_value_cents: valueCents, p_transfer_id: transferId });
      fail(error, "reposição de saldo");
    },
  };
}

export type PlatformAsaasNfse = ReturnType<typeof platformAsaasNfse>;

// ---------------------------------------------------------------------------
// Arquivos e entrega automática das notas do Asaas (N4)
// ---------------------------------------------------------------------------
export type AutoDeliveryFacts = {
  invoiceId: string;
  clinicId: string;
  status: string;
  nfseNumber: string | null;
  pdfPath: string | null;
  amountCents: number;
  payerName: string;
  appointmentId: string;
  scheduledAt: string;
  patientName: string;
  contactName: string;
  contactPhone: string;
  savedPhone: string | null;
  autoSend: boolean;
};

export function platformInvoiceFiles(env: ServiceEnv = platformEnv()) {
  const db = platformClient(env);
  const fail = (error: unknown, what: string) => {
    if (error) throw new Error(`Arquivos da nota: ${what}`, { cause: error });
  };
  return {
    /** Guarda o PDF e o XML (bucket privado) e marca a entrega automática. */
    async store(clinicId: string, invoiceId: string, files: { pdf: Uint8Array | null; xml: Uint8Array | null }): Promise<void> {
      let pdfPath: string | null = null;
      let xmlPath: string | null = null;
      if (files.pdf) {
        const path = `${clinicId}/${invoiceId}.pdf`;
        const { error } = await db.storage.from("nfse-pdf").upload(path, new Blob([files.pdf as BlobPart], { type: "application/pdf" }), { contentType: "application/pdf", upsert: true });
        fail(error, "PDF");
        pdfPath = path;
      }
      if (files.xml) {
        const path = `${clinicId}/${invoiceId}.xml`;
        const { error } = await db.storage.from("nfse-xml").upload(path, new Blob([files.xml as BlobPart], { type: "application/xml" }), { contentType: "application/xml", upsert: true });
        fail(error, "XML");
        xmlPath = path;
      }
      const { error } = await db.rpc("platform_set_invoice_files", { p_invoice_id: invoiceId, p_pdf_path: pdfPath as string, p_xml_path: xmlPath as string });
      fail(error, "caminhos");
    },
    /** Emitidas pelo Asaas sem o PDF guardado (o download falhou): a rotina tenta de novo. */
    async missingFiles(limit = 50): Promise<{ invoiceId: string; clinicId: string; issuerId: string; asaasInvoiceId: string }[]> {
      const { data, error } = await db
        .from("nfse_invoices")
        .select("id, clinic_id, issuer_id, asaas_invoice_id")
        .eq("provider", "asaas")
        .in("status", ["issued", "canceling", "canceled"])
        .is("pdf_path", null)
        .not("asaas_invoice_id", "is", null)
        .limit(limit);
      fail(error, "pendentes");
      return (data ?? []).map((r) => ({ invoiceId: r.id, clinicId: r.clinic_id, issuerId: r.issuer_id!, asaasInvoiceId: r.asaas_invoice_id! }));
    },
    async claimDeliveries(limit = 20): Promise<{ invoiceId: string; clinicId: string }[]> {
      const { data, error } = await db.rpc("platform_claim_auto_deliveries", { p_limit: limit });
      fail(error, "entregas");
      return ((data ?? []) as { invoice_id: string; clinic_id: string }[]).map((r) => ({ invoiceId: r.invoice_id, clinicId: r.clinic_id }));
    },
    async finishDelivery(invoiceId: string, ok: boolean): Promise<void> {
      const { error } = await db.rpc("platform_finish_auto_delivery", { p_invoice_id: invoiceId, p_ok: ok });
      fail(error, "entrega concluída");
    },
    async deliveryFacts(invoiceId: string): Promise<AutoDeliveryFacts | null> {
      const { data, error } = await db
        .from("nfse_invoices")
        .select(
          "id, clinic_id, status, nfse_number, pdf_path, payments ( amount_cents, payer_name, appointment_id, patient_id, appointments ( scheduled_at ), patients ( full_name, contacts ( full_name, phone ) ) )",
        )
        .eq("id", invoiceId)
        .maybeSingle();
      fail(error, "nota");
      if (!data) return null;
      const p = data.payments as unknown as {
        amount_cents: number;
        payer_name: string;
        appointment_id: string;
        patient_id: string;
        appointments: { scheduled_at: string };
        patients: { full_name: string; contacts: { full_name: string; phone: string } };
      };
      const { data: fin } = await db.from("patient_finance").select("invoice_phone, invoice_auto_send").eq("patient_id", p.patient_id).maybeSingle();
      return {
        invoiceId: data.id,
        clinicId: data.clinic_id,
        status: data.status,
        nfseNumber: data.nfse_number,
        pdfPath: data.pdf_path,
        amountCents: p.amount_cents,
        payerName: p.payer_name,
        appointmentId: p.appointment_id,
        scheduledAt: p.appointments.scheduled_at,
        patientName: p.patients.full_name,
        contactName: p.patients.contacts.full_name,
        contactPhone: p.patients.contacts.phone,
        savedPhone: fin?.invoice_phone ?? null,
        autoSend: fin?.invoice_auto_send === true,
      };
    },
    async pdf(path: string): Promise<Uint8Array> {
      const { data, error } = await db.storage.from("nfse-pdf").download(path);
      fail(error, "PDF guardado");
      return new Uint8Array(await data!.arrayBuffer());
    },
    /** Envio registrado (uma vez por destino: o índice único barra o repetido). */
    async recordDelivery(row: { clinicId: string; invoiceId: string; destination: string; target: "contact" | "other"; ok: boolean; error: string | null; whatsappMessageId: string | null }): Promise<boolean> {
      const { error } = await db.from("nfse_deliveries").insert({
        clinic_id: row.clinicId,
        invoice_id: row.invoiceId,
        channel: "whatsapp",
        destination: row.destination,
        target: row.target,
        status: row.ok ? "sent" : "failed",
        error: row.error,
        whatsapp_message_id: row.whatsappMessageId,
        automatic: true,
      });
      if (error && (error as { code?: string }).code === "23505") {
        // Nova tentativa depois de uma falha: atualiza o mesmo envio.
        const { error: again } = await db
          .from("nfse_deliveries")
          .update({ status: row.ok ? "sent" : "failed", error: row.error, whatsapp_message_id: row.whatsappMessageId })
          .eq("invoice_id", row.invoiceId)
          .eq("channel", "whatsapp")
          .eq("destination", row.destination)
          .eq("automatic", true)
          .neq("status", "sent");
        fail(again, "envio repetido");
        return false;
      }
      fail(error, "envio");
      return true;
    },
    /** Já houve envio automático com sucesso para este destino? */
    async alreadySent(invoiceId: string, destination: string): Promise<boolean> {
      const { data, error } = await db.from("nfse_deliveries").select("status").eq("invoice_id", invoiceId).eq("destination", destination).eq("automatic", true).maybeSingle();
      fail(error, "envio anterior");
      return data?.status === "sent";
    },
  };
}

export type PlatformInvoiceFiles = ReturnType<typeof platformInvoiceFiles>;

// ---------------------------------------------------------------------------
// Cobrança das notas (N4b): apuração, cobranças no Asaas e suspensão.
// ---------------------------------------------------------------------------
export type FiscalChargeContext = {
  id: string;
  clinicId: string;
  issuerId: string | null;
  period: string;
  notesCount: number;
  amountCents: number;
  feeCents: number;
  dueDate: string;
  status: string;
  asaasPaymentId: string | null;
  /** Clínica: cliente e forma do contrato; profissional: dados do emissor. */
  clinic: { customerId: string | null; paymentMethod: string | null; billingMode: string | null } | null;
  professional: { customerId: string | null; legalName: string; cnpj: string; email: string; mobilePhone: string; postalCode: string; street: string; number: string; complement: string | null; district: string } | null;
};

export function platformFiscalBilling(env: ServiceEnv = platformEnv()) {
  const db = platformClient(env);
  const fail = (error: unknown, what: string) => {
    if (error) throw new Error(`Cobrança das notas: ${what}`, { cause: error });
  };
  return {
    async computeUsage(period: string, today: string): Promise<number> {
      const { data, error } = await db.rpc("platform_compute_fiscal_usage", { p_period: period, p_today: today });
      fail(error, "apuração");
      return Number(data ?? 0);
    },
    async openCharges(syncedBefore: Date, limit = 50): Promise<FiscalChargeContext[]> {
      const { data, error } = await db
        .from("fiscal_usage_charges")
        .select("id, clinic_id, issuer_id, period, notes_count, amount_cents, fee_cents, due_date, status, asaas_payment_id, last_synced_at")
        .in("status", ["creating", "pending", "overdue"])
        .or(`status.eq.creating,last_synced_at.is.null,last_synced_at.lt.${syncedBefore.toISOString()}`)
        .order("created_at")
        .limit(limit);
      fail(error, "abertas");
      const out: FiscalChargeContext[] = [];
      for (const r of data ?? []) {
        let clinic: FiscalChargeContext["clinic"] = null;
        let professional: FiscalChargeContext["professional"] = null;
        if (!r.issuer_id) {
          const [{ data: acc }, { data: contract }] = await Promise.all([
            db.from("billing_accounts").select("asaas_customer_id").eq("clinic_id", r.clinic_id).maybeSingle(),
            db.from("billing_contracts").select("payment_method, billing_mode").eq("clinic_id", r.clinic_id).in("status", ["active", "ended"]).order("version", { ascending: false }).limit(1).maybeSingle(),
          ]);
          clinic = { customerId: acc?.asaas_customer_id ?? null, paymentMethod: contract?.payment_method ?? null, billingMode: contract?.billing_mode ?? null };
        } else {
          const [{ data: i }, { data: k }] = await Promise.all([
            db.from("fiscal_issuers").select("legal_name, cnpj, fiscal_email, mobile_phone, postal_code, street, street_number, complement, district").eq("id", r.issuer_id).maybeSingle(),
            db.from("fiscal_issuer_contracts").select("asaas_customer_id").eq("issuer_id", r.issuer_id).maybeSingle(),
          ]);
          if (i) {
            professional = {
              customerId: k?.asaas_customer_id ?? null,
              legalName: i.legal_name,
              cnpj: i.cnpj,
              email: i.fiscal_email,
              mobilePhone: i.mobile_phone,
              postalCode: i.postal_code,
              street: i.street,
              number: i.street_number,
              complement: i.complement,
              district: i.district,
            };
          }
        }
        out.push({
          id: r.id,
          clinicId: r.clinic_id,
          issuerId: r.issuer_id,
          period: r.period,
          notesCount: r.notes_count,
          amountCents: r.amount_cents,
          feeCents: r.fee_cents,
          dueDate: r.due_date,
          status: r.status,
          asaasPaymentId: r.asaas_payment_id,
          clinic,
          professional,
        });
      }
      return out;
    },
    async setCharge(id: string, a: { asaasPaymentId?: string | null; rawStatus?: string | null; invoiceUrl?: string | null; paidAt?: string | null; error?: string | null }): Promise<void> {
      const { error } = await db.rpc("platform_set_fiscal_usage_charge", {
        p_id: id,
        p_asaas_payment_id: (a.asaasPaymentId ?? null) as string,
        p_raw_status: (a.rawStatus ?? null) as string,
        p_invoice_url: (a.invoiceUrl ?? null) as string,
        p_paid_at: (a.paidAt ?? null) as string,
        p_error: (a.error ?? null) as string,
      });
      fail(error, "situação");
    },
    async setContractCustomer(issuerId: string, customerId: string): Promise<void> {
      const { error } = await db.rpc("platform_set_issuer_contract_customer", { p_issuer_id: issuerId, p_customer: customerId });
      fail(error, "cliente do profissional");
    },
    async applySuspensions(today: string): Promise<number> {
      const { data, error } = await db.rpc("platform_apply_issuer_suspensions", { p_today: today });
      fail(error, "suspensões");
      return Number(data ?? 0);
    },
  };
}

export type PlatformFiscalBilling = ReturnType<typeof platformFiscalBilling>;
