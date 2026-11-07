import { asaasBillingApi } from "../asaas/billingApi";
import { formatCalendarDate, todayIn } from "../clinicTime";
import { billingPaymentMethodEmail, smtpSender } from "../email";
import { platformEnv } from "../env";
import { logError } from "../log";
import { syncContractWithAsaas, type SyncResult } from "./billingAsaas";
import { applyCancellationInAsaas, type CancelSyncResult } from "./billingCancel";
import { finishCardChange, startCardChange, type CardChangeFinish } from "./billingCardChange";
import { confirmCardRegistration, startCardRegistration, type CardRegisterStart, type CardRegisterStatus } from "./billingCardRegister";
import { switchToPix, type PixSwitchResult } from "./billingPaymentMethod";
import { platformBillingCancelStore, platformBillingCardChangeStore, platformBillingCardRegisterStore, platformBillingPaymentMethodStore, platformBillingStore } from "./platform";

// Liga a sincronização com o Asaas (F12.4) às variáveis do ambiente: a conta
// do RecepClinic (ASAAS_API_KEY e ASAAS_BASE_URL) e a service role. Data de
// Brasília (decisão 11.13). Falha vai também para Sistema › Erros.
export async function syncContractNow(contractId: string): Promise<SyncResult> {
  const env = platformEnv();
  const result = await syncContractWithAsaas(platformBillingStore(env), env.asaas ? asaasBillingApi(env.asaas) : null, contractId, todayIn("America/Sao_Paulo"));
  if (result.status === "failed") logError("faturamento: Asaas", new Error(result.reason), { contrato: contractId });
  return result;
}

/** F12.2f: depois do cancelamento, ajusta o Asaas (assinatura, cobranças, estorno). */
export async function applyCancellationNow(contractId: string): Promise<CancelSyncResult> {
  const env = platformEnv();
  const result = await applyCancellationInAsaas(platformBillingCancelStore(env), env.asaas ? asaasBillingApi(env.asaas) : null, contractId);
  if (result.status === "failed") logError("faturamento: cancelamento no Asaas", new Error(result.reason), { contrato: contractId });
  return result;
}

/** F12.2g: abre o Checkout do Asaas para o Administrador informar outro cartão; devolve o link. */
export async function startCardChangeNow(contractId: string, input: { actorId: string | null; successUrl: string; cancelUrl: string }): Promise<string> {
  const env = platformEnv();
  const started = await startCardChange(platformBillingCardChangeStore(env), env.asaas ? asaasBillingApi(env.asaas) : null, contractId, {
    ...input,
    today: todayIn("America/Sao_Paulo"),
  });
  return started.link;
}

/** F12.2g: conclui a troca (assinatura nova no contrato) e atualiza as cobranças. Pix → cartão: a forma vira cartão. */
export async function finishCardChangeNow(contractId: string): Promise<CardChangeFinish> {
  const env = platformEnv();
  const api = env.asaas ? asaasBillingApi(env.asaas) : null;
  const store = platformBillingCardChangeStore(env);
  const wasPix = (await store.loadCardChange(contractId)) ? (await store.load(contractId))?.contract.paymentMethod === "pix" : false;
  const result = await finishCardChange(store, api, contractId);
  if (result.status === "changed") {
    await syncContractNow(contractId);
    // F12.2i: o final do cartão novo.
    const subscription = (await platformBillingStore(env).load(contractId))?.contract.subscriptionId ?? null;
    const card = api && subscription ? await api.getSubscriptionCard(subscription).catch(() => null) : null;
    if (card) await platformBillingCardRegisterStore(env).recordCardRegistered(contractId, card.last4, "checkout");
    if (wasPix) await sendPaymentMethodEmail(contractId, "credit_card", "pelo Administrador da clínica", null, card?.last4 ?? null);
  }
  if (result.status === "failed") logError("faturamento: troca de cartão", new Error(result.reason), { contrato: contractId });
  return result;
}

/** F12.2i: passo Cartão; a página do Asaas onde a clínica informa o cartão. */
export async function startCardRegistrationNow(contractId: string, input: { actorId: string | null; successUrl: string; cancelUrl: string }): Promise<CardRegisterStart> {
  const env = platformEnv();
  return startCardRegistration(platformBillingCardRegisterStore(env), env.asaas ? asaasBillingApi(env.asaas) : null, contractId, {
    ...input,
    today: todayIn("America/Sao_Paulo"),
  });
}

/** F12.2i: confere o cartão no Asaas e o liga à assinatura; atualiza as cobranças. */
export async function confirmCardRegistrationNow(contractId: string, remoteIp: string | null): Promise<CardRegisterStatus> {
  const env = platformEnv();
  const result = await confirmCardRegistration(platformBillingCardRegisterStore(env), env.asaas ? asaasBillingApi(env.asaas) : null, contractId, remoteIp);
  if (result.status === "registered") await syncContractNow(contractId);
  if (result.status === "failed") logError("faturamento: cartão da assinatura", new Error(result.reason), { contrato: contractId });
  return result;
}

/** Troca cartão → Pix (cliente, 07/nov/2026): Asaas, contrato e o e-mail de confirmação (a falha do e-mail não desfaz). */
export async function switchToPixNow(contractId: string, input: { actorId: string | null; actorKind: "clinic" | "support"; changedBy: string }): Promise<PixSwitchResult> {
  const env = platformEnv();
  const result = await switchToPix(platformBillingPaymentMethodStore(env), env.asaas ? asaasBillingApi(env.asaas) : null, contractId, {
    actorId: input.actorId,
    actorKind: input.actorKind,
    today: todayIn("America/Sao_Paulo"),
  });
  if (result.status === "changed") await sendPaymentMethodEmail(contractId, "pix", input.changedBy, result.nextDue, null);
  return result;
}

/** Pix → cartão (cliente, 07/nov/2026): o Checkout da troca de cartão; devolve o link. */
export async function startSwitchToCardNow(contractId: string, input: { actorId: string | null; successUrl: string; cancelUrl: string }): Promise<string> {
  const env = platformEnv();
  const started = await startCardChange(platformBillingCardChangeStore(env), env.asaas ? asaasBillingApi(env.asaas) : null, contractId, {
    ...input,
    today: todayIn("America/Sao_Paulo"),
    purpose: "switch",
  });
  return started.link;
}

async function sendPaymentMethodEmail(contractId: string, method: "pix" | "credit_card", changedBy: string, fromDue: string | null, cardLast4: string | null) {
  const env = platformEnv();
  try {
    const snapshot = await platformBillingStore(env).load(contractId);
    if (!snapshot?.account) return;
    const today = todayIn("America/Sao_Paulo");
    await smtpSender(env.email)(
      billingPaymentMethodEmail(snapshot.account.financeEmail, {
        clinicName: snapshot.clinicName,
        method,
        changedOn: formatCalendarDate(today, "dd/MM/yyyy"),
        changedBy,
        fromDue: fromDue ? formatCalendarDate(fromDue, "dd/MM/yyyy") : null,
        cardLast4,
        panelLink: new URL("/admin/configuracoes/assinatura", env.siteUrl ?? "https://app.recepclinic.com.br").toString(),
      }),
    );
  } catch (error) {
    logError("faturamento: e-mail da troca da forma de pagamento", error, { contrato: contractId });
  }
}
