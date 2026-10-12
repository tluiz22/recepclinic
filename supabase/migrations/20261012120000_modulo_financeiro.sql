-- F11.1 — Módulo financeiro: item da matriz e dados financeiros de contato e
-- paciente (cliente, 12/out/2026).
--
-- Regras do cliente:
--   1. um item na matriz (D11), "Módulo financeiro (pagamentos e nota
--      fiscal)", numa área nova "Financeiro"; clínica nova começa sem ele;
--   2. CPF e responsável financeiro só existem dentro do módulo: tabelas
--      próprias, fora do cadastro (contacts e patients não mudam), que o bot
--      (clinic_service) não lê;
--   3. o responsável financeiro do paciente é, por padrão, o contato do
--      WhatsApp; pode ser o próprio paciente ou outra pessoa (nome e CPF);
--      só o CPF do responsável será exigido para a nota (F11.4);
--   4. privilégio mínimo: o Administrador e a Recepção leem e gravam; o
--      Profissional não vê; o Suporte só consulta;
--   5. anonimizar o paciente (F9.4) apaga esses dados (o do contato também,
--      porque o contato é anonimizado junto).

-- ---------------------------------------------------------------------------
-- Matriz de acesso
-- ---------------------------------------------------------------------------
alter table public.features drop constraint features_area_check;
alter table public.features
  add constraint features_area_check check (area in ('agenda', 'whatsapp', 'metrics', 'finance'));

insert into public.features (key, area, label, depends_on, sort_order) values
  ('finance', 'finance', 'Módulo financeiro (pagamentos e nota fiscal)', '{}', 180);

-- ---------------------------------------------------------------------------
-- CPF: 11 dígitos, sem máscara, com os dígitos verificadores certos
-- ---------------------------------------------------------------------------
create function app.is_valid_cpf(p_cpf text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_sum integer;
  v_check integer;
begin
  if p_cpf is null or p_cpf !~ '^[0-9]{11}$' or p_cpf = repeat(substr(p_cpf, 1, 1), 11) then
    return false;
  end if;
  for v_pos in 10..11 loop
    v_sum := 0;
    for i in 1..(v_pos - 1) loop
      v_sum := v_sum + substr(p_cpf, i, 1)::integer * (v_pos + 1 - i);
    end loop;
    v_check := (v_sum * 10) % 11 % 10;
    if v_check <> substr(p_cpf, v_pos, 1)::integer then
      return false;
    end if;
  end loop;
  return true;
end
$$;

-- ---------------------------------------------------------------------------
-- Quem lê e quem grava (regra 4). O Suporte entra em has_clinic_role como
-- todos os papéis; aqui ele só lê, então a gravação confere o vínculo real.
-- ---------------------------------------------------------------------------
create function app.can_read_finance(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_clinic_role(p_clinic_id, array['admin', 'reception']::public.clinic_role[])
$$;

create function app.can_edit_finance(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinic_members
     where clinic_id = p_clinic_id
       and user_id = (select auth.uid())
       and roles && array['admin', 'reception']::public.clinic_role[]
  )
$$;

grant execute on function app.can_read_finance(uuid), app.can_edit_finance(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Dados financeiros do contato (o CPF de quem conversa no WhatsApp)
-- ---------------------------------------------------------------------------
create table public.contact_finance (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  contact_id uuid primary key,
  cpf text check (cpf is null or app.is_valid_cpf(cpf)),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (clinic_id, contact_id) references public.contacts (clinic_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Dados financeiros do paciente (CPF opcional e o responsável financeiro)
-- ---------------------------------------------------------------------------
create table public.patient_finance (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid primary key,
  cpf text check (cpf is null or app.is_valid_cpf(cpf)),
  -- contact: o contato do WhatsApp (padrão); patient: o próprio paciente;
  -- other: outra pessoa, com nome e CPF.
  payer text not null default 'contact' check (payer in ('contact', 'patient', 'other')),
  payer_name text,
  payer_cpf text check (payer_cpf is null or app.is_valid_cpf(payer_cpf)),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (clinic_id, patient_id) references public.patients (clinic_id, id) on delete cascade,
  check (
    (payer = 'other' and length(trim(coalesce(payer_name, ''))) > 0 and payer_cpf is not null)
    or (payer <> 'other' and payer_name is null and payer_cpf is null)
  )
);

-- Item liberado para gravar; quem gravou e quando.
create function app.finance_row_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_feature(new.clinic_id, 'finance');
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  return new;
end
$$;

create trigger contact_finance_rules before insert or update on public.contact_finance
  for each row execute function app.finance_row_rules();
create trigger patient_finance_rules before insert or update on public.patient_finance
  for each row execute function app.finance_row_rules();

-- Registro do Suporte (F3), como toda tabela da clínica. Pela regra 4 o
-- Suporte não grava aqui; o gatilho fica pela regra geral.
create trigger contact_finance_audit_platform_staff
  after insert or update or delete on public.contact_finance
  for each row execute function app.audit_platform_staff_write();
create trigger patient_finance_audit_platform_staff
  after insert or update or delete on public.patient_finance
  for each row execute function app.audit_platform_staff_write();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.contact_finance enable row level security;
alter table public.patient_finance enable row level security;

create policy contact_finance_select on public.contact_finance
  for select to authenticated using (app.can_read_finance(clinic_id));
create policy contact_finance_insert on public.contact_finance
  for insert to authenticated with check (app.can_edit_finance(clinic_id));
create policy contact_finance_update on public.contact_finance
  for update to authenticated using (app.can_edit_finance(clinic_id)) with check (app.can_edit_finance(clinic_id));
create policy contact_finance_delete on public.contact_finance
  for delete to authenticated using (app.can_edit_finance(clinic_id));

create policy patient_finance_select on public.patient_finance
  for select to authenticated using (app.can_read_finance(clinic_id));
create policy patient_finance_insert on public.patient_finance
  for insert to authenticated with check (app.can_edit_finance(clinic_id));
create policy patient_finance_update on public.patient_finance
  for update to authenticated using (app.can_edit_finance(clinic_id)) with check (app.can_edit_finance(clinic_id));
create policy patient_finance_delete on public.patient_finance
  for delete to authenticated using (app.can_edit_finance(clinic_id));

-- O bot e o público nunca chegam nesses dados.
revoke all on public.contact_finance, public.patient_finance from anon, clinic_service;

-- ---------------------------------------------------------------------------
-- Anonimização (regra 5): paciente ou contato anonimizado perde os dados
-- financeiros. Notas e pagamentos (F11.2 em diante) ficam pelo prazo fiscal.
-- ---------------------------------------------------------------------------
create function app.drop_finance_on_anonymize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'patients' then
    delete from public.patient_finance where patient_id = new.id;
  else
    delete from public.contact_finance where contact_id = new.id;
  end if;
  return null;
end
$$;

create trigger patients_drop_finance after update of anonymized_at on public.patients
  for each row when (old.anonymized_at is null and new.anonymized_at is not null)
  execute function app.drop_finance_on_anonymize();
create trigger contacts_drop_finance after update of anonymized_at on public.contacts
  for each row when (old.anonymized_at is null and new.anonymized_at is not null)
  execute function app.drop_finance_on_anonymize();

-- Cópias no registro do Suporte: CPF e responsável também saem (F9.4).
create or replace function app.scrub_personal(p_row jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_row is null or jsonb_typeof(p_row) <> 'object' then p_row
    else (
      select coalesce(jsonb_object_agg(
        key,
        case when key in (
          'full_name', 'name', 'contact_name', 'patient_name', 'phone', 'contact_phone', 'birthdate', 'notes',
          'default_home_address', 'home_visit_address', 'home_address', 'address', 'insurance_card_number',
          'insurance_card_valid_until', 'body', 'context', 'cpf', 'payer_name', 'payer_cpf'
        ) and value <> 'null'::jsonb then to_jsonb('anonimizado'::text) else value end
      ), '{}'::jsonb)
      from jsonb_each(p_row)
    )
  end
$$;

revoke execute on function app.is_valid_cpf(text) from public, anon, clinic_service;
grant execute on function app.is_valid_cpf(text) to authenticated;
revoke execute on function app.drop_finance_on_anonymize() from public, anon, authenticated, clinic_service;
revoke execute on function app.finance_row_rules() from public, anon, authenticated, clinic_service;
