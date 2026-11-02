import type { APIRoute } from "astro";
import { heartbeat } from "../../../lib/cron/route";
import { processBillingEvents } from "../../../lib/data/billingEvents";
import { billingEventDeps } from "../../../lib/data/billingEventsDeps";
import { platformEnv } from "../../../lib/env";
import { logError } from "../../../lib/log";

// Fila do webhook do Asaas (F12.5): a cada 10 minutos, processa os eventos
// pendentes e tenta de novo os que falharam (até 10 vezes).
const route: APIRoute = async ({ request }) => {
  if (request.headers.get("authorization") !== `Bearer ${platformEnv().cronSecret}`) {
    return new Response(JSON.stringify({ error: "não autorizado" }), { status: 401 });
  }
  const { store, api } = billingEventDeps();
  const summary = await processBillingEvents(store, api, 200);
  if (summary.failed) logError("faturamento-eventos", new Error(`${summary.failed} evento(s) do Asaas falharam`));
  await heartbeat("faturamento-eventos", summary.processed + summary.ignored + summary.failed, summary.failed);
  return new Response(JSON.stringify(summary), { headers: { "Content-Type": "application/json" } });
};

export const POST = route;
export const GET = route;
