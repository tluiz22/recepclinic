import { asaasBillingApi } from "../asaas/billingApi";
import { todayIn } from "../clinicTime";
import { platformEnv } from "../env";
import { logError } from "../log";
import { syncContractWithAsaas, type SyncResult } from "./billingAsaas";
import { applyCancellationInAsaas, type CancelSyncResult } from "./billingCancel";
import { finishCardChange, startCardChange, type CardChangeFinish } from "./billingCardChange";
import { confirmCardRegistration, startCardRegistration, type CardRegisterStart, type CardRegisterStatus } from "./billingCardRegister";
import { platformBillingCancelStore, platformBillingCardChangeStore, platformBillingCardRegisterStore, platformBillingStore } from "./platform";

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

/** F12.2g: conclui a troca (assinatura nova no contrato) e atualiza as cobranças. */
export async function finishCardChangeNow(contractId: string): Promise<CardChangeFinish> {
  const env = platformEnv();
  const api = env.asaas ? asaasBillingApi(env.asaas) : null;
  const result = await finishCardChange(platformBillingCardChangeStore(env), api, contractId);
  if (result.status === "changed") {
    await syncContractNow(contractId);
    // F12.2i: o final do cartão novo.
    const subscription = (await platformBillingStore(env).load(contractId))?.contract.subscriptionId ?? null;
    const card = api && subscription ? await api.getSubscriptionCard(subscription).catch(() => null) : null;
    if (card) await platformBillingCardRegisterStore(env).recordCardRegistered(contractId, card.last4, "checkout");
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
