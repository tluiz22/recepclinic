import type { APIRoute } from "astro";
import { heartbeat } from "../../../lib/cron/route";
import { todayIn } from "../../../lib/clinicTime";
import { reconcileBilling } from "../../../lib/data/billingEvents";
import { billingEventDeps } from "../../../lib/data/billingEventsDeps";
import { platformEnv } from "../../../lib/env";
import { logError } from "../../../lib/log";

// Conciliação com o Asaas (F12.5): uma vez por dia, sincroniza de novo todo
// contrato automático aceito (corrige o que o webhook perdeu e refaz a criação
// que falhou). Cada falha fica no contrato e na trilha.
const route: APIRoute = async ({ request }) => {
  if (request.headers.get("authorization") !== `Bearer ${platformEnv().cronSecret}`) {
    return new Response(JSON.stringify({ error: "não autorizado" }), { status: 401 });
  }
  const { store, api } = billingEventDeps();
  const result = await reconcileBilling(store, api, todayIn("America/Sao_Paulo"));
  if (result.failed) logError("conciliacao-asaas", new Error(`${result.failed} contrato(s) com erro no Asaas`));
  await heartbeat("conciliacao-asaas", result.contracts, result.failed);
  return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
};

export const POST = route;
export const GET = route;
