import type { AsaasBillingApi } from "../asaas/billingApi";
import { logError } from "../log";
import type { DbClient } from "./clients";
import { DataError, fromDbError, unwrap } from "./errors";
import type { FiscalChargeContext, PlatformFiscalBilling } from "./platform";

// Cobrança das notas por pagador (N4b; planejamento-nfse-asaas.md 14.2 e 14.7).
// No começo do mês, o banco apura o mês anterior: as notas pagas pela clínica
// somam na franquia do contrato dela (N-P3) e o excedente vira cobrança avulsa;
// o profissional pagador paga a taxa mensal + as notas acima da franquia do
// contrato dele (N-P4). Vence junto da mensalidade (cliente, 07/nov). A rotina
// cria as cobranças no Asaas (conta principal), confere a situação e suspende
// só a emissão do profissional com cobrança vencida há 15 dias (N-P5).

export const ISSUER_CONTRACT_TERMS_VERSION = "notas-profissional-2026-11-08";

export const ISSUER_CONTRACT_TERMS = [
  "Você contrata a emissão das notas fiscais do seu CNPJ pelo RecepClinic, com a conta do seu CNPJ no Asaas.",
  "Os serviços financeiros e de pagamentos usados na emissão (a conta no Asaas e as tarifas da nota) são prestados pelo ASAAS GESTÃO FINANCEIRA INSTITUIÇÃO DE PAGAMENTOS S.A.; o RecepClinic atua como plataforma de tecnologia que integra a emissão.",
  "Todo mês você paga a taxa mensal e o preço de cada nota acima da franquia, numa cobrança com vencimento junto da mensalidade da clínica.",
  "Com a cobrança vencida há 15 dias ou mais, a emissão pelo seu CNPJ fica suspensa até o pagamento; os pagamentos dos atendimentos continuam registrados.",
];

export type IssuerContract = {
  issuerId: string;
  monthlyFeeCents: number;
  unitPriceCents: number;
  monthlyAllowance: number;
  status: "draft" | "active";
  acceptedAt: Date | null;
};

export type UsageCharge = {
  id: string;
  issuerId: string | null;
  period: string;
  notesCount: number;
  allowance: number;
  unitPriceCents: number;
  feeCents: number;
  amountCents: number;
  dueDate: string;
  status: string;
  invoiceUrl: string | null;
  paidAt: Date | null;
};

export const CHARGE_STATUS_LABEL: Record<string, string> = {
  creating: "Gerando a cobrança",
  manual: "Cobrança por fora",
  none: "Nada a cobrar",
  pending: "Em aberto",
  paid: "Paga",
  overdue: "Vencida",
  refunded: "Estornada",
  canceled: "Cancelada",
  other: "Em análise",
};

export async function getIssuerContract(db: DbClient, issuerId: string): Promise<IssuerContract | null> {
  const row = unwrap(
    await db.from("fiscal_issuer_contracts").select("issuer_id, monthly_fee_cents, unit_price_cents, monthly_allowance, status, accepted_at").eq("issuer_id", issuerId).maybeSingle(),
    "Contrato de notas",
  ) as { issuer_id: string; monthly_fee_cents: number; unit_price_cents: number; monthly_allowance: number; status: string; accepted_at: string | null } | null;
  return row
    ? {
        issuerId: row.issuer_id,
        monthlyFeeCents: row.monthly_fee_cents,
        unitPriceCents: row.unit_price_cents,
        monthlyAllowance: row.monthly_allowance,
        status: row.status as IssuerContract["status"],
        acceptedAt: row.accepted_at ? new Date(row.accepted_at) : null,
      }
    : null;
}

/** Suporte: valores do contrato de notas do profissional (mudou, ele aceita de novo). */
export async function saveIssuerContract(db: DbClient, issuerId: string, input: { feeCents: number; unitPriceCents: number; allowance: number }): Promise<void> {
  const fields: Record<string, string> = {};
  if (!Number.isInteger(input.feeCents) || input.feeCents < 0) fields.fee = "Taxa mensal: valor em reais (ex.: 15,00).";
  if (!Number.isInteger(input.unitPriceCents) || input.unitPriceCents < 0) fields.unit_price = "Preço por nota: valor em reais (ex.: 0,99).";
  if (!Number.isInteger(input.allowance) || input.allowance < 0) fields.allowance = "Franquia: número de notas (0 ou mais).";
  if (Object.keys(fields).length) throw new DataError("invalid", `Contrato de notas: ${Object.values(fields).join("; ")}`, fields);
  const { error } = await db.rpc("save_fiscal_issuer_contract", { p_issuer_id: issuerId, p_fee_cents: input.feeCents, p_unit_price_cents: input.unitPriceCents, p_allowance: input.allowance });
  if (error) throw fromDbError(error, "Contrato de notas");
}

/** O próprio profissional aceita (N-P6: com login). */
export async function acceptIssuerContract(db: DbClient, issuerId: string, accepted: boolean): Promise<void> {
  if (!accepted) throw new DataError("invalid", "Leia e marque o aceite do contrato de notas.", { aceite: "Marque para aceitar." });
  const { error } = await db.rpc("accept_fiscal_issuer_contract", { p_issuer_id: issuerId, p_terms_version: ISSUER_CONTRACT_TERMS_VERSION });
  if (error) throw fromDbError(error, "Contrato de notas");
}

const CHARGE_COLUMNS = "id, issuer_id, period, notes_count, allowance, unit_price_cents, fee_cents, amount_cents, due_date, status, invoice_url, paid_at";

type ChargeRow = {
  id: string;
  issuer_id: string | null;
  period: string;
  notes_count: number;
  allowance: number;
  unit_price_cents: number;
  fee_cents: number;
  amount_cents: number;
  due_date: string;
  status: string;
  invoice_url: string | null;
  paid_at: string | null;
};

const toCharge = (r: ChargeRow): UsageCharge => ({
  id: r.id,
  issuerId: r.issuer_id,
  period: r.period,
  notesCount: r.notes_count,
  allowance: r.allowance,
  unitPriceCents: r.unit_price_cents,
  feeCents: r.fee_cents,
  amountCents: r.amount_cents,
  dueDate: r.due_date,
  status: r.status,
  invoiceUrl: r.invoice_url,
  paidAt: r.paid_at ? new Date(r.paid_at) : null,
});

/** Cobranças das notas: de um emissor (profissional) ou as da clínica (issuerId null). */
export async function listUsageCharges(db: DbClient, clinicId: string, issuerId: string | null, limit = 12): Promise<UsageCharge[]> {
  const q = db.from("fiscal_usage_charges").select(CHARGE_COLUMNS).eq("clinic_id", clinicId);
  const rows = unwrap(await (issuerId ? q.eq("issuer_id", issuerId) : q.is("issuer_id", null)).order("period", { ascending: false }).limit(limit), "Cobranças das notas") as ChargeRow[];
  return rows.map(toCharge);
}

/** Notas emitidas no mês (contam as canceladas depois; recusadas não), por emissor. */
export async function countNotesThisMonth(db: DbClient, clinicId: string, from: Date): Promise<Map<string, number>> {
  const rows = unwrap(
    await db.from("nfse_invoices").select("issuer_id").eq("clinic_id", clinicId).eq("provider", "asaas").in("status", ["issued", "canceling", "canceled"]).gte("issued_at", from.toISOString()),
    "Notas do mês",
  ) as { issuer_id: string | null }[];
  const map = new Map<string, number>();
  for (const r of rows) if (r.issuer_id) map.set(r.issuer_id, (map.get(r.issuer_id) ?? 0) + 1);
  return map;
}

// ---------------------------------------------------------------------------
// Rotina
// ---------------------------------------------------------------------------

export type FiscalBillingDeps = { store: PlatformFiscalBilling; api: AsaasBillingApi | null };

const monthLabel = (period: string) => `${period.slice(5, 7)}/${period.slice(0, 4)}`;

/** Primeiro dia do mês anterior a `today` (AAAA-MM-DD). */
export function previousPeriod(today: string): string {
  const [y, m] = today.split("-").map(Number);
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  return `${prev.y}-${String(prev.m).padStart(2, "0")}-01`;
}

export function chargeDescription(c: Pick<FiscalChargeContext, "issuerId" | "period" | "notesCount" | "feeCents">): string {
  const notes = `${c.notesCount} ${c.notesCount === 1 ? "nota fiscal emitida" : "notas fiscais emitidas"} em ${monthLabel(c.period)}`;
  return c.issuerId
    ? `RecepClinic: emissão de notas fiscais (${notes}; taxa mensal e notas acima da franquia). Notas emitidas pelo Asaas.`
    : `RecepClinic: notas fiscais acima da franquia (${notes}). Notas emitidas pelo Asaas.`;
}

async function createInAsaas(deps: FiscalBillingDeps, c: FiscalChargeContext): Promise<void> {
  const api = deps.api!;
  let customer: string | null;
  let billingType: "PIX" | "CREDIT_CARD" = "PIX";
  if (c.clinic) {
    customer = c.clinic.customerId;
    if (c.clinic.paymentMethod === "credit_card") billingType = "CREDIT_CARD";
    if (!customer) throw new Error("Clínica sem cliente no Asaas (contrato sem cobrança automática ainda aceita)");
  } else if (c.professional) {
    customer = c.professional.customerId ?? (await api.findCustomer(c.professional.cnpj));
    if (!customer) {
      customer = await api.createCustomer({
        name: c.professional.legalName,
        cpfCnpj: c.professional.cnpj,
        email: c.professional.email,
        mobilePhone: c.professional.mobilePhone,
        externalReference: `emissor:${c.issuerId}`,
        address: { postalCode: c.professional.postalCode, street: c.professional.street, number: c.professional.number, complement: c.professional.complement, district: c.professional.district },
      });
    }
    if (!c.professional.customerId) await deps.store.setContractCustomer(c.issuerId!, customer);
  } else {
    throw new Error("Cobrança sem pagador");
  }
  const reference = `notas:${c.id}`;
  const payment =
    (await api.findPayment(reference)) ??
    (await api.createPayment({ customer, billingType, valueCents: c.amountCents, dueDate: c.dueDate, description: chargeDescription(c), externalReference: reference }));
  await deps.store.setCharge(c.id, { asaasPaymentId: payment.id, rawStatus: payment.deleted ? "DELETED" : payment.status, invoiceUrl: payment.invoiceUrl, paidAt: payment.paidAt });
}

/** A rotina (notas-fiscais): apura no começo do mês, cria, confere e suspende. */
export async function runFiscalBilling(today: string, deps: FiscalBillingDeps, now: Date = new Date()): Promise<{ created: number; synced: number; failed: number; suspensions: number }> {
  let created = 0;
  let synced = 0;
  let failed = 0;
  // Janela da apuração: os 5 primeiros dias do mês (repetir não duplica).
  if (Number(today.slice(8, 10)) <= 5) created = await deps.store.computeUsage(previousPeriod(today), today);
  if (deps.api) {
    for (const c of await deps.store.openCharges(new Date(now.getTime() - 6 * 3_600_000))) {
      try {
        if (c.status === "creating") await createInAsaas(deps, c);
        else if (c.asaasPaymentId) {
          const p = await deps.api.getPayment(c.asaasPaymentId);
          await deps.store.setCharge(c.id, { rawStatus: p.deleted ? "DELETED" : p.status, invoiceUrl: p.invoiceUrl, paidAt: p.paidAt });
        }
        synced++;
      } catch (error) {
        failed++;
        logError("cobrança das notas", error, { cobranca: c.id });
        await deps.store.setCharge(c.id, { error: error instanceof Error ? error.message : "falha" }).catch(() => undefined);
      }
    }
  }
  const suspensions = await deps.store.applySuspensions(today);
  return { created, synced, failed, suspensions };
}
