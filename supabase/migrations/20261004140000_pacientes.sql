-- F2.3 — Contatos e pacientes (D1, D4a, D10; D6: toda a equipe vê todos os pacientes).

-- Rotinas da plataforma (service role) também passam pelos gatilhos que usam `app`.
grant usage on schema app to service_role;

-- ---------------------------------------------------------------------------
-- Padrão de RLS das tabelas de dados do dia a dia
-- ---------------------------------------------------------------------------
-- Toda a equipe lê, cadastra e edita; só o Administrador apaga; o bot/agendador
-- (clinic_service) lê, cadastra e edita só na própria clínica; toda alteração
-- do Suporte fica registrada. As tabelas cujo acesso depende da agenda (F2.4)
-- trocam a política de leitura depois de chamar esta função.
create function app.enable_clinic_data_rls(p_table regclass)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_name text := (select relname from pg_class where oid = p_table);
  v_team text := 'app.has_clinic_role(clinic_id, array[''admin'', ''professional'', ''reception'']::public.clinic_role[])';
begin
  execute format('alter table %s enable row level security', p_table);
  execute format(
    'create policy %I on %s for select to authenticated using (app.is_clinic_member(clinic_id))',
    v_name || '_select', p_table);
  execute format(
    'create policy %I on %s for insert to authenticated with check (%s)',
    v_name || '_insert', p_table, v_team);
  execute format(
    'create policy %I on %s for update to authenticated using (%s) with check (%s)',
    v_name || '_update', p_table, v_team, v_team);
  execute format(
    'create policy %I on %s for delete to authenticated using (app.has_clinic_role(clinic_id, array[''admin'']::public.clinic_role[]))',
    v_name || '_delete', p_table);
  execute format(
    'create policy %I on %s for select to clinic_service using (clinic_id = app.service_clinic_id())',
    v_name || '_select_service', p_table);
  execute format(
    'create policy %I on %s for insert to clinic_service with check (clinic_id = app.service_clinic_id())',
    v_name || '_insert_service', p_table);
  execute format(
    'create policy %I on %s for update to clinic_service using (clinic_id = app.service_clinic_id()) with check (clinic_id = app.service_clinic_id())',
    v_name || '_update_service', p_table);
  execute format(
    'create trigger %I after insert or update or delete on %s for each row execute function app.audit_platform_staff_write()',
    v_name || '_audit_platform_staff', p_table);
end
$$;

-- Data de hoje no fuso da clínica (D4b).
create function app.clinic_today(p_clinic_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select timezone from public.clinic_settings where clinic_id = p_clinic_id),
    'America/Fortaleza'
  ))::date
$$;

-- ---------------------------------------------------------------------------
-- Contatos (antigo `guardians`): quem conversa no WhatsApp
-- ---------------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  full_name text not null check (length(trim(full_name)) > 0),
  phone text not null check (phone ~ '^\+\d{10,15}$'),
  default_home_address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, id),
  -- Único por clínica (no piloto era no banco inteiro).
  unique (clinic_id, phone)
);

-- ---------------------------------------------------------------------------
-- Pacientes: cuidados por um contato, que pode ser o próprio paciente (D4a)
-- ---------------------------------------------------------------------------
create table public.patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  contact_id uuid not null,
  full_name text not null check (length(trim(full_name)) > 0),
  birthdate date not null check (birthdate >= date '1900-01-01'),
  is_contact_self boolean not null default false,
  notes text,
  -- D10: nulo = particular.
  insurance_plan_id uuid,
  insurance_card_number text,
  insurance_card_valid_until date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, contact_id) references public.contacts (clinic_id, id),
  foreign key (clinic_id, insurance_plan_id) references public.insurance_plans (clinic_id, id),
  check (insurance_plan_id is not null or (insurance_card_number is null and insurance_card_valid_until is null))
);

create index patients_contact_idx on public.patients (contact_id);
create unique index patients_one_contact_self_idx on public.patients (contact_id) where is_contact_self;

-- Data de nascimento não pode ser futura (no fuso da clínica). Resolve no
-- banco o achado (1) da F1.2 (rota que comparava com o dia em UTC).
create function app.validate_patient_birthdate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.birthdate > app.clinic_today(new.clinic_id) then
    raise exception 'Data de nascimento no futuro.' using errcode = '22008', hint = 'invalid_birthdate';
  end if;
  return new;
end
$$;

create trigger patients_validate_birthdate
  before insert or update of birthdate on public.patients
  for each row execute function app.validate_patient_birthdate();

create trigger contacts_set_updated_at before update on public.contacts
  for each row execute function app.set_updated_at();
create trigger patients_set_updated_at before update on public.patients
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
select app.enable_clinic_data_rls('public.contacts');
select app.enable_clinic_data_rls('public.patients');

-- Apagar de vez é do Administrador; o bot nunca apaga.
revoke delete on public.contacts, public.patients from clinic_service;
