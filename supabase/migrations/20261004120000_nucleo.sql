-- F2.1 — Núcleo do schema multi-clínica (D1, D6).
--
-- Clínicas, membros com papéis por clínica, Suporte da plataforma, funções de
-- acesso usadas pelo RLS de todas as tabelas seguintes, credencial limitada à
-- clínica (bot e agendador) e registro das alterações feitas pelo Suporte.
--
-- Padrão de RLS para as próximas tabelas com `clinic_id`:
--   - leitura:  app.is_clinic_member(clinic_id)
--   - escrita:  app.has_clinic_role(clinic_id, array[...]::public.clinic_role[])
--   - bot/agendador: políticas próprias `to clinic_service` com
--                    clinic_id = app.service_clinic_id()
--   - gatilho app.audit_platform_staff_write() em toda tabela de dados.

-- ---------------------------------------------------------------------------
-- Papel do banco para a credencial limitada à clínica (D1)
-- ---------------------------------------------------------------------------
-- Um JWT com `role: "clinic_service"` e `clinic_id` faz o PostgREST trocar
-- para este papel; as políticas `to clinic_service` só deixam ver a clínica
-- do token. Substitui a service role (que ignora o RLS) no bot e no agendador
-- a partir da F3/F6.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'clinic_service') then
    create role clinic_service nologin noinherit;
  end if;
end
$$;

grant clinic_service to authenticator;
grant usage on schema public to clinic_service;

-- Tabelas futuras: o RLS decide o que cada papel vê; os grants só abrem a porta.
alter default privileges in schema public
  grant select, insert, update, delete on tables to clinic_service;
alter default privileges in schema public
  grant usage, select on sequences to clinic_service;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type public.clinic_role as enum ('admin', 'professional', 'reception');
create type public.clinic_status as enum ('active', 'suspended');

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  status public.clinic_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.clinics is
  'Clínicas (tenants). Perfil, identidade e fuso entram na F2.2.';

-- Uma pessoa (login do Supabase Auth) numa clínica, com um ou mais papéis
-- (ex.: Administrador + Profissional). Sem papel = sem acesso (D6).
create table public.clinic_members (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  roles public.clinic_role[] not null check (cardinality(roles) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (clinic_id, user_id)
);

create index clinic_members_user_id_idx on public.clinic_members (user_id);

-- Suporte RecepClinic: acesso permanente a todas as clínicas, com registro
-- (D6, revisão de 04/out/2026). Gerenciado só pela plataforma (service role).
create table public.platform_staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Alterações feitas pelo Suporte em dados de clínicas.
create table public.platform_audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid not null,
  clinic_id uuid,
  table_name text not null,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  old_row jsonb,
  new_row jsonb
);

create index platform_audit_log_clinic_idx on public.platform_audit_log (clinic_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Funções de acesso (schema `app`, fora da API)
-- ---------------------------------------------------------------------------
create schema app;
grant usage on schema app to anon, authenticated, clinic_service;

-- Clínica do token da credencial limitada; null para qualquer outro acesso.
-- Lê as claims direto da requisição (o papel clinic_service não tem acesso ao
-- schema `auth`, onde fica auth.jwt()).
create function app.service_clinic_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  with claims as (
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb as value
  )
  select case
    when value ->> 'role' = 'clinic_service' then nullif(value ->> 'clinic_id', '')::uuid
  end
  from claims
$$;

create function app.is_platform_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_staff where user_id = (select auth.uid())
  )
$$;

-- Membro da clínica, Suporte, ou credencial limitada àquela clínica.
create function app.is_clinic_member(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    app.is_platform_staff()
    or exists (
      select 1
      from public.clinic_members
      where clinic_id = p_clinic_id
        and user_id = (select auth.uid())
    )
    or app.service_clinic_id() = p_clinic_id
$$;

-- Tem pelo menos um dos papéis na clínica. O Suporte vale por todos.
create function app.has_clinic_role(p_clinic_id uuid, p_roles public.clinic_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    app.is_platform_staff()
    or exists (
      select 1
      from public.clinic_members
      where clinic_id = p_clinic_id
        and user_id = (select auth.uid())
        and roles && p_roles
    )
$$;

grant execute on function app.service_clinic_id() to anon, authenticated, clinic_service;
grant execute on function app.is_platform_staff() to anon, authenticated, clinic_service;
grant execute on function app.is_clinic_member(uuid) to anon, authenticated, clinic_service;
grant execute on function app.has_clinic_role(uuid, public.clinic_role[]) to anon, authenticated, clinic_service;

-- ---------------------------------------------------------------------------
-- Gatilhos
-- ---------------------------------------------------------------------------
create function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger clinics_set_updated_at
  before update on public.clinics
  for each row execute function app.set_updated_at();

create trigger clinic_members_set_updated_at
  before update on public.clinic_members
  for each row execute function app.set_updated_at();

-- A clínica nunca fica sem Administrador: não dá para remover nem tirar o
-- papel do último. (Apagar a clínica inteira continua possível.)
create function app.keep_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not ('admin' = any (old.roles)) then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and 'admin' = any (new.roles) then
    return new;
  end if;
  -- Exclusão em cascata da própria clínica.
  if not exists (select 1 from public.clinics where id = old.clinic_id) then
    return coalesce(new, old);
  end if;
  if not exists (
    select 1
    from public.clinic_members
    where clinic_id = old.clinic_id
      and user_id <> old.user_id
      and 'admin' = any (roles)
  ) then
    raise exception 'A clínica precisa de pelo menos um Administrador.'
      using errcode = 'P0001', hint = 'last_admin';
  end if;
  return coalesce(new, old);
end
$$;

create trigger clinic_members_keep_last_admin
  before update or delete on public.clinic_members
  for each row execute function app.keep_last_admin();

-- Registra toda alteração feita pelo Suporte. Ligado a cada tabela de dados
-- de clínica (as próximas etapas repetem o `create trigger`).
create function app.audit_platform_staff_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  if app.is_platform_staff() then
    insert into public.platform_audit_log (actor_user_id, clinic_id, table_name, operation, old_row, new_row)
    values (
      (select auth.uid()),
      coalesce(
        (v_row ->> 'clinic_id')::uuid,
        case when tg_table_name = 'clinics' then (v_row ->> 'id')::uuid end
      ),
      tg_table_name,
      tg_op,
      v_old,
      v_new
    );
  end if;
  return null;
end
$$;

create trigger clinics_audit_platform_staff
  after insert or update or delete on public.clinics
  for each row execute function app.audit_platform_staff_write();

create trigger clinic_members_audit_platform_staff
  after insert or update or delete on public.clinic_members
  for each row execute function app.audit_platform_staff_write();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.clinics enable row level security;
alter table public.clinic_members enable row level security;
alter table public.platform_staff enable row level security;
alter table public.platform_audit_log enable row level security;

-- clinics: membros veem a própria; Administrador edita; só o Suporte cria e
-- apaga (D6, L47: a clínica é criada pelo Suporte no P1).
create policy clinics_select on public.clinics
  for select to authenticated
  using (app.is_clinic_member(id));

create policy clinics_insert on public.clinics
  for insert to authenticated
  with check (app.is_platform_staff());

create policy clinics_update on public.clinics
  for update to authenticated
  using (app.has_clinic_role(id, array['admin']::public.clinic_role[]))
  with check (app.has_clinic_role(id, array['admin']::public.clinic_role[]));

create policy clinics_delete on public.clinics
  for delete to authenticated
  using (app.is_platform_staff());

create policy clinics_select_service on public.clinics
  for select to clinic_service
  using (id = app.service_clinic_id());

-- clinic_members: membros veem os colegas; só o Administrador mexe na equipe.
create policy clinic_members_select on public.clinic_members
  for select to authenticated
  using (app.is_clinic_member(clinic_id));

create policy clinic_members_insert on public.clinic_members
  for insert to authenticated
  with check (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]));

create policy clinic_members_update on public.clinic_members
  for update to authenticated
  using (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]))
  with check (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]));

create policy clinic_members_delete on public.clinic_members
  for delete to authenticated
  using (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]));

-- platform_staff: cada um vê se é do Suporte; o Suporte vê a lista.
create policy platform_staff_select on public.platform_staff
  for select to authenticated
  using (user_id = (select auth.uid()) or app.is_platform_staff());

-- platform_audit_log: o Suporte vê tudo; o Administrador vê o da sua clínica.
-- Ninguém grava pela API: só o gatilho (security definer).
create policy platform_audit_log_select on public.platform_audit_log
  for select to authenticated
  using (
    app.is_platform_staff()
    or (clinic_id is not null and app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]))
  );

-- Grants explícitos para as tabelas desta migração (as default privileges
-- valem para as próximas).
grant select on public.clinics to clinic_service;
revoke insert, update, delete on public.platform_audit_log from anon, authenticated;
revoke insert, update, delete on public.platform_staff from anon, authenticated;
