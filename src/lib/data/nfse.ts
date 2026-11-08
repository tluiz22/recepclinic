import type { DbClient } from "./clients";
import { DataError, unwrap } from "./errors";

// Notas fiscais do pagamento: leitura (lista, uma nota, link do XML). Desde a
// N3b, a emissão e o cancelamento saem pelo Asaas (nfseAsaas.ts); o emissor
// antigo (DPS na Sefin, F11.4) foi removido na N5 e as notas dele ficam só para
// consulta (PDF gerado do XML guardado e envio pelo WhatsApp).

export type InvoiceStatus = "issuing" | "issued" | "rejected" | "canceling" | "canceled";

export type Invoice = {
  id: string;
  paymentId: string;
  /** restricted/production/simulation: notas antigas (Sefin); sandbox/production: Asaas. */
  environment: "restricted" | "production" | "simulation" | "sandbox";
  /** Só do emissor antigo (DPS na Sefin). */
  dpsNumber: number | null;
  /** sefin: emissor antigo (só consulta, desde a N5); asaas: pelo emissor do atendimento (N3b). */
  provider: "sefin" | "asaas";
  issuerId: string | null;
  /** PDF guardado no bucket (notas do Asaas, N4). */
  hasPdf: boolean;
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

type InvoiceRow = {
  id: string;
  payment_id: string;
  environment: string;
  dps_number: number | null;
  provider: string;
  issuer_id: string | null;
  pdf_path: string | null;
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
  "id, payment_id, environment, dps_number, provider, issuer_id, pdf_path, status, access_key, nfse_number, xml_path, error_code, error_message, requested_at, issued_at, canceled_at, cancel_reason_code";

const toInvoice = (row: InvoiceRow): Invoice => ({
  id: row.id,
  paymentId: row.payment_id,
  environment: row.environment as Invoice["environment"],
  dpsNumber: row.dps_number,
  provider: row.provider as Invoice["provider"],
  issuerId: row.issuer_id,
  hasPdf: row.pdf_path !== null,
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

export async function getInvoice(db: DbClient, clinicId: string, invoiceId: string): Promise<(Invoice & { dpsId: string | null }) | null> {
  const row = unwrap(
    await db.from("nfse_invoices").select(`${INVOICE_COLUMNS}, dps_id`).eq("clinic_id", clinicId).eq("id", invoiceId).maybeSingle(),
    "Nota fiscal",
  ) as (InvoiceRow & { dps_id: string | null }) | null;
  return row ? { ...toInvoice(row), dpsId: row.dps_id } : null;
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
