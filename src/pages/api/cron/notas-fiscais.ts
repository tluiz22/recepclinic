import type { APIRoute } from "astro";
import { heartbeat } from "../../../lib/cron/route";
import { platformEnv } from "../../../lib/env";
import { logError } from "../../../lib/log";
import { defaultAsaasNfseDeps, reconcileAsaasInvoices } from "../../../lib/data/nfseAsaas";
import { defaultAutoDeliveryDeps, runInvoiceOutbox } from "../../../lib/data/nfseAutoDelivery";
import { asaasFiscalApi } from "../../../lib/asaas/fiscalApi";
import { asaasBillingApi } from "../../../lib/asaas/billingApi";
import { runFiscalBilling } from "../../../lib/data/fiscalBilling";
import { platformFiscalBilling } from "../../../lib/data/platform";
import { todayIn } from "../../../lib/clinicTime";

// Notas fiscais (a cada 10 minutos): conciliação das notas do Asaas "emitindo"
// ou "cancelando" (N3b), arquivos e entrega automática (N4), cobrança das
// notas e suspensão (N4b). O emissor antigo (Sefin) saiu na N5. Pela
// plataforma, sem login de ninguém; a trilha registra a conferência.
const route: APIRoute = async ({ request }) => {
  if (request.headers.get("authorization") !== `Bearer ${platformEnv().cronSecret}`) {
    return new Response(JSON.stringify({ error: "não autorizado" }), { status: 401 });
  }
  // O emissor antigo (Sefin) saiu na N5: só o Asaas.
  const results: Record<string, string> = {};
  let errors = 0;
  const pending: { clinicId: string }[] = [];
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
  // N4b: cobrança das notas por pagador e suspensão do profissional inadimplente.
  let billing = { created: 0, synced: 0, failed: 0, suspensions: 0 };
  try {
    billing = await runFiscalBilling(todayIn("America/Sao_Paulo"), { store: platformFiscalBilling(), api: env.asaas ? asaasBillingApi(env.asaas) : null });
  } catch (error) {
    errors++;
    logError("notas-fiscais: cobrança das notas", error);
  }
  errors += asaas.failed + billing.failed;
  await heartbeat("notas-fiscais", new Set(pending.map((p) => p.clinicId)).size + asaas.checked, errors);
  return new Response(JSON.stringify({ pending: pending.length, errors, results, asaas, outbox, billing }), { headers: { "Content-Type": "application/json" } });
};

export const POST = route;
export const GET = route;
