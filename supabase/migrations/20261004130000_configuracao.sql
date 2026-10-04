-- F2.2 — Configuração, profissionais e agendas (D2 e D6 revistas, D4b, D4c, D10).
--
-- Tudo por clínica. Ligações entre tabelas usam chave composta (clinic_id, id):
-- o banco não deixa ligar, por exemplo, uma agenda da clínica A a um
-- profissional da clínica B.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- O papel do bot usa as funções de busca (similarity, unaccent), como os logins.
grant usage on schema extensions to clinic_service;

-- ---------------------------------------------------------------------------
-- Padrão de RLS das tabelas de configuração
-- ---------------------------------------------------------------------------
-- Toda a equipe lê; só o Administrador grava; o bot/agendador (clinic_service)
-- só lê a própria clínica; toda alteração do Suporte fica registrada.
create function app.enable_clinic_config_rls(p_table regclass)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_name text := (select relname from pg_class where oid = p_table);
begin
  execute format('alter table %s enable row level security', p_table);
  execute format(
    'create policy %I on %s for select to authenticated using (app.is_clinic_member(clinic_id))',
    v_name || '_select', p_table);
  execute format(
    'create policy %I on %s for insert to authenticated with check (app.has_clinic_role(clinic_id, array[''admin'']::public.clinic_role[]))',
    v_name || '_insert', p_table);
  execute format(
    'create policy %I on %s for update to authenticated using (app.has_clinic_role(clinic_id, array[''admin'']::public.clinic_role[])) with check (app.has_clinic_role(clinic_id, array[''admin'']::public.clinic_role[]))',
    v_name || '_update', p_table);
  execute format(
    'create policy %I on %s for delete to authenticated using (app.has_clinic_role(clinic_id, array[''admin'']::public.clinic_role[]))',
    v_name || '_delete', p_table);
  execute format(
    'create policy %I on %s for select to clinic_service using (clinic_id = app.service_clinic_id())',
    v_name || '_select_service', p_table);
  execute format(
    'create trigger %I after insert or update or delete on %s for each row execute function app.audit_platform_staff_write()',
    v_name || '_audit_platform_staff', p_table);
end
$$;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type public.clinic_profile as enum ('pediatric', 'adult', 'mixed');
create type public.location_type as enum ('clinic', 'home_visit');
create type public.agenda_kind as enum ('professional', 'resource');
create type public.service_category as enum ('consultation', 'return_visit', 'exam');
create type public.scheduling_mode as enum ('individual', 'group');
create type public.agenda_scope as enum ('all', 'restricted');

-- ---------------------------------------------------------------------------
-- Configuração geral da clínica (1 linha por clínica, criada junto com ela)
-- ---------------------------------------------------------------------------
create table public.clinic_settings (
  clinic_id uuid primary key references public.clinics (id) on delete cascade,
  -- Vocabulário dos textos e regras de idade padrão (D4b).
  profile public.clinic_profile not null default 'mixed',
  timezone text not null default 'America/Fortaleza',
  -- Idade a partir da qual não marca Consulta (só Retorno/Exame). Nulo = desligada.
  consultation_age_limit_years integer check (consultation_age_limit_years > 0),
  reminder_hour smallint not null default 14 check (reminder_hour between 0 and 23),
  -- Informações curtas usadas pelo bot (D4b).
  bot_payment_info text,
  bot_insurance_info text,
  bot_notes text,
  logo_url text,
  brand_color text check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  -- D10: pedir carteirinha/validade na página de data e horário.
  require_insurance_details boolean not null default false,
  updated_at timestamptz not null default now()
);

create function app.validate_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Fuso horário inválido: %', new.timezone using errcode = '22023';
  end if;
  return new;
end
$$;

create trigger clinic_settings_validate_timezone
  before insert or update of timezone on public.clinic_settings
  for each row execute function app.validate_timezone();

create trigger clinic_settings_set_updated_at
  before update on public.clinic_settings
  for each row execute function app.set_updated_at();

create function app.create_clinic_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.clinic_settings (clinic_id) values (new.id);
  return null;
end
$$;

create trigger clinics_create_settings
  after insert on public.clinics
  for each row execute function app.create_clinic_settings();

-- ---------------------------------------------------------------------------
-- Profissionais (D4b: genérico — médico, dentista, psicólogo, fisioterapeuta…)
-- ---------------------------------------------------------------------------
create table public.professionals (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  -- Login da equipe, opcional (profissional que não usa o painel não tem).
  user_id uuid,
  display_name text not null check (length(trim(display_name)) > 0),
  profession text not null check (length(trim(profession)) > 0),
  specialty text,
  council text,
  council_number text,
  council_state char(2) check (council_state ~ '^[A-Z]{2}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, user_id) references public.clinic_members (clinic_id, user_id) on delete set null (user_id)
);

create unique index professionals_clinic_user_idx on public.professionals (clinic_id, user_id) where user_id is not null;

-- ---------------------------------------------------------------------------
-- Locais de atendimento (consultório, domiciliar)
-- ---------------------------------------------------------------------------
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  type public.location_type not null,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, id)
);

-- ---------------------------------------------------------------------------
-- Agendas (D2): de um profissional ou de um recurso (ex.: "Exames")
-- ---------------------------------------------------------------------------
create table public.agendas (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  kind public.agenda_kind not null,
  professional_id uuid,
  -- Intervalo entre atendimentos desta agenda (no piloto, valia para tudo).
  buffer_minutes integer not null default 0 check (buffer_minutes >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, professional_id) references public.professionals (clinic_id, id),
  check ((kind = 'professional') = (professional_id is not null))
);

-- ---------------------------------------------------------------------------
-- Acesso de cada membro às agendas (D6 revista)
-- ---------------------------------------------------------------------------
-- 'all': todas as agendas. 'restricted': as dos profissionais ligados ao
-- próprio login + as liberadas uma a uma. Padrão: Administrador e Recepção
-- 'all'; só Profissional 'restricted'.
alter table public.clinic_members add column agenda_scope public.agenda_scope;

create function app.default_agenda_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.agenda_scope is null then
    new.agenda_scope := case
      when new.roles && array['admin', 'reception']::public.clinic_role[] then 'all'
      else 'restricted'
    end::public.agenda_scope;
  end if;
  return new;
end
$$;

create trigger clinic_members_default_agenda_scope
  before insert on public.clinic_members
  for each row execute function app.default_agenda_scope();

alter table public.clinic_members alter column agenda_scope set not null;

create table public.member_agenda_grants (
  clinic_id uuid not null,
  user_id uuid not null,
  agenda_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, agenda_id),
  foreign key (clinic_id, user_id) references public.clinic_members (clinic_id, user_id) on delete cascade,
  foreign key (clinic_id, agenda_id) references public.agendas (clinic_id, id) on delete cascade
);

-- Pode ver a agenda (e, a partir da F2.4, os atendimentos dela).
create function app.can_access_agenda(p_agenda_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.agendas a
    where a.id = p_agenda_id
      and (
        app.is_platform_staff()
        or app.service_clinic_id() = a.clinic_id
        or exists (
          select 1
          from public.clinic_members m
          where m.clinic_id = a.clinic_id
            and m.user_id = (select auth.uid())
            and (
              m.agenda_scope = 'all'
              or 'admin' = any (m.roles)
              or exists (
                select 1 from public.professionals p
                where p.id = a.professional_id and p.user_id = m.user_id
              )
              or exists (
                select 1 from public.member_agenda_grants g
                where g.agenda_id = a.id and g.user_id = m.user_id
              )
            )
        )
      )
  )
$$;

grant execute on function app.can_access_agenda(uuid) to authenticated, clinic_service;

-- ---------------------------------------------------------------------------
-- Serviços (D4c): catálogo por clínica, três categorias de comportamento
-- ---------------------------------------------------------------------------
create table public.services (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  category public.service_category not null,
  duration_minutes integer not null check (duration_minutes > 0),
  price_cents integer not null check (price_cents >= 0),
  -- Retorno: prazo em dias a partir da consulta de origem (piloto: 30).
  return_deadline_days integer check (return_deadline_days > 0),
  -- Exame: preparo (formatação do WhatsApp) e individual × turma.
  preparation_instructions text,
  scheduling_mode public.scheduling_mode not null default 'individual',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, id),
  check (return_deadline_days is null or category = 'return_visit'),
  check (preparation_instructions is null or category = 'exam'),
  check (scheduling_mode = 'individual' or category = 'exam')
);

-- Em quais agendas o serviço é atendido (D2 revista: pode ser mais de uma).
create table public.service_agendas (
  clinic_id uuid not null,
  service_id uuid not null,
  agenda_id uuid not null,
  primary key (service_id, agenda_id),
  foreign key (clinic_id, service_id) references public.services (clinic_id, id) on delete cascade,
  foreign key (clinic_id, agenda_id) references public.agendas (clinic_id, id) on delete cascade
);

-- Em quais locais o serviço é oferecido, com preço próprio opcional (no
-- piloto o preço dependia do local; "domiciliar sem retorno" = sem linha).
create table public.service_locations (
  clinic_id uuid not null,
  service_id uuid not null,
  location_id uuid not null,
  price_cents integer check (price_cents >= 0),
  primary key (service_id, location_id),
  foreign key (clinic_id, service_id) references public.services (clinic_id, id) on delete cascade,
  foreign key (clinic_id, location_id) references public.locations (clinic_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Disponibilidade por agenda e local
-- ---------------------------------------------------------------------------
-- Une as duas tabelas do piloto: `service_id` restringe a janela a um serviço
-- (ex.: exame só na terça) e `capacity` define as vagas de uma turma.
create table public.availability_windows (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  agenda_id uuid not null,
  location_id uuid not null,
  service_id uuid,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  capacity integer check (capacity > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (clinic_id) references public.clinics (id) on delete cascade,
  foreign key (clinic_id, agenda_id) references public.agendas (clinic_id, id) on delete cascade,
  foreign key (clinic_id, location_id) references public.locations (clinic_id, id) on delete cascade,
  foreign key (clinic_id, service_id) references public.services (clinic_id, id) on delete cascade,
  check (start_time < end_time),
  check (capacity is null or service_id is not null)
);

create index availability_windows_agenda_idx on public.availability_windows (agenda_id, weekday);

-- ---------------------------------------------------------------------------
-- Feriados extras da clínica (municipais, estaduais, recesso…)
-- ---------------------------------------------------------------------------
create table public.clinic_holidays (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  date date not null,
  description text not null check (length(trim(description)) > 0),
  created_at timestamptz not null default now(),
  unique (clinic_id, date)
);

-- ---------------------------------------------------------------------------
-- Contatos que recebem o resumo do dia
-- ---------------------------------------------------------------------------
create table public.notification_recipients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  label text not null check (length(trim(label)) > 0),
  phone text not null check (phone ~ '^\+\d{10,15}$'),
  receives_consultations boolean not null default false,
  receives_exams boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, phone)
);

-- ---------------------------------------------------------------------------
-- Convênios e planos de saúde (D10)
-- ---------------------------------------------------------------------------
create table public.insurance_plans (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  -- Outros nomes pelos quais o paciente pode chamar o plano (busca).
  alternative_names text[] not null default '{}',
  ans_code text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, id)
);

create unique index insurance_plans_clinic_name_idx on public.insurance_plans (clinic_id, lower(name));

-- Por padrão todo profissional atende todos os planos; aqui ficam as exceções.
create table public.professional_insurance_exclusions (
  clinic_id uuid not null,
  professional_id uuid not null,
  insurance_plan_id uuid not null,
  primary key (professional_id, insurance_plan_id),
  foreign key (clinic_id, professional_id) references public.professionals (clinic_id, id) on delete cascade,
  foreign key (clinic_id, insurance_plan_id) references public.insurance_plans (clinic_id, id) on delete cascade
);

create function app.normalize_search_text(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(extensions.unaccent(trim(p_text)))
$$;

-- Planos ativos da clínica com nome parecido com o que o paciente digitou
-- (D10). Roda com as permissões de quem chama: o RLS garante que só aparecem
-- planos de uma clínica que a pessoa (ou o token do bot) pode ver.
create function public.search_insurance_plans(p_clinic_id uuid, p_query text)
returns table (id uuid, name text, score real)
language sql
stable
set search_path = ''
as $$
  with q as (select app.normalize_search_text(p_query) as value),
  candidates as (
    select
      p.id,
      p.name,
      (
        select max(greatest(
          extensions.similarity(app.normalize_search_text(n), q.value),
          extensions.word_similarity(q.value, app.normalize_search_text(n))
        ))
        from unnest(array[p.name] || p.alternative_names) as n
      ) as score
    from public.insurance_plans p, q
    where p.clinic_id = p_clinic_id
      and p.is_active
      and length(q.value) > 0
  )
  select id, name, score
  from candidates
  where score >= 0.3
  order by score desc, name
  limit 5
$$;

revoke execute on function public.search_insurance_plans(uuid, text) from public, anon;
grant execute on function public.search_insurance_plans(uuid, text) to authenticated, clinic_service;
grant execute on function app.normalize_search_text(text) to authenticated, clinic_service;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create trigger professionals_set_updated_at before update on public.professionals
  for each row execute function app.set_updated_at();
create trigger locations_set_updated_at before update on public.locations
  for each row execute function app.set_updated_at();
create trigger agendas_set_updated_at before update on public.agendas
  for each row execute function app.set_updated_at();
create trigger services_set_updated_at before update on public.services
  for each row execute function app.set_updated_at();
create trigger availability_windows_set_updated_at before update on public.availability_windows
  for each row execute function app.set_updated_at();
create trigger notification_recipients_set_updated_at before update on public.notification_recipients
  for each row execute function app.set_updated_at();
create trigger insurance_plans_set_updated_at before update on public.insurance_plans
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
select app.enable_clinic_config_rls('public.professionals');
select app.enable_clinic_config_rls('public.locations');
select app.enable_clinic_config_rls('public.agendas');
select app.enable_clinic_config_rls('public.services');
select app.enable_clinic_config_rls('public.service_agendas');
select app.enable_clinic_config_rls('public.service_locations');
select app.enable_clinic_config_rls('public.availability_windows');
select app.enable_clinic_config_rls('public.clinic_holidays');
select app.enable_clinic_config_rls('public.notification_recipients');
select app.enable_clinic_config_rls('public.insurance_plans');
select app.enable_clinic_config_rls('public.professional_insurance_exclusions');

-- Agendas e disponibilidade: cada membro vê só as agendas a que tem acesso.
drop policy agendas_select on public.agendas;
create policy agendas_select on public.agendas
  for select to authenticated
  using (app.can_access_agenda(id));

drop policy availability_windows_select on public.availability_windows;
create policy availability_windows_select on public.availability_windows
  for select to authenticated
  using (app.can_access_agenda(agenda_id));

-- Configuração geral: criada pelo gatilho junto com a clínica; nunca apagada
-- sozinha. Equipe lê, Administrador edita, bot lê.
alter table public.clinic_settings enable row level security;

create policy clinic_settings_select on public.clinic_settings
  for select to authenticated
  using (app.is_clinic_member(clinic_id));

create policy clinic_settings_update on public.clinic_settings
  for update to authenticated
  using (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]))
  with check (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]));

create policy clinic_settings_select_service on public.clinic_settings
  for select to clinic_service
  using (clinic_id = app.service_clinic_id());

create trigger clinic_settings_audit_platform_staff
  after insert or update or delete on public.clinic_settings
  for each row execute function app.audit_platform_staff_write();

-- Liberações de agenda: o Administrador gerencia; cada membro vê as suas.
alter table public.member_agenda_grants enable row level security;

create policy member_agenda_grants_select on public.member_agenda_grants
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[])
  );

create policy member_agenda_grants_insert on public.member_agenda_grants
  for insert to authenticated
  with check (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]));

create policy member_agenda_grants_delete on public.member_agenda_grants
  for delete to authenticated
  using (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]));

create trigger member_agenda_grants_audit_platform_staff
  after insert or update or delete on public.member_agenda_grants
  for each row execute function app.audit_platform_staff_write();

-- Tabelas criadas aqui recebem os grants das default privileges da F2.1;
-- clinic_settings não tem inserção nem exclusão pela API.
revoke insert, delete on public.clinic_settings from anon, authenticated, clinic_service;
