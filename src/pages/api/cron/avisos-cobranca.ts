import type { APIRoute } from "astro";
import { heartbeat } from "../../../lib/cron/route";
import { sendBillingNotices } from "../../../lib/data/billingNotices";
import { platformBillingNoticeStore } from "../../../lib/data/platform";
import { smtpSender } from "../../../lib/email";
import { platformEnv } from "../../../lib/env";
import { logError } from "../../../lib/log";

// Avisos de cobrança (F12.7): às 9h de Brasília, todo dia, agenda os avisos de
// atraso (3º, 7º e 14º dia) e envia os pendentes (também os de pagamento
// reconhecido, que a rotina faturamento-eventos já manda ao longo do dia).
const route: APIRoute = async ({ request, url }) => {
  const env = platformEnv();
  if (request.headers.get("authorization") !== `Bearer ${env.cronSecret}`) {
    return new Response(JSON.stringify({ error: "não autorizado" }), { status: 401 });
  }
  const store = platformBillingNoticeStore(env);
  const scheduled = await store.scheduleOverdue();
  const summary = await sendBillingNotices(store, { sendEmail: smtpSender(env.email), panelLink: new URL("/admin/configuracoes/assinatura", url).toString() });
  if (summary.failed) logError("avisos-cobranca", new Error(`${summary.failed} aviso(s) de cobrança não saíram`));
  await heartbeat("avisos-cobranca", scheduled + summary.sent, summary.failed);
  return new Response(JSON.stringify({ scheduled, ...summary }), { headers: { "Content-Type": "application/json" } });
};

export const POST = route;
export const GET = route;
