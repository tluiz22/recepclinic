import type { APIRoute } from "astro";
import { createServiceClient } from "../../../lib/supabase/service";
import { processWaitlist } from "../../../lib/waitlistOffers";

// Motor de ofertas da lista de espera (Fase 25 · etapa 3). Chamado pelo
// agendador do Supabase de 5 em 5 minutos (`?trigger=scheduled`, migração
// 0037) e, na hora, pelo gatilho que registra uma vaga nova
// (`?trigger=opening`, migração 0038). Cada chamada vence as ofertas sem
// resposta, tira da lista quem já passou do horário e oferece as vagas em
// aberto ao próximo da fila. Sem linha em `job_runs` (288 chamadas/dia
// esconderiam as execuções do lembrete e do resumo na aba Envios).
//
// Autenticação: `Authorization: Bearer <CRON_SECRET>`, como as demais rotas
// do agendador.

export const GET: APIRoute = async ({ request }) => {
  const cronSecret = import.meta.env.CRON_SECRET;
  if (!cronSecret) {
    return json({ error: "CRON_SECRET não configurada" }, 500);
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return json({ error: "não autorizado" }, 401);
  }

  const totals = await processWaitlist(createServiceClient());
  return json(totals);
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
