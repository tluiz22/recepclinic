import { findNfseByDps, hasCancelEvent, httpsTransport, sendCancel, sendDps, describeSefinErrors, type SefinTransport } from "../nfse/client";
import { buildCancelRequest, buildDps, nfseNumberOf, type DpsInput, type NfseEnvironment } from "../nfse/dps";
import { keysFromPfx, signXml, type CertificateKeys } from "../nfse/sign";
import { simulatedTransport, type SimulatedPrestador } from "../nfse/simulator";
import { platformEnv } from "../env";
import { logError } from "../log";
import type { DbClient } from "./clients";
import { DataError, fromDbError, unwrap } from "./errors";
import { FISCAL_MUNICIPALITIES, getFiscalCertificate, getFiscalSettings } from "./fiscal";
import { platformNfseRecorder, readFiscalCertificate, readFiscalPrestador } from "./platform";

// Nota fiscal do pagamento (F11.4, cliente, 12/out/2026). O banco confere e
// reserva (begin_*), o servidor assina e conversa com a Receita, e o banco
// grava o resultado e a trilha (finish_*). Sem resposta, a nota fica
// "emitindo" (ou "cancelando") e só se repete depois de consultar a Receita:
// pelo botão "Conferir na Receita" ou pela rotina diária.

export type InvoiceStatus = "issuing" | "issued" | "rejected" | "canceling" | "canceled";

export type Invoice = {
  id: string;
  paymentId: string;
  environment: NfseEnvironment;
  dpsNumber: number;
  status: InvoiceStatus;
  accessKey: string | null;
  nfseNumber: string | null;
  hasXml: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  requestedAt: Date;
  issuedAt: Date | null;
  canceledAt: Date | null;
  cancelReasonCode: number | null;
};

export const ACTIVE_INVOICE: InvoiceStatus[] = ["issuing", "issued", "canceling"];

export const CANCEL_REASONS = [
  { code: 1, label: "Erro na emissão (CPF, valor ou dado errado)" },
  { code: 2, label: "Serviço não prestado" },
  { code: 9, label: "Outros" },
] as const;

/** Quem fala com a Receita e de onde vem o certificado (trocados nos testes). */
export type NfseDeps = {
  transport: SefinTransport;
  loadCertificate: (clinicId: string) => Promise<{ pfx: Uint8Array; password: string } | null>;
  now: () => Date;
  /** O ambiente "Simulação" vale aqui? (F11.4b: só com NFSE_SIMULATION=1, no staging) */
  simulationEnabled?: () => boolean;
  /** Razão social, município e ISS da clínica, para a nota simulada. */
  loadPrestador?: (clinicId: string) => Promise<{ legalName: string; municipalityIbge: string; issRate: number } | null>;
};

export const defaultNfseDeps: NfseDeps = {
  transport: httpsTransport,
  loadCertificate: (clinicId) => readFiscalCertificate(clinicId),
  now: () => new Date(),
  simulationEnabled: () => platformEnv().nfseSimulation,
  loadPrestador: (clinicId) => readFiscalPrestador(clinicId),
};

export const SIMULATION_OFF = "A simulação da nota fiscal só funciona no staging: peça ao Suporte para voltar a clínica para Produção Restrita.";

/** Quem responde no lugar da Receita: a Sefin de verdade ou, na simulação, o próprio servidor. */
function transportFor(deps: NfseDeps, environment: NfseEnvironment, timeZone: string, prestador: SimulatedPrestador | null = null): SefinTransport {
  return environment === "simulation" ? simulatedTransport(prestador, deps.now, timeZone) : deps.transport;
}

/** Os dados do prestador que a Receita tiraria do cadastro dela (só a simulação precisa). */
async function simulatedPrestador(deps: NfseDeps, clinicId: string): Promise<SimulatedPrestador | null> {
  const settings = await (deps.loadPrestador ?? readFiscalPrestador)(clinicId);
  if (!settings) return null;
  const municipality = FISCAL_MUNICIPALITIES.find((m) => m.ibge === settings.municipalityIbge);
  return { legalName: settings.legalName, municipalityName: municipality?.name ?? settings.municipalityIbge, uf: municipality?.state ?? "", issRate: settings.issRate };
}

/** Onde o resultado é gravado: com o login de quem usa o painel ou pela plataforma (rotina). */
type Recorder = ReturnType<typeof platformNfseRecorder>;

function userRecorder(db: DbClient): Recorder {
  return {
    async finishIssue(args) {
      const { error } = await db.rpc("finish_nfse_issue", {
        p_invoice_id: args.invoiceId,
        p_outcome: args.outcome,
        p_access_key: args.accessKey,
        p_nfse_number: args.nfseNumber ?? undefined,
        p_xml_path: args.xmlPath ?? undefined,
        p_error_code: args.errorCode,
        p_error_message: args.errorMessage,
      });
      if (error) throw fromDbError(error, "Nota fiscal");
    },
    async finishCancel(args) {
      const { error } = await db.rpc("finish_nfse_cancel", {
        p_invoice_id: args.invoiceId,
        p_outcome: args.outcome,
        p_error_code: args.errorCode,
        p_error_message: args.errorMessage,
      });
      if (error) throw fromDbError(error, "Nota fiscal");
    },
    async uploadXml(path, xml) {
      const { error } = await db.storage.from("nfse-xml").upload(path, new Blob([xml], { type: "application/xml" }), { contentType: "application/xml", upsert: false });
      if (error) throw fromDbError(error, "XML da nota");
    },
  };
}

type InvoiceRow = {
  id: string;
  payment_id: string;
  environment: string;
  dps_number: number;
  status: string;
  access_key: string | null;
  nfse_number: string | null;
  xml_path: string | null;
  error_code: string | null;
  error_message: string | null;
  requested_at: string;
  issued_at: string | null;
  canceled_at: string | null;
  cancel_reason_code: number | null;
};

const INVOICE_COLUMNS =
  "id, payment_id, environment, dps_number, status, access_key, nfse_number, xml_path, error_code, error_message, requested_at, issued_at, canceled_at, cancel_reason_code";

const toInvoice = (row: InvoiceRow): Invoice => ({
  id: row.id,
  paymentId: row.payment_id,
  environment: row.environment as NfseEnvironment,
  dpsNumber: row.dps_number,
  status: row.status as InvoiceStatus,
  accessKey: row.access_key,
  nfseNumber: row.nfse_number,
  hasXml: row.xml_path !== null,
  errorCode: row.error_code,
  errorMessage: row.error_message,
  requestedAt: new Date(row.requested_at),
  issuedAt: row.issued_at ? new Date(row.issued_at) : null,
  canceledAt: row.canceled_at ? new Date(row.canceled_at) : null,
  cancelReasonCode: row.cancel_reason_code,
});

/** Notas dos pagamentos (a mais nova primeiro em cada um). */
export async function listPaymentInvoices(db: DbClient, clinicId: string, paymentIds: string[]): Promise<Map<string, Invoice[]>> {
  const map = new Map<string, Invoice[]>();
  if (!paymentIds.length) return map;
  const rows = unwrap(
    await db.from("nfse_invoices").select(INVOICE_COLUMNS).eq("clinic_id", clinicId).in("payment_id", paymentIds).order("requested_at", { ascending: false }),
    "Notas fiscais",
  ) as InvoiceRow[];
  for (const row of rows) map.set(row.payment_id, [...(map.get(row.payment_id) ?? []), toInvoice(row)]);
  return map;
}

export async function getInvoice(db: DbClient, clinicId: string, invoiceId: string): Promise<(Invoice & { dpsId: string }) | null> {
  const row = unwrap(
    await db.from("nfse_invoices").select(`${INVOICE_COLUMNS}, dps_id`).eq("clinic_id", clinicId).eq("id", invoiceId).maybeSingle(),
    "Nota fiscal",
  ) as (InvoiceRow & { dps_id: string }) | null;
  return row ? { ...toInvoice(row), dpsId: row.dps_id } : null;
}

/** A clínica já pode emitir? (dados fiscais e certificado em dia) */
export async function nfseReadiness(db: DbClient, clinicId: string, now: Date = new Date()): Promise<{ ready: boolean; environment: NfseEnvironment | null; reason: string | null }> {
  const [settings, certificate] = await Promise.all([getFiscalSettings(db, clinicId), getFiscalCertificate(db, clinicId)]);
  if (!settings) return { ready: false, environment: null, reason: "Faltam os dados fiscais da clínica (Configurações › Nota fiscal)." };
  if (!certificate) return { ready: false, environment: settings.environment, reason: "Falta o certificado digital A1 (Configurações › Nota fiscal)." };
  if (certificate.validUntil <= now) return { ready: false, environment: settings.environment, reason: "O certificado digital A1 venceu." };
  return { ready: true, environment: settings.environment, reason: null };
}

async function certificateKeys(deps: NfseDeps, clinicId: string): Promise<CertificateKeys | null> {
  const secret = await deps.loadCertificate(clinicId);
  if (!secret) return null;
  try {
    return keysFromPfx(secret.pfx, secret.password);
  } catch {
    return null;
  }
}

type BeginIssue = {
  invoice_id: string;
  environment: NfseEnvironment;
  series: string;
  dps_number: number;
  dps_id: string;
  competence: string;
  amount_cents: number;
  payer_cpf: string;
  payer_name: string;
  patient_name: string;
  appointment_date: string;
  category: DpsInput["category"];
  timezone: string;
  cnpj: string;
  municipal_registration: string | null;
  municipality_ibge: string;
  simples_nacional: DpsInput["simplesNacional"];
  simples_regime: DpsInput["simplesRegime"];
  simples_total_rate: number | null;
  special_regime: DpsInput["specialRegime"];
  service_code: string;
  iss_rate: number;
};

export type NfseResult = { status: InvoiceStatus; message: string };

const xmlPathOf = (clinicId: string, invoiceId: string) => `${clinicId}/${invoiceId}.xml`;

/** Emite a nota do pagamento: reserva, assina, envia e grava o resultado. */
export async function issueNfse(db: DbClient, clinicId: string, paymentId: string, deps: NfseDeps = defaultNfseDeps): Promise<NfseResult> {
  const { data, error } = await db.rpc("begin_nfse_issue", { p_payment_id: paymentId });
  if (error) throw fromDbError(error, "Nota fiscal");
  const begin = data as unknown as BeginIssue;
  const recorder = userRecorder(db);
  const invoiceId = begin.invoice_id;

  if (begin.environment === "simulation" && !deps.simulationEnabled?.()) {
    await recorder.finishIssue({ invoiceId, outcome: "rejected", errorCode: "SIMULACAO", errorMessage: SIMULATION_OFF });
    return { status: "rejected", message: SIMULATION_OFF };
  }

  const keys = await certificateKeys(deps, clinicId);
  if (!keys) {
    await recorder.finishIssue({ invoiceId, outcome: "rejected", errorCode: "CERTIFICADO", errorMessage: "Não foi possível abrir o certificado A1: envie o certificado de novo." });
    return { status: "rejected", message: "Não foi possível abrir o certificado A1: envie o certificado de novo em Configurações › Nota fiscal." };
  }
  const input: DpsInput = {
    environment: begin.environment,
    series: begin.series,
    dpsNumber: Number(begin.dps_number),
    dpsId: begin.dps_id,
    competence: begin.competence,
    amountCents: begin.amount_cents,
    payerCpf: begin.payer_cpf,
    payerName: begin.payer_name,
    patientName: begin.patient_name,
    appointmentDate: begin.appointment_date,
    category: begin.category,
    cnpj: begin.cnpj,
    municipalRegistration: begin.municipal_registration,
    municipalityIbge: begin.municipality_ibge,
    simplesNacional: begin.simples_nacional,
    simplesRegime: begin.simples_regime,
    simplesTotalRate: begin.simples_total_rate === null ? null : Number(begin.simples_total_rate),
    specialRegime: begin.special_regime,
    serviceCode: begin.service_code,
    issRate: Number(begin.iss_rate),
  };
  const signed = signXml(buildDps(input, deps.now(), begin.timezone), "infDPS", "DPS", keys);
  const transport = transportFor(deps, begin.environment, begin.timezone, begin.environment === "simulation" ? await simulatedPrestador(deps, clinicId) : null);
  const outcome = await sendDps(transport, begin.environment, keys, signed);
  return recordIssueOutcome(recorder, clinicId, invoiceId, outcome.kind === "issued" ? { kind: "found", accessKey: outcome.accessKey, nfseXml: outcome.nfseXml } : outcome);
}

type IssueResult =
  | { kind: "found"; accessKey: string; nfseXml: string | null }
  | { kind: "rejected"; errors: { code: string; message: string }[] }
  | { kind: "not_found" }
  | { kind: "unknown"; message: string };

async function recordIssueOutcome(recorder: Recorder, clinicId: string, invoiceId: string, outcome: IssueResult): Promise<NfseResult> {
  if (outcome.kind === "found") {
    let xmlPath: string | null = null;
    if (outcome.nfseXml) {
      try {
        await recorder.uploadXml(xmlPathOf(clinicId, invoiceId), outcome.nfseXml);
        xmlPath = xmlPathOf(clinicId, invoiceId);
      } catch (error) {
        // A nota existe na Receita: grava assim mesmo; o XML pode ser buscado depois.
        logError("nota fiscal: XML não guardado", error, { clinica: clinicId, nota: invoiceId });
      }
    }
    const nfseNumber = outcome.nfseXml ? nfseNumberOf(outcome.nfseXml) : null;
    await recorder.finishIssue({ invoiceId, outcome: "issued", accessKey: outcome.accessKey, nfseNumber, xmlPath });
    return { status: "issued", message: nfseNumber ? `Nota fiscal nº ${nfseNumber} emitida.` : "Nota fiscal emitida." };
  }
  if (outcome.kind === "rejected") {
    const message = describeSefinErrors(outcome.errors);
    await recorder.finishIssue({ invoiceId, outcome: "rejected", errorCode: outcome.errors.map((e) => e.code).join(","), errorMessage: message });
    return { status: "rejected", message: `A Receita recusou a nota: ${message}` };
  }
  if (outcome.kind === "not_found") {
    const message = "A Receita não gerou nota para este pedido. Pode emitir de novo.";
    await recorder.finishIssue({ invoiceId, outcome: "rejected", errorCode: "SEM-NOTA", errorMessage: message });
    return { status: "rejected", message };
  }
  await recorder.finishIssue({ invoiceId, outcome: "pending", errorCode: "SEM-RESPOSTA", errorMessage: outcome.message });
  return { status: "issuing", message: "A Receita não respondeu. A nota fica \"emitindo\": confira na Receita daqui a pouco (o sistema também confere sozinho, uma vez por dia)." };
}

/** Confere na Receita uma nota "emitindo" ou "cancelando" (resposta perdida). */
export async function checkNfse(db: DbClient, clinicId: string, invoiceId: string, deps: NfseDeps = defaultNfseDeps): Promise<NfseResult> {
  const invoice = await getInvoice(db, clinicId, invoiceId);
  if (!invoice) throw new DataError("not_found", "Nota fiscal: não encontrada");
  return checkPending(userRecorder(db), deps, { clinicId, invoiceId, status: invoice.status, environment: invoice.environment, dpsId: invoice.dpsId, accessKey: invoice.accessKey });
}

/** A rotina diária: confere as pendentes de todas as clínicas, pela plataforma. */
export async function checkPendingAsPlatform(
  pending: { invoiceId: string; clinicId: string; status: string; environment: NfseEnvironment; dpsId: string; accessKey: string | null },
  deps: NfseDeps = defaultNfseDeps,
): Promise<NfseResult> {
  return checkPending(platformNfseRecorder(), deps, pending);
}

async function checkPending(
  recorder: Recorder,
  deps: NfseDeps,
  invoice: { clinicId: string; invoiceId: string; status: string; environment: NfseEnvironment; dpsId: string; accessKey: string | null },
): Promise<NfseResult> {
  if (invoice.status !== "issuing" && invoice.status !== "canceling") throw new DataError("invalid", "Nota fiscal: não está pendente");
  const keys = await certificateKeys(deps, invoice.clinicId);
  if (!keys) throw new DataError("invalid", "Nota fiscal: sem certificado A1 em dia para consultar a Receita");
  if (invoice.environment === "simulation" && !deps.simulationEnabled?.()) throw new DataError("invalid", `Nota fiscal: ${SIMULATION_OFF}`);
  const transport = transportFor(deps, invoice.environment, "America/Sao_Paulo");
  if (invoice.status === "issuing") {
    return recordIssueOutcome(recorder, invoice.clinicId, invoice.invoiceId, await findNfseByDps(transport, invoice.environment, keys, invoice.dpsId));
  }
  const canceled = await hasCancelEvent(transport, invoice.environment, keys, invoice.accessKey!);
  if (canceled === true) {
    await recorder.finishCancel({ invoiceId: invoice.invoiceId, outcome: "canceled" });
    return { status: "canceled", message: "Nota cancelada na Receita." };
  }
  if (canceled === false) {
    const message = "O cancelamento não chegou à Receita: a nota continua emitida. Pode pedir de novo.";
    await recorder.finishCancel({ invoiceId: invoice.invoiceId, outcome: "rejected", errorCode: "SEM-EVENTO", errorMessage: message });
    return { status: "issued", message };
  }
  await recorder.finishCancel({ invoiceId: invoice.invoiceId, outcome: "pending", errorCode: "SEM-RESPOSTA", errorMessage: "Receita sem resposta na consulta" });
  return { status: "canceling", message: "A Receita não respondeu. Tente conferir de novo daqui a pouco." };
}

type BeginCancel = { invoice_id: string; environment: NfseEnvironment; access_key: string; cnpj: string; reason_code: 1 | 2 | 9; reason_text: string };

/** Cancela a nota (só o Administrador; o banco confere). */
export async function cancelNfse(
  db: DbClient,
  clinicId: string,
  invoiceId: string,
  reason: { code: number; text: string },
  timeZone: string,
  deps: NfseDeps = defaultNfseDeps,
): Promise<NfseResult> {
  const { data, error } = await db.rpc("begin_nfse_cancel", { p_invoice_id: invoiceId, p_reason_code: reason.code, p_reason_text: reason.text });
  if (error) throw fromDbError(error, "Cancelamento");
  const begin = data as unknown as BeginCancel;
  const recorder = userRecorder(db);
  if (begin.environment === "simulation" && !deps.simulationEnabled?.()) {
    await recorder.finishCancel({ invoiceId, outcome: "rejected", errorCode: "SIMULACAO", errorMessage: SIMULATION_OFF });
    return { status: "issued", message: SIMULATION_OFF };
  }
  const keys = await certificateKeys(deps, clinicId);
  if (!keys) {
    await recorder.finishCancel({ invoiceId, outcome: "rejected", errorCode: "CERTIFICADO", errorMessage: "Não foi possível abrir o certificado A1." });
    return { status: "issued", message: "Não foi possível abrir o certificado A1: envie o certificado de novo e tente cancelar outra vez." };
  }
  const signed = signXml(
    buildCancelRequest({ environment: begin.environment, accessKey: begin.access_key, cnpj: begin.cnpj, reasonCode: begin.reason_code, reasonText: begin.reason_text }, deps.now(), timeZone),
    "infPedReg",
    "pedRegEvento",
    keys,
  );
  const outcome = await sendCancel(transportFor(deps, begin.environment, timeZone), begin.environment, keys, begin.access_key, signed);
  if (outcome.kind === "canceled") {
    await recorder.finishCancel({ invoiceId, outcome: "canceled" });
    return { status: "canceled", message: "Nota fiscal cancelada." };
  }
  if (outcome.kind === "rejected") {
    const message = describeSefinErrors(outcome.errors);
    await recorder.finishCancel({ invoiceId, outcome: "rejected", errorCode: outcome.errors.map((e) => e.code).join(","), errorMessage: message });
    return { status: "issued", message: `A Receita recusou o cancelamento: ${message}` };
  }
  await recorder.finishCancel({ invoiceId, outcome: "pending", errorCode: "SEM-RESPOSTA", errorMessage: outcome.message });
  return { status: "canceling", message: "A Receita não respondeu. A nota fica \"cancelando\": confira na Receita daqui a pouco." };
}

/** Link temporário (2 minutos) para baixar o XML da nota. */
export async function invoiceXmlUrl(db: DbClient, clinicId: string, invoiceId: string): Promise<string> {
  const invoice = unwrap(
    await db.from("nfse_invoices").select("xml_path, nfse_number").eq("clinic_id", clinicId).eq("id", invoiceId).maybeSingle(),
    "Nota fiscal",
  ) as { xml_path: string | null; nfse_number: string | null } | null;
  if (!invoice?.xml_path) throw new DataError("not_found", "Nota fiscal: XML não guardado");
  const { data, error } = await db.storage.from("nfse-xml").createSignedUrl(invoice.xml_path, 120, { download: `NFSe_${invoice.nfse_number ?? invoiceId}.xml` });
  if (error || !data) throw new DataError("unexpected", "XML da nota: link não gerado");
  return data.signedUrl;
}
