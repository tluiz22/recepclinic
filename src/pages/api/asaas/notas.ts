import type { APIRoute } from "astro";
import { waitUntil } from "@vercel/functions";
import { handleInvoiceWebhook } from "../../../lib/data/nfseAsaas";
import { logError } from "../../../lib/log";

// Webhook das notas fiscais (N3b): um endereço para todas as subcontas; cada
// uma manda o próprio token (asaas-access-token), conferido em tempo constante
// contra o do emissor da subconta (account.id). O evento é gravado uma vez e o
// 200 sai logo; a nota é confirmada pelo GET em segundo plano (e, se cair, a
// rotina notas-fiscais confere depois).
export const POST: APIRoute = async ({ request }) => {
  try {
    const outcome = await handleInvoiceWebhook(await request.json().catch(() => null), request.headers.get("asaas-access-token"));
    if (outcome.process) waitUntil(outcome.process().catch((error) => logError("webhook das notas: processamento", error)));
    return new Response(outcome.body, { status: outcome.status });
  } catch (error) {
    // Sem gravar, o Asaas reenvia.
    logError("webhook das notas", error);
    return new Response("erro ao gravar", { status: 500 });
  }
};
