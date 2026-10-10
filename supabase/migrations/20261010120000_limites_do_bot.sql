-- F9.6a — Proteção contra abuso no agendamento pelo bot (cliente, 09 e 10/out/2026).
--
-- Um número de WhatsApp poderia cadastrar pelo bot muitos pacientes ("para
-- outra pessoa") e marcar um atendimento para cada um. Três limites por
-- contato, só no bot (a equipe marca e cadastra sem limite pelo painel):
--   - atendimentos futuros, somando todos os pacientes do contato (marcados
--     pelo bot ou pela equipe): padrão 3, de 1 a 10;
--   - pacientes novos cadastrados pelo bot em 30 dias: padrão 3, de 1 a 10;
--   - faltas nos últimos 90 dias, somando os pacientes: padrão 2, de 0 a 10
--     (0 desliga).
-- Cada vez que um limite barra o bot fica registrada (motivo na tela do
-- contato, cartão "Contatos para revisar" do Painel e contagem na tela Uso).

alter table public.clinic_settings
  add column bot_max_future_appointments smallint not null default 3
    check (bot_max_future_appointments between 1 and 10),
  add column bot_max_new_patients smallint not null default 3
    check (bot_max_new_patients between 1 and 10),
  add column bot_max_no_shows smallint not null default 2
    check (bot_max_no_shows between 0 and 10);

-- Quem cadastrou o paciente: a equipe pela tela ou o bot. Os já cadastrados
-- ficam como da equipe (não contam no limite).
alter table public.patients
  add column created_via text not null default 'admin' check (created_via in ('admin', 'whatsapp'));

create index patients_contact_created_idx on public.patients (contact_id, created_at) where created_via = 'whatsapp';

-- ---------------------------------------------------------------------------
-- Limites atingidos
-- ---------------------------------------------------------------------------
-- Sem telefone nem nome: só o contato (a anonimização não precisa mexer aqui).
create table public.bot_limit_events (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  contact_id uuid not null,
  reason text not null check (reason in ('future_appointments', 'new_patients', 'no_shows')),
  -- O limite da clínica e quanto o contato tinha naquela hora.
  limit_value smallint not null,
  current_value integer not null,
  -- false = conexão sem coexistência: o bot avisou e não pausou.
  paused boolean not null,
  created_at timestamptz not null default now(),
  foreign key (clinic_id, contact_id) references public.contacts (clinic_id, id)
);

create index bot_limit_events_clinic_created_idx on public.bot_limit_events (clinic_id, created_at desc);
create index bot_limit_events_contact_idx on public.bot_limit_events (contact_id, created_at desc);

-- A equipe só lê; o bot grava.
select app.enable_clinic_service_written_rls('public.bot_limit_events');

-- Contagem por mês para o Suporte (tela Uso).
alter table public.clinic_usage_monthly add column bot_limit_hits integer not null default 0;

create function app.count_bot_limit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.clinic_usage_monthly (clinic_id, month, bot_limit_hits)
  values (new.clinic_id, date_trunc('month', app.clinic_today(new.clinic_id))::date, 1)
  on conflict (clinic_id, month) do update
    set bot_limit_hits = public.clinic_usage_monthly.bot_limit_hits + 1;
  return null;
end
$$;

create trigger bot_limit_events_count_usage
  after insert on public.bot_limit_events
  for each row execute function app.count_bot_limit_event();

revoke execute on function app.count_bot_limit_event() from public, anon, authenticated, clinic_service;
