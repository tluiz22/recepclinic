-- Fase 22 · etapa 7: horário do lembrete configurável.
--
-- Decisões do cliente: um horário único, só para o lembrete (o resumo do dia
-- continua fixo na Vercel), horas cheias das 7h às 20h (Fortaleza), janela
-- de 26h mantida, campo na tela Envios automáticos.
--
-- O plano Hobby da Vercel só dispara cron 1×/dia em horário fixo no código.
-- Por isso o lembrete passa a ser chamado pelo agendador do próprio
-- Supabase (pg_cron + pg_net, inclusos no plano gratuito) de hora em hora;
-- a rota só envia quando a hora de Fortaleza bate com `reminder_hour`.

alter table appointment_settings
  add column reminder_hour integer not null default 8
    check (reminder_hour between 7 and 20);

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- A URL da rota e o CRON_SECRET ficam no cofre (Vault) do Supabase, nunca
-- no código. Cadastro manual, uma vez (e de novo ao ir para produção,
-- trocando a URL):
--
--   select vault.create_secret('<CRON_SECRET>', 'cron_secret');
--   select vault.create_secret(
--     'https://<domínio>/api/cron/appointment-reminders?trigger=scheduled',
--     'reminder_cron_url'
--   );
--   -- Só no preview (proteção de deploy da Vercel ligada):
--   select vault.create_secret('<token de bypass>', 'vercel_protection_bypass');
--
-- Sem os segredos, a chamada falha sem efeito nenhum (nada é enviado).
-- Minuto 0 de toda hora (UTC); Fortaleza não tem horário de verão, então a
-- hora cheia de lá é sempre hora cheia em UTC.
select cron.schedule(
  'lembrete-de-hora-em-hora',
  '0 * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_url'),
    headers := jsonb_strip_nulls(jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
      'x-vercel-protection-bypass',
      (select decrypted_secret from vault.decrypted_secrets where name = 'vercel_protection_bypass')
    )),
    timeout_milliseconds := 60000
  );
  $$
);
