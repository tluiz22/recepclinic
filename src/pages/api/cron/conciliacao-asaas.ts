import type { APIRoute } from "astro";
import { heartbeat } from "../../../lib/cron/route";
import { todayIn } from "../../../lib/clinicTime";
import { applyCancellationInAsaas } from "../../../lib/data/billingCancel";
import { reconcileBilling } from "../../../lib/data/billingEvents";
import { confirmCardRegistrationNow, finishCardChangeNow } from "../../../lib/data/billingAsaasDeps";
import { platformBillingCancelStore, platformBillingCardChangeStore, platformBillingCardRegisterStore } from "../../../lib/data/platform";
import { billingEventDeps } from "../../../lib/data/billingEventsDeps";
import { platformEnv } from "../../../lib/env";
import { logError } from "../../../lib/log";

// Conciliação com o Asaas (F12.5): uma vez por dia, sincroniza de novo todo
// contrato automático aceito (corrige o que o webhook perdeu e refaz a criação
// que falhou). Cada falha fica no contrato e na trilha. F12.2f: refaz o ajuste
// do cancelamento que falhou no Asaas e suspende (fim do contrato) a clínica
// que passou do último dia de acesso depois de cancelar. F12.2g: termina a
// troca de cartão que ficou pela metade. F12.2i: liga à assinatura o cartão
// que pagou a implantação quando a clínica fechou a aba antes da confirmação.
const route: APIRoute = async ({ request }) => {
  if (request.headers.get("authorization") !== `Bearer ${platformEnv().cronSecret}`) {
    return new Response(JSON.stringify({ error: "não autorizado" }), { status: 401 });
  }
  const { store, api } = billingEventDeps();
  const result = await reconcileBilling(store, api, todayIn("America/Sao_Paulo"));
  const cancelStore = platformBillingCancelStore();
  let cancelFailed = 0;
  const cancels = await cancelStore.cancelsToSync();
  for (const contractId of cancels) {
    if ((await applyCancellationInAsaas(cancelStore, api, contractId)).status === "failed") cancelFailed += 1;
  }
  const suspended = await cancelStore.suspendEnded();
  // F12.2g: troca de cartão que não voltou do Checkout: conclui ou descarta (1 dia).
  let cardFailed = 0;
  const registerStore = platformBillingCardRegisterStore();
  const withoutCard = new Set(await registerStore.contractsWithoutCard());
  for (const contractId of await platformBillingCardChangeStore().openCardChanges()) {
    if (withoutCard.has(contractId)) continue;
    if ((await finishCardChangeNow(contractId)).status === "failed") cardFailed += 1;
  }
  // F12.2i: cartão da assinatura ainda não confirmado (IP do aceite).
  for (const contractId of withoutCard) {
    if ((await confirmCardRegistrationNow(contractId, null)).status === "failed") cardFailed += 1;
  }
  const failed = result.failed + cancelFailed + cardFailed;
  if (failed) logError("conciliacao-asaas", new Error(`${failed} contrato(s) com erro no Asaas`));
  await heartbeat("conciliacao-asaas", result.contracts + cancels.length, failed);
  return new Response(JSON.stringify({ ...result, cancels: cancels.length, cancelFailed, suspended }), { headers: { "Content-Type": "application/json" } });
};

export const POST = route;
export const GET = route;
