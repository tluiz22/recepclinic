import type { APIRoute } from "astro";
import { heartbeat } from "../../../lib/cron/route";
import { todayIn } from "../../../lib/clinicTime";
import { applyCancellationInAsaas } from "../../../lib/data/billingCancel";
import { reconcileBilling } from "../../../lib/data/billingEvents";
import { platformBillingCancelStore } from "../../../lib/data/platform";
import { billingEventDeps } from "../../../lib/data/billingEventsDeps";
import { platformEnv } from "../../../lib/env";
import { logError } from "../../../lib/log";

// Conciliação com o Asaas (F12.5): uma vez por dia, sincroniza de novo todo
// contrato automático aceito (corrige o que o webhook perdeu e refaz a criação
// que falhou). Cada falha fica no contrato e na trilha. F12.2f: refaz o ajuste
// do cancelamento que falhou no Asaas e suspende (fim do contrato) a clínica
// que passou do último dia de acesso depois de cancelar.
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
  const failed = result.failed + cancelFailed;
  if (failed) logError("conciliacao-asaas", new Error(`${failed} contrato(s) com erro no Asaas`));
  await heartbeat("conciliacao-asaas", result.contracts + cancels.length, failed);
  return new Response(JSON.stringify({ ...result, cancels: cancels.length, cancelFailed, suspended }), { headers: { "Content-Type": "application/json" } });
};

export const POST = route;
export const GET = route;
