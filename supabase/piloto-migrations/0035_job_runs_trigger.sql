-- Execuções manuais marcadas na tela Envios (pedido do cliente, 02/out/2026).
--
-- `job_runs.trigger`: 'scheduled' = agendador do Supabase; 'manual' = chamada
-- à mão da rota (teste), sem `trigger=scheduled`.

alter table job_runs
  add column trigger text check (trigger in ('scheduled', 'manual'));

-- Execuções antigas, gravadas antes da coluna: o agendador (e os crons da
-- Vercel, antes da etapa 7 da Fase 22) chama sempre nos primeiros segundos do
-- minuto; uma chamada à mão quase nunca cai ali. Melhor estimativa possível
-- para o histórico (ex.: a chamada de teste de 01/10 às 21:13:52 → manual).
update job_runs
  set trigger = case when extract(second from started_at) < 10 then 'scheduled' else 'manual' end
  where trigger is null;

-- O resumo da véspera passa a se identificar como o agendador (os outros dois
-- jobs já mandam `trigger=scheduled`). Mesmo nome = o pg_cron substitui o
-- agendamento existente (migração 0030).
select cron.schedule(
  'resumo-do-dia-vespera',
  '0 21 * * *',
  $$ select internal.call_cron_route('/api/cron/daily-summary?send=preview&trigger=scheduled') $$
);
