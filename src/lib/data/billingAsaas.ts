import type { AsaasBillingApi, AsaasBillingType, AsaasPayment } from "../asaas/billingApi";
import type { BillingStore } from "./platform";

// Cobrança da clínica no Asaas (F12.4, faturamento do SaaS; itens 28 e 29 da
// seção 11 do planejamento-faturamento-saas.md, cliente 02/nov/2026). No
// aceite do contrato (modo automático), cria o cliente (procura antes pelo
// CNPJ/CPF), a assinatura da mensalidade e a cobrança da implantação, que vence
// no dia do aceite, e copia as cobranças para o espelho local. Pode rodar de
// novo sem duplicar: cada passo procura antes pela referência externa no
// Asaas e grava o que achou. Erro fica no contrato e na trilha (o Suporte
// tenta de novo pela aba Faturamento).

export type SyncResult = { status: "synced" } | { status: "skipped"; reason: string } | { status: "failed"; reason: string };

const BILLING_TYPES: Record<string, AsaasBillingType> = { pix: "PIX", credit_card: "CREDIT_CARD" };

/** Celular no formato do Asaas (só os números, sem o +55); outro país, nenhum. */
export function asaasMobilePhone(e164: string | null): string | null {
  return e164?.startsWith("+55") ? e164.slice(3) : null;
}

/** 1º vencimento da assinatura: o do contrato, ou hoje se ele já passou (o Asaas não aceita data no passado). */
export function subscriptionStart(firstDueDate: string, today: string): string {
  return firstDueDate >= today ? firstDueDate : today;
}

const setupReference = (contractId: string) => `setup:${contractId}`;

export async function syncContractWithAsaas(store: BillingStore, api: AsaasBillingApi | null, contractId: string, today: string): Promise<SyncResult> {
  const snapshot = await store.load(contractId);
  if (!snapshot) return { status: "skipped", reason: "contrato não encontrado" };
  const { contract, account, clinicId, clinicName } = snapshot;
  if (contract.status !== "active") return { status: "skipped", reason: "contrato não está vigente" };
  if (contract.billingMode !== "asaas") return { status: "skipped", reason: "modo manual: o Suporte cobra por fora" };
  if (contract.acceptance === "pending") return { status: "skipped", reason: "falta o aceite do Administrador" };
  if (contract.replacedSubscriptionId && !contract.subscriptionId) {
    return { status: "skipped", reason: "mudança de versão no Asaas entra na próxima etapa" };
  }

  const fail = async (reason: string): Promise<SyncResult> => {
    await store.recordSync(contractId, reason);
    return { status: "failed", reason };
  };
  if (!api) return fail("Asaas não configurado neste ambiente (ASAAS_API_KEY e ASAAS_BASE_URL)");
  if (!account) return fail("sem conta de cobrança");
  const billingType = BILLING_TYPES[contract.paymentMethod ?? ""];
  if (!billingType) return fail("forma de pagamento ausente no contrato");

  try {
    let customer = account.customerId;
    if (!customer) {
      customer =
        (await api.findCustomer(account.payerDocument)) ??
        (await api.createCustomer({
          name: account.payerName,
          cpfCnpj: account.payerDocument,
          email: account.financeEmail,
          mobilePhone: asaasMobilePhone(account.financePhone),
          externalReference: clinicId,
        }));
      await store.linkCustomer(clinicId, customer);
    }

    let subscription = contract.subscriptionId;
    if (!subscription) {
      subscription =
        (await api.findSubscription(contract.id)) ??
        (await api.createSubscription({
          customer,
          billingType,
          valueCents: contract.monthlyCents,
          nextDueDate: subscriptionStart(contract.firstDueDate, today),
          description: `RecepClinic: mensalidade (${clinicName})`,
          externalReference: contract.id,
        }));
      await store.linkSubscription(contract.id, subscription);
    }

    const charges: { payment: AsaasPayment; kind: "monthly" | "setup" }[] = [];
    if (contract.setupCents > 0) {
      const setup =
        (await api.findPayment(setupReference(contract.id))) ??
        (await api.createPayment({
          customer,
          billingType,
          valueCents: contract.setupCents,
          dueDate: today,
          description: `RecepClinic: implantação (${clinicName})`,
          externalReference: setupReference(contract.id),
        }));
      charges.push({ payment: setup, kind: "setup" });
    }
    for (const payment of await api.listSubscriptionPayments(subscription)) charges.push({ payment, kind: "monthly" });

    for (const { payment, kind } of charges) {
      await store.upsertCharge({
        contractId: contract.id,
        paymentId: payment.id,
        kind,
        dueDate: payment.dueDate,
        valueCents: payment.valueCents,
        billingType: payment.billingType,
        rawStatus: payment.status,
        paidAt: payment.paidAt,
        invoiceUrl: payment.invoiceUrl,
      });
    }
    await store.recordSync(contract.id, null);
    return { status: "synced" };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
