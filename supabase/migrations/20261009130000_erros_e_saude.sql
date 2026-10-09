-- F9.3 — Erros do sistema e saúde das rotinas (L45; cliente, 09/out/2026).
--
-- Sem ferramenta externa de erros (não entra operador novo nos dados, como
-- declarado na Meta): o servidor grava cada erro aqui, já sem dados pessoais
-- (src/lib/log.ts, F9.2), e o Suporte vê a lista em Administração do sistema ›
-- Erros. O aviso vem do monitor externo (Better Stack), que olha /api/saude e
-- /api/saude/erros. Só a service role grava; só o Suporte lê.

create table public.system_errors (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  scope text not null check (char_length(scope) <= 200),
  clinic_id uuid references public.clinics (id) on delete set null,
  ids jsonb not null default '{}'::jsonb,
  message text not null default '' check (char_length(message) <= 600)
);

create index system_errors_occurred_idx on public.system_errors (occurred_at desc);
create index system_errors_clinic_idx on public.system_errors (clinic_id, occurred_at desc);

-- Última execução de cada rotina do agendador (pg_cron → rota /api/cron/...):
-- prova a corrente inteira (agendador, chamada HTTP, aplicação, banco). A
-- /api/saude acusa a rotina atrasada.
create table public.cron_heartbeats (
  job text primary key check (char_length(job) <= 100),
  last_finished_at timestamptz not null,
  clinics integer not null default 0,
  errors integer not null default 0
);

alter table public.system_errors enable row level security;
alter table public.cron_heartbeats enable row level security;

create policy system_errors_staff on public.system_errors
  for select to authenticated
  using (app.is_platform_staff());

create policy cron_heartbeats_staff on public.cron_heartbeats
  for select to authenticated
  using (app.is_platform_staff());

revoke insert, update, delete on public.system_errors from anon, authenticated, clinic_service;
revoke insert, update, delete on public.cron_heartbeats from anon, authenticated, clinic_service;
revoke select on public.system_errors from anon, clinic_service;
revoke select on public.cron_heartbeats from anon, clinic_service;

-- Erros ficam 90 dias.
select cron.schedule('limpar-erros', '15 3 * * *', $$ delete from public.system_errors where occurred_at < now() - interval '90 days' $$);
