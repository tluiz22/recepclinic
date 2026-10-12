import type { APIRoute } from "astro";
import { heartbeat } from "../../../lib/cron/route";
import { checkPendingAsPlatform } from "../../../lib/data/nfse";
import { listPendingNfse } from "../../../lib/data/platform";
import { platformEnv } from "../../../lib/env";
import { logError } from "../../../lib/log";

// Notas fiscais sem resposta (F11.4, segurança da F11, item 5): uma vez por
// dia, confere na Receita as notas "emitindo" ou "cancelando" pedidas há mais
// de 10 minutos e grava o resultado (emitida, recusada, cancelada). Pela
// plataforma, sem login de ninguém; a trilha registra a conferência.
const route: APIRoute = async ({ request }) => {
  if (request.headers.get("authorization") !== `Bearer ${platformEnv().cronSecret}`) {
    return new Response(JSON.stringify({ error: "não autorizado" }), { status: 401 });
  }
  const pending = await listPendingNfse(new Date(Date.now() - 10 * 60_000));
  const results: Record<string, string> = {};
  let errors = 0;
  for (const invoice of pending) {
    try {
      results[invoice.invoiceId] = (await checkPendingAsPlatform(invoice)).status;
    } catch (error) {
      errors++;
      logError("notas-fiscais", error, { clinica: invoice.clinicId, nota: invoice.invoiceId });
    }
  }
  await heartbeat("notas-fiscais", new Set(pending.map((p) => p.clinicId)).size, errors);
  return new Response(JSON.stringify({ pending: pending.length, errors, results }), { headers: { "Content-Type": "application/json" } });
};

export const POST = route;
export const GET = route;
