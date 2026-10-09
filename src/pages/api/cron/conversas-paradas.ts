import type { APIRoute } from "astro";
import { createClinicServiceClient } from "../../../lib/data/clinicService";
import { listClinicsWithIdleConversations } from "../../../lib/data/platform";
import { closeIdleConversations } from "../../../lib/data/whatsapp/bot/router";
import { clinicSenderFor } from "../../../lib/data/whatsapp/clinicSender";
import { IDLE_TIMEOUT_MINUTES } from "../../../lib/data/whatsapp/conversations";
import { platformEnv } from "../../../lib/env";
import { heartbeat } from "../../../lib/cron/route";
import { logError } from "../../../lib/log";

// Conversa parada há 15 minutos (F6.3, cliente 07/out): chamada a cada minuto
// pelo agendador do Supabase (pg_cron, migração 20261007130000), com
// `Authorization: Bearer <CRON_SECRET>`. Cada clínica roda com a própria
// credencial; erro numa não para as outras.
const run: APIRoute = async ({ request, url }) => {
  if (request.headers.get("authorization") !== `Bearer ${platformEnv().cronSecret}`) {
    return new Response(JSON.stringify({ error: "não autorizado" }), { status: 401 });
  }
  const now = new Date();
  const clinics = await listClinicsWithIdleConversations(new Date(now.getTime() - IDLE_TIMEOUT_MINUTES * 60_000));
  let closed = 0;
  let errors = 0;
  for (const clinicId of clinics) {
    try {
      closed += await closeIdleConversations(createClinicServiceClient(clinicId), clinicId, await clinicSenderFor(clinicId, url), now);
    } catch (error) {
      errors++;
      logError("conversas paradas", error, { clinica: clinicId });
    }
  }
  await heartbeat("conversas-paradas", clinics.length, errors);
  return new Response(JSON.stringify({ clinics: clinics.length, closed, errors }), { headers: { "Content-Type": "application/json" } });
};

export const POST = run;
export const GET = run;
