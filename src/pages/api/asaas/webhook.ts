import type { APIRoute } from "astro";
import { waitUntil } from "@vercel/functions";
import { parseAsaasWebhook, processBillingEvents, webhookTokenMatches } from "../../../lib/data/billingEvents";
import { billingEventDeps } from "../../../lib/data/billingEventsDeps";
import { logError, logWarn } from "../../../lib/log";

// Webhook da conta do RecepClinic no Asaas (F12.5, faturamento do SaaS): o
// token do cabeçalho asaas-access-token é conferido em tempo constante; o
// evento é gravado (repetido é ignorado) e o 200 sai logo; o processamento
// roda em segundo plano e, se cair, a rotina faturamento-eventos pega depois.
export const POST: APIRoute = async ({ request }) => {
  const deps = billingEventDeps();
  if (!webhookTokenMatches(request.headers.get("asaas-access-token"), deps.webhookToken)) {
    if (!deps.webhookToken) logError("asaas webhook: ASAAS_WEBHOOK_TOKEN não configurada, evento recusado");
    return new Response("não autorizado", { status: 401 });
  }
  const parsed = parseAsaasWebhook(await request.json().catch(() => null));
  if (!parsed) {
    logWarn("asaas webhook: corpo sem id ou evento");
    return new Response("ok", { status: 200 });
  }
  try {
    await deps.store.recordEvent(parsed);
  } catch (error) {
    // Sem gravar, o Asaas precisa reenviar: responde erro.
    logError("asaas webhook: evento não gravado", error, { evento: parsed.event });
    return new Response("erro ao gravar", { status: 500 });
  }
  waitUntil(
    processBillingEvents(deps.store, deps.api, 20).catch((error) => logError("asaas webhook: processamento", error)),
  );
  return new Response("ok", { status: 200 });
};
