-- Fase 22 · etapa 7 (complemento): o resumo do dia da equipe também passa a
-- ser disparado pelo agendador do Supabase (decisão do cliente) — tudo num
-- lugar só, horário exato (o cron do plano Hobby da Vercel sai "dentro da
-- hora") e funcionando sozinho também no preview (os crons da Vercel só
-- disparam em produção). O `vercel.json` fica sem crons.
--
-- Mesmos segredos do Vault da migração 0029 — nenhum cadastro novo. O
-- domínio vem de `reminder_cron_url` (tudo antes de `/api/`).

-- Schema fora da API do Supabase (o PostgREST só expõe `public`): a função
-- lê segredos do Vault e não pode ser chamável por anon/authenticated.
create schema if not exists internal;
revoke all on schema internal from public, anon, authenticated;

create or replace function internal.call_cron_route(path text)
returns bigint
language sql
as $$
  select net.http_get(
    url := split_part(
      (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_url'),
      '/api/',
      1
    ) || path,
    headers := jsonb_strip_nulls(jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
      'x-vercel-protection-bypass',
      (select decrypted_secret from vault.decrypted_secrets where name = 'vercel_protection_bypass')
    )),
    timeout_milliseconds := 60000
  );
$$;

revoke all on function internal.call_cron_route(text) from public, anon, authenticated;

-- Horários em UTC (Fortaleza = UTC-3, sem horário de verão). Mesmo nome =
-- o pg_cron substitui o agendamento existente.
select cron.schedule(
  'lembrete-de-hora-em-hora',
  '0 * * * *',
  $$ select internal.call_cron_route('/api/cron/appointment-reminders?trigger=scheduled') $$
);

-- 18h da véspera (atendimentos de amanhã).
select cron.schedule(
  'resumo-do-dia-vespera',
  '0 21 * * *',
  $$ select internal.call_cron_route('/api/cron/daily-summary?send=preview') $$
);

-- 6h30 do dia (atendimentos de hoje).
select cron.schedule(
  'resumo-do-dia-manha',
  '30 9 * * *',
  $$ select internal.call_cron_route('/api/cron/daily-summary?send=final') $$
);
