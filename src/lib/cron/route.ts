import type { APIRoute } from "astro";
import { createClinicServiceClient } from "../data/clinicService";
import type { DbClient } from "../data/clients";
import { listActiveClinics } from "../data/platform";
import { clinicSenderFor } from "../data/whatsapp/clinicSender";
import type { ClinicSender } from "../data/whatsapp/send";
import { platformEnv } from "../env";
import { logError } from "../log";

// Rotinas do agendador do Supabase (pg_cron, F7): `Authorization: Bearer
// <CRON_SECRET>`; percorre as clínicas ativas, cada uma com a própria
// credencial e quem envia pelo WhatsApp dela (null = não conectado). Erro numa
// clínica não para as outras (vai para o log e para a contagem).

export type ClinicJob = (input: { clinicId: string; db: DbClient; sender: ClinicSender | null; now: Date }) => Promise<unknown>;

export function cronRoute(name: string, job: ClinicJob): APIRoute {
  return async ({ request, url }) => {
    if (request.headers.get("authorization") !== `Bearer ${platformEnv().cronSecret}`) {
      return new Response(JSON.stringify({ error: "não autorizado" }), { status: 401 });
    }
    const now = new Date();
    const clinics = await listActiveClinics();
    const results: Record<string, unknown> = {};
    let errors = 0;
    for (const clinicId of clinics) {
      try {
        results[clinicId] = await job({ clinicId, db: createClinicServiceClient(clinicId), sender: await clinicSenderFor(clinicId, url), now });
      } catch (error) {
        errors++;
        logError(name, error, { clinica: clinicId });
      }
    }
    return new Response(JSON.stringify({ clinics: clinics.length, errors, results }), { headers: { "Content-Type": "application/json" } });
  };
}
