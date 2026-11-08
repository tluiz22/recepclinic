import type { APIRoute } from "astro";
import { heartbeat } from "../../../lib/cron/route";
import { checkPendingAsPlatform } from "../../../lib/data/nfse";
import { listPendingNfse } from "../../../lib/data/platform";
import { platformEnv } from "../../../lib/env";
import { logError } from "../../../lib/log";
import { defaultAsaasNfseDeps, reconcileAsaasInvoices } from "../../../lib/data/nfseAsaas";
import { defaultAutoDeliveryDeps, runInvoiceOutbox } from "../../../lib/data/nfseAutoDelivery";
import { asaasFiscalApi } from "../../../lib/asaas/fiscalApi";

// Notas fiscais sem resposta (F11.4, segurança da F11, item 5): a cada 10
// minutos (N3b; antes, uma vez por dia), confere na Receita as notas "emitindo" ou "cancelando" pedidas há mais
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
  // Notas pelo Asaas (N3b): pendentes há mais de 3 minutos, conferidas pelo GET.
  let asaas = { checked: 0, failed: 0 };
  let outbox = { files: 0, delivered: 0, failed: 0 };
  const env = platformEnv();
  if (env.asaas) {
    try {
      const deps = defaultAsaasNfseDeps();
      asaas = await reconcileAsaasInvoices(deps);
      // N4: arquivos que faltaram e a entrega automática pelo WhatsApp.
      const base = env.asaas.baseUrl;
      outbox = await runInvoiceOutbox(defaultAutoDeliveryDeps(env.siteUrl ?? new URL(request.url).origin), async (issuerId) => {
        const key = await deps.issuers.apiKey(issuerId);
        if (!key) throw new Error("emissor sem chave");
        return asaasFiscalApi({ baseUrl: base, apiKey: key });
      });
    } catch (error) {
      errors++;
      logError("notas-fiscais: Asaas", error);
    }
  }
  errors += asaas.failed;
  await heartbeat("notas-fiscais", new Set(pending.map((p) => p.clinicId)).size + asaas.checked, errors);
  return new Response(JSON.stringify({ pending: pending.length, errors, results, asaas, outbox }), { headers: { "Content-Type": "application/json" } });
};

export const POST = route;
export const GET = route;
