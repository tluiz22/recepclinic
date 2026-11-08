import { timingSafeEqual } from "node:crypto";
import { asaasAccountsApi, type AsaasAccountsApi } from "../asaas/accountsApi";
import { asaasFiscalApi, type AsaasFiscalApi, type AsaasInvoice } from "../asaas/fiscalApi";
import { AsaasApiError } from "../asaas/http";
import { platformEnv } from "../env";
import { logError } from "../log";
import type { DbClient } from "./clients";
import { DataError, fromDbError } from "./errors";
import { asaasInvoiceRecorder, platformAsaasNfse, platformIssuerStore, type AsaasInvoiceRecorder, type PlatformAsaasNfse, type PlatformIssuerStore } from "./platform";

// Nota fiscal pelo Asaas (N3b; planejamento-nfse-asaas.md, seções 5 e 14).
// O banco escolhe o emissor do atendimento e reserva a nota ("emitindo"); o
// servidor repõe o saldo da subconta, cadastra o tomador, agenda e autoriza a
// nota no Asaas (externalReference = id da nota local, para não duplicar) e
// grava o que veio. "Pedido aceito" não é "nota emitida": quem confirma é o
// webhook (ou a conciliação da rotina), sempre conferindo pelo GET da nota.

export type AsaasNfseDeps = {
  issuers: PlatformIssuerStore;
  nfse: PlatformAsaasNfse;
  accounts: AsaasAccountsApi;
  fiscalFor: (apiKey: string) => AsaasFiscalApi;
  /** Reposição automática (decisão de 30/out): abaixo do mínimo, transfere até o alvo. */
  topUp: { minCents: number; targetCents: number };
  now: () => Date;
  /** Depois que a nota sai (N4: arquivos e entrega). */
  afterIssued?: (invoiceId: string, clinicId: string, invoice: AsaasInvoice, fiscal: AsaasFiscalApi) => Promise<void>;
};

export const TOP_UP = { minCents: 500, targetCents: 1000 };

export function defaultAsaasNfseDeps(): AsaasNfseDeps {
  const asaas = platformEnv().asaas;
  if (!asaas) throw new DataError("not_enabled", "O Asaas não está configurado neste ambiente (ASAAS_API_KEY e ASAAS_BASE_URL).");
  return {
    issuers: platformIssuerStore(),
    nfse: platformAsaasNfse(),
    accounts: asaasAccountsApi(asaas),
    fiscalFor: (apiKey) => asaasFiscalApi({ baseUrl: asaas.baseUrl, apiKey }),
    topUp: TOP_UP,
    now: () => new Date(),
  };
}

export type NfseResult = { status: "issuing" | "issued" | "rejected" | "canceling" | "canceled"; message: string };

type BeginAsaas = {
  invoice_id: string;
  issuer_id: string;
  competence: string;
  amount_cents: number;
  payer_cpf: string;
  payer_name: string;
  payer_email: string;
  payer_postal_code: string;
  payer_street: string;
  payer_number: string;
  payer_complement: string | null;
  payer_district: string;
  patient_name: string;
  service_name: string;
  appointment_date: string;
  service_code: string;
  municipal_service_name: string;
  iss_rate: number;
  nbs_code: string | null;
  pis_cofins_tax_status: string | null;
  tax_situation_code: string | null;
  tax_classification_code: string | null;
  operation_indicator_code: string | null;
};

const brDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Descrição aprovada pelo cliente (30/out): "Consulta. Paciente: Nome. Atendimento em dd/mm/aaaa." */
export function invoiceDescription(serviceName: string, patientName: string, appointmentDate: string): string {
  return `${serviceName.trim().replace(/\.$/, "")}. Paciente: ${patientName.trim()}. Atendimento em ${brDate(appointmentDate)}.`;
}

async function fiscalOf(deps: AsaasNfseDeps, issuerId: string): Promise<AsaasFiscalApi> {
  const key = await deps.issuers.apiKey(issuerId);
  if (!key) throw new DataError("invalid", "O emissor desta nota está sem a chave do Asaas: fale com o suporte.");
  return deps.fiscalFor(key);
}

/** Saldo da subconta paga a tarifa da nota: abaixo do mínimo, a principal repõe até o alvo. */
export async function ensureIssuerBalance(deps: AsaasNfseDeps, issuerId: string, fiscal: AsaasFiscalApi): Promise<void> {
  const balance = await fiscal.balanceCents();
  if (balance >= deps.topUp.minCents) return;
  const issuer = await deps.issuers.read(issuerId);
  if (!issuer?.asaas_wallet_id) return;
  const value = deps.topUp.targetCents - balance;
  const transfer = await deps.accounts.transferToWallet(issuer.asaas_wallet_id, value, `reposicao-${issuerId}-${deps.now().toISOString().slice(0, 10)}`);
  await deps.nfse.recordTopUp(issuerId, value, transfer.id);
}

/** Aplica o estado do Asaas à nota local (emissão ou cancelamento). */
export async function applyAsaasState(
  recorder: AsaasInvoiceRecorder,
  deps: AsaasNfseDeps,
  local: { invoiceId: string; clinicId: string; status: string },
  remote: AsaasInvoice,
  fiscal: AsaasFiscalApi,
): Promise<NfseResult> {
  if (local.status === "issuing") {
    if (remote.state === "authorized") {
      const status = await recorder.finishIssue({ invoiceId: local.invoiceId, outcome: "issued", asaasInvoiceId: remote.id, asaasStatus: remote.rawStatus, number: remote.number, validationCode: remote.validationCode });
      if (status === "issued" && deps.afterIssued) {
        await deps.afterIssued(local.invoiceId, local.clinicId, remote, fiscal).catch((error) => logError("nota fiscal: depois de emitida", error, { nota: local.invoiceId }));
      }
      return { status: "issued", message: remote.number ? `Nota fiscal nº ${remote.number} emitida.` : "Nota fiscal emitida." };
    }
    if (remote.state === "error") {
      const message = remote.statusDescription ?? "A prefeitura recusou a nota.";
      await recorder.finishIssue({ invoiceId: local.invoiceId, outcome: "rejected", asaasInvoiceId: remote.id, asaasStatus: remote.rawStatus, message });
      return { status: "rejected", message: `A nota foi recusada: ${message}` };
    }
    await recorder.finishIssue({ invoiceId: local.invoiceId, outcome: "pending", asaasInvoiceId: remote.id, asaasStatus: remote.rawStatus });
    return { status: "issuing", message: "Pedido aceito pelo Asaas: a nota aparece aqui assim que a prefeitura autorizar (costuma levar segundos)." };
  }
  if (local.status === "canceling") {
    if (remote.state === "canceled") {
      await recorder.finishCancel({ invoiceId: local.invoiceId, outcome: "canceled", asaasStatus: remote.rawStatus });
      return { status: "canceled", message: "Nota fiscal cancelada." };
    }
    if (remote.state === "cancel_denied") {
      const message = remote.statusDescription ?? "A prefeitura não aceitou o cancelamento.";
      await recorder.finishCancel({ invoiceId: local.invoiceId, outcome: "denied", asaasStatus: remote.rawStatus, message });
      return { status: "issued", message: `O cancelamento foi negado: ${message} A nota continua emitida.` };
    }
    await recorder.finishCancel({ invoiceId: local.invoiceId, outcome: "pending", asaasStatus: remote.rawStatus });
    return { status: "canceling", message: "Cancelamento pedido: a prefeitura ainda está processando." };
  }
  return { status: local.status as NfseResult["status"], message: "Nada a fazer: a nota já tem resultado." };
}

/** Emite a nota do pagamento pelo emissor do atendimento. */
export async function issueAsaasInvoice(db: DbClient, paymentId: string, deps: AsaasNfseDeps = defaultAsaasNfseDeps()): Promise<NfseResult> {
  const { data, error } = await db.rpc("begin_asaas_invoice", { p_payment_id: paymentId });
  if (error) throw fromDbError(error, "Nota fiscal");
  const b = data as unknown as BeginAsaas;
  const recorder = asaasInvoiceRecorder(db);
  const local = { invoiceId: b.invoice_id, clinicId: "", status: "issuing" };
  let fiscal: AsaasFiscalApi;
  try {
    fiscal = await fiscalOf(deps, b.issuer_id);
  } catch (e) {
    await recorder.finishIssue({ invoiceId: b.invoice_id, outcome: "rejected", asaasInvoiceId: null, asaasStatus: "SEM-CHAVE", message: (e as Error).message });
    throw e;
  }
  const issuer = await deps.issuers.read(b.issuer_id);
  local.clinicId = issuer?.clinic_id ?? "";
  try {
    await ensureIssuerBalance(deps, b.issuer_id, fiscal).catch((e) => logError("nota fiscal: reposição do saldo", e, { emissor: b.issuer_id }));
    const customer = await fiscal.upsertCustomer({
      name: b.payer_name,
      cpfCnpj: b.payer_cpf,
      email: b.payer_email,
      postalCode: b.payer_postal_code,
      street: b.payer_street,
      number: b.payer_number,
      complement: b.payer_complement,
      district: b.payer_district,
      externalReference: `tomador-${b.payer_cpf}`,
    });
    let remote = await fiscal.findInvoice(b.invoice_id);
    if (!remote) {
      remote = await fiscal.createInvoice({
        customer,
        serviceDescription: invoiceDescription(b.service_name, b.patient_name, b.appointment_date),
        observations: "",
        valueCents: b.amount_cents,
        effectiveDate: b.competence,
        municipalServiceCode: b.service_code,
        municipalServiceName: b.municipal_service_name,
        externalReference: b.invoice_id,
        taxes: {
          retainIss: false,
          iss: Number(b.iss_rate),
          pis: 0,
          cofins: 0,
          csll: 0,
          inss: 0,
          ir: 0,
          nbsCode: b.nbs_code,
          taxSituationCode: b.tax_situation_code,
          taxClassificationCode: b.tax_classification_code,
          operationIndicatorCode: b.operation_indicator_code,
          pisCofinsTaxStatus: b.pis_cofins_tax_status,
        },
      });
    }
    await recorder.finishIssue({ invoiceId: b.invoice_id, outcome: "pending", asaasInvoiceId: remote.id, asaasStatus: remote.rawStatus });
    if (remote.rawStatus === "SCHEDULED") remote = await fiscal.authorizeInvoice(remote.id);
    return await applyAsaasState(recorder, deps, local, remote, fiscal);
  } catch (e) {
    if (e instanceof AsaasApiError && e.status >= 400 && e.status < 500) {
      const message = e.message.replace(/^Asaas recusou \(\d+\): /, "");
      await recorder.finishIssue({ invoiceId: b.invoice_id, outcome: "rejected", asaasInvoiceId: null, asaasStatus: `HTTP-${e.status}`, message });
      return { status: "rejected", message: `O Asaas recusou a nota: ${message}` };
    }
    // Sem resposta: fica "emitindo"; a conciliação procura pela referência antes de repetir.
    logError("nota fiscal: Asaas sem resposta", e, { nota: b.invoice_id });
    await recorder.finishIssue({ invoiceId: b.invoice_id, outcome: "pending", asaasInvoiceId: null, asaasStatus: null, message: "Asaas sem resposta" });
    return { status: "issuing", message: "O Asaas não respondeu agora. A nota fica \"emitindo\" e o sistema confere sozinho em alguns minutos." };
  }
}

/** Confere no Asaas uma nota "emitindo" ou "cancelando" (botão da tela ou rotina). */
export async function refreshAsaasInvoice(
  recorder: AsaasInvoiceRecorder,
  local: { invoiceId: string; clinicId: string; issuerId: string; status: string; asaasInvoiceId: string | null },
  deps: AsaasNfseDeps,
  { giveUpWithoutRemote = false }: { giveUpWithoutRemote?: boolean } = {},
): Promise<NfseResult> {
  const fiscal = await fiscalOf(deps, local.issuerId);
  let remote = local.asaasInvoiceId ? await fiscal.getInvoice(local.asaasInvoiceId) : await fiscal.findInvoice(local.invoiceId);
  // Agendada e não autorizada (o authorize ficou sem resposta): pede de novo.
  if (remote && local.status === "issuing" && remote.rawStatus === "SCHEDULED") remote = await fiscal.authorizeInvoice(remote.id);
  if (!remote) {
    if (local.status === "issuing" && giveUpWithoutRemote) {
      const message = "O pedido não chegou ao Asaas. Pode emitir de novo.";
      await recorder.finishIssue({ invoiceId: local.invoiceId, outcome: "rejected", asaasInvoiceId: null, asaasStatus: "SEM-NOTA", message });
      return { status: "rejected", message };
    }
    return { status: local.status as NfseResult["status"], message: "O Asaas ainda não tem esta nota. Confira de novo daqui a pouco." };
  }
  return applyAsaasState(recorder, deps, local, remote, fiscal);
}

/** Pelo botão "Conferir" da tela (com o login de quem usa o painel). */
export async function checkAsaasInvoice(db: DbClient, clinicId: string, invoiceId: string, deps: AsaasNfseDeps = defaultAsaasNfseDeps()): Promise<NfseResult> {
  const { data, error } = await db.from("nfse_invoices").select("id, clinic_id, issuer_id, status, asaas_invoice_id, provider").eq("clinic_id", clinicId).eq("id", invoiceId).maybeSingle();
  if (error) throw fromDbError(error, "Nota fiscal");
  if (!data || data.provider !== "asaas" || !data.issuer_id) throw new DataError("not_found", "Nota fiscal: não encontrada");
  if (data.status !== "issuing" && data.status !== "canceling") throw new DataError("invalid", "Nota fiscal: não está pendente");
  return refreshAsaasInvoice(asaasInvoiceRecorder(db), { invoiceId: data.id, clinicId: data.clinic_id, issuerId: data.issuer_id, status: data.status, asaasInvoiceId: data.asaas_invoice_id }, deps);
}

/** Cancela (o Administrador ou o profissional dono do emissor; o banco confere). */
export async function cancelAsaasInvoice(db: DbClient, invoiceId: string, reason: string, deps: AsaasNfseDeps = defaultAsaasNfseDeps()): Promise<NfseResult> {
  const { data, error } = await db.rpc("begin_asaas_cancel", { p_invoice_id: invoiceId, p_reason: reason });
  if (error) throw fromDbError(error, "Cancelamento");
  const b = data as unknown as { invoice_id: string; issuer_id: string; asaas_invoice_id: string | null };
  const recorder = asaasInvoiceRecorder(db);
  if (!b.asaas_invoice_id) {
    await recorder.finishCancel({ invoiceId, outcome: "denied", asaasStatus: null, message: "Nota sem o registro do Asaas." });
    return { status: "issued", message: "Esta nota não tem o registro do Asaas: fale com o suporte." };
  }
  const fiscal = await fiscalOf(deps, b.issuer_id);
  try {
    const remote = await fiscal.cancelInvoice(b.asaas_invoice_id);
    return await applyAsaasState(recorder, deps, { invoiceId, clinicId: "", status: "canceling" }, remote, fiscal);
  } catch (e) {
    if (e instanceof AsaasApiError && e.status >= 400 && e.status < 500) {
      const message = e.message.replace(/^Asaas recusou \(\d+\): /, "");
      await recorder.finishCancel({ invoiceId, outcome: "denied", asaasStatus: `HTTP-${e.status}`, message });
      return { status: "issued", message: `O Asaas recusou o cancelamento: ${message}` };
    }
    logError("nota fiscal: cancelamento sem resposta", e, { nota: invoiceId });
    await recorder.finishCancel({ invoiceId, outcome: "pending", asaasStatus: null, message: "Asaas sem resposta" });
    return { status: "canceling", message: "O Asaas não respondeu agora. A nota fica \"cancelando\" e o sistema confere sozinho." };
  }
}

// ---------------------------------------------------------------------------
// Webhook das notas (/api/asaas/notas) e conciliação
// ---------------------------------------------------------------------------

/** `process`: confirmação da nota, a rodar depois do 200 (waitUntil); falhou, a rotina pega. */
export type WebhookOutcome = { status: number; body: string; process?: () => Promise<void> };

const sameToken = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Evento do Asaas: identifica o emissor pela subconta, confere o token dela
 * (tempo constante), grava o evento uma vez e confirma a nota pelo GET.
 */
export async function handleInvoiceWebhook(payload: unknown, token: string | null, deps: AsaasNfseDeps = defaultAsaasNfseDeps()): Promise<WebhookOutcome> {
  const body = payload as { id?: unknown; event?: unknown; account?: { id?: unknown }; invoice?: { id?: unknown; externalReference?: unknown } } | null;
  const eventId = typeof body?.id === "string" ? body.id : null;
  const event = typeof body?.event === "string" ? body.event : null;
  const accountId = typeof body?.account?.id === "string" ? body.account.id : null;
  const asaasInvoiceId = typeof body?.invoice?.id === "string" ? body.invoice.id : null;
  if (!eventId || !event || !accountId) return { status: 400, body: "evento incompleto" };
  const issuer = await deps.issuers.findByAccount(accountId);
  if (!issuer || !token || !sameToken(token, issuer.webhookToken)) return { status: 401, body: "token inválido" };
  const fresh = await deps.nfse.recordEvent({ id: eventId, clinicId: issuer.clinicId, issuerId: issuer.issuerId, event, asaasInvoiceId });
  if (!fresh || !event.startsWith("INVOICE_") || !asaasInvoiceId) return { status: 200, body: "ok" };
  const process = async () => {
    let problem: string | null = null;
    try {
      let local = await deps.nfse.findByAsaasId(issuer.issuerId, asaasInvoiceId);
      let ref = typeof body?.invoice?.externalReference === "string" ? body.invoice.externalReference : null;
      if (!local) {
        // O webhook pode chegar antes de gravarmos o id do Asaas: a referência é o id da nota local.
        const fiscal = await fiscalOf(deps, issuer.issuerId);
        ref ??= (await fiscal.getInvoice(asaasInvoiceId)).externalReference;
        const byRef = ref ? await deps.nfse.invoice(ref) : null;
        if (byRef && byRef.issuerId === issuer.issuerId) local = { invoiceId: byRef.invoiceId, clinicId: byRef.clinicId, status: byRef.status };
      }
      if (local && (local.status === "issuing" || local.status === "canceling")) {
        await refreshAsaasInvoice(deps.nfse.recorder, { ...local, issuerId: issuer.issuerId, asaasInvoiceId }, deps);
      }
    } catch (error) {
      problem = error instanceof Error ? error.message : "falha ao processar";
      logError("webhook das notas", error, { evento: eventId });
    }
    await deps.nfse.finishEvent(eventId, problem);
  };
  return { status: 200, body: "ok", process };
}

/** Rotina: confere as notas pendentes há mais de alguns minutos. */
export async function reconcileAsaasInvoices(deps: AsaasNfseDeps = defaultAsaasNfseDeps(), olderThanMinutes = 3): Promise<{ checked: number; failed: number }> {
  const pending = await deps.nfse.listPending(new Date(deps.now().getTime() - olderThanMinutes * 60_000));
  let failed = 0;
  for (const p of pending) {
    try {
      // Sem id do Asaas e sem nota pela referência: o pedido não chegou ao Asaas.
      const old = !p.asaasInvoiceId;
      await refreshAsaasInvoice(deps.nfse.recorder, p, deps, { giveUpWithoutRemote: old });
    } catch (error) {
      failed++;
      logError("conciliação das notas", error, { nota: p.invoiceId });
    }
  }
  return { checked: pending.length, failed };
}

export type AsaasReadiness = {
  ready: boolean;
  issuerName: string | null;
  environment: "sandbox" | "production" | null;
  supportsCancellation: boolean;
  reason: string | null;
};

/** Para a tela do pagamento: o emissor do atendimento e se ele já emite. */
export async function asaasReadiness(db: DbClient, appointmentId: string): Promise<AsaasReadiness> {
  const { data, error } = await db.rpc("fiscal_issuer_for_appointment", { p_appointment_id: appointmentId });
  if (error) throw fromDbError(error, "Nota fiscal");
  const r = data as {
    issuer_id: string | null;
    legal_name?: string;
    environment?: "sandbox" | "production";
    issuing_enabled?: boolean;
    suspended?: boolean;
    supports_cancellation?: boolean;
    contract_ok?: boolean;
    route_none?: boolean;
  } | null;
  const base = { issuerName: r?.legal_name ?? null, environment: r?.environment ?? null, supportsCancellation: r?.supports_cancellation ?? true };
  if (!r?.issuer_id) {
    return { ...base, ready: false, reason: r?.route_none ? "Este profissional não emite nota pelo sistema." : "A clínica ainda não tem emissor de nota fiscal (Configurações › Nota fiscal)." };
  }
  if (r.suspended) return { ...base, ready: false, reason: `A emissão de ${r.legal_name} está suspensa por falta de pagamento.` };
  if (!r.contract_ok) return { ...base, ready: false, reason: "Falta o Administrador assinar o contrato com nota fiscal (Configurações › Assinatura)." };
  if (!r.issuing_enabled) return { ...base, ready: false, reason: `A emissão de ${r.legal_name} ainda não está ligada (Configurações › Nota fiscal).` };
  return { ...base, ready: true, reason: null };
}
