-- F7 — Envios automáticos por clínica, pelo agendador do Supabase (pg_cron,
-- L34; o mesmo da conversa parada, F6.3), e as opções de envio da clínica
-- (cliente, 07/out/2026).

-- Lembrete ao paciente na véspera: enviar ou não; horário padrão 18:00.
alter table public.clinic_settings
  add column reminder_enabled boolean not null default true,
  alter column reminder_hour set default 18,
  -- Resumo da equipe na véspera: enviar ou não e o horário (7h às 20h).
  add column summary_preview_enabled boolean not null default true,
  add column summary_preview_hour smallint not null default 18 check (summary_preview_hour between 7 and 20),
  -- Resumo da equipe no dia: enviar ou não e quantas horas antes da primeira agenda.
  add column summary_today_enabled boolean not null default true,
  add column summary_today_lead_hours smallint not null default 1 check (summary_today_lead_hours between 1 and 4);

-- O padrão antigo (14h) vira o novo (18h): ainda não há clínica real.
update public.clinic_settings set reminder_hour = 18 where reminder_hour = 14;

-- Plataforma (service role): clínicas ativas, para as rotinas; cada uma roda
-- depois com a própria credencial (D1).
create function public.list_active_clinics()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.clinics where status = 'active'
$$;

revoke execute on function public.list_active_clinics() from public, anon, authenticated, clinic_service;
grant execute on function public.list_active_clinics() to service_role;

-- Rotinas (horários em UTC; o Brasil não tem horário de verão e os fusos são
-- de hora cheia, então a hora cheia daqui é hora cheia na clínica).
select cron.schedule('lembretes', '0 * * * *', $$ select app.call_system_route('/api/cron/lembretes') $$);
select cron.schedule('resumo-do-dia', '*/5 * * * *', $$ select app.call_system_route('/api/cron/resumo-do-dia') $$);
select cron.schedule('lista-de-espera', '*/5 * * * *', $$ select app.call_system_route('/api/cron/lista-de-espera') $$);
-- 3h de Brasília.
select cron.schedule('series', '0 6 * * *', $$ select app.call_system_route('/api/cron/series') $$);
