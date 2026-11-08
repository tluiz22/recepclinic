-- N4b — Cobrança das notas por pagador (planejamento-nfse-asaas.md, seções 3,
-- 14.2 e 14.7; cliente, 07/nov/2026).
--
--   1. N-P3: emissores pagos pela clínica (o dela e o do dono "junto da
--      clínica") somam na franquia do contrato da clínica; o que passar é
--      cobrado pelo preço por nota do contrato, em cobrança avulsa separada;
--   2. N-P4: o profissional pagador tem contrato próprio de notas (taxa mensal
--      + preço por nota + franquia), com os valores do Suporte e o aceite dele
--      (N-P6: com login); sem contrato aceito, o emissor dele não emite;
--   3. vencimento junto da mensalidade da clínica (dia do vencimento do
--      contrato dela); apuração do mês anterior no começo do mês;
--   4. N-P5: cobrança do profissional vencida há 15 dias ou mais suspende só a
--      emissão daquele emissor; paga, volta sozinha;
--   5. contam as notas autorizadas no mês (as canceladas depois também: a
--      tarifa do Asaas não volta); recusadas não.
--
-- Reversão: drop das tabelas fiscal_issuer_contracts e fiscal_usage_charges e
-- das funções; restaurar app.nfse_requires_signed_contract da 20261231140000.

-- ---------------------------------------------------------------------------
-- Contrato de notas do profissional (regra 2)
-- ---------------------------------------------------------------------------
create table public.fiscal_issuer_contracts (
  issuer_id uuid primary key,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  monthly_fee_cents integer not null check (monthly_fee_cents between 0 and 1000000),
  unit_price_cents integer not null check (unit_price_cents between 0 and 100000),
  monthly_allowance integer not null default 0 check (monthly_allowance between 0 and 100000),
  status text not null default 'draft' check (status in ('draft', 'active')),
  terms_version text,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  asaas_customer_id text,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (clinic_id, issuer_id) references public.fiscal_issuers (clinic_id, id) on delete cascade,
  check ((status = 'active') = (accepted_at is not null and terms_version is not null))
);

-- ---------------------------------------------------------------------------
-- Cobranças das notas (regras 1, 3 e 4)
-- ---------------------------------------------------------------------------
create table public.fiscal_usage_charges (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  -- null: as notas pagas pela clínica; preenchido: o profissional pagador.
  issuer_id uuid references public.fiscal_issuers (id) on delete set null,
  period date not null check (extract(day from period) = 1),
  notes_count integer not null check (notes_count >= 0),
  allowance integer not null check (allowance >= 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  fee_cents integer not null default 0 check (fee_cents >= 0),
  amount_cents integer not null check (amount_cents >= 0),
  due_date date not null,
  -- creating: a criar no Asaas; manual: cobrado por fora (contrato manual); none: nada a cobrar.
  status text not null default 'creating' check (status in ('creating', 'manual', 'none', 'pending', 'paid', 'overdue', 'refunded', 'canceled', 'other')),
  asaas_payment_id text unique,
  invoice_url text,
  paid_at timestamptz,
  error text check (error is null or length(error) <= 500),
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index fiscal_usage_charges_clinic_once on public.fiscal_usage_charges (clinic_id, period) where issuer_id is null;
create unique index fiscal_usage_charges_issuer_once on public.fiscal_usage_charges (issuer_id, period) where issuer_id is not null;
create index fiscal_usage_charges_open_idx on public.fiscal_usage_charges (status, last_synced_at) where status in ('creating', 'pending', 'overdue');

create trigger fiscal_issuer_contracts_audit_platform_staff
  after insert or update or delete on public.fiscal_issuer_contracts
  for each row execute function app.audit_platform_staff_write();
create trigger fiscal_usage_charges_audit_platform_staff
  after insert or update or delete on public.fiscal_usage_charges
  for each row execute function app.audit_platform_staff_write();
-- Ficam fora do bloqueio da clínica suspensa (como a Assinatura): a cobrança segue.
create trigger fiscal_issuer_contracts_guard_suspended before insert or update or delete on public.fiscal_issuer_contracts
  for each row execute function app.guard_suspended_clinic_write();
create trigger fiscal_usage_charges_guard_suspended before insert or update or delete on public.fiscal_usage_charges
  for each row execute function app.guard_suspended_clinic_write();

alter table public.fiscal_issuer_contracts enable row level security;
alter table public.fiscal_usage_charges enable row level security;

create policy fiscal_issuer_contracts_select on public.fiscal_issuer_contracts
  for select to authenticated using (
    exists (select 1 from public.fiscal_issuers i where i.id = issuer_id and app.can_manage_fiscal_issuer(i.clinic_id, i.professional_id))
  );
create policy fiscal_usage_charges_select on public.fiscal_usage_charges
  for select to authenticated using (
    app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[])
    or exists (select 1 from public.fiscal_issuers i where i.id = issuer_id and i.professional_id is not null and i.professional_id = app.own_professional_id(i.clinic_id))
  );
revoke insert, update, delete on public.fiscal_issuer_contracts, public.fiscal_usage_charges from authenticated;
revoke all on public.fiscal_issuer_contracts, public.fiscal_usage_charges from anon, clinic_service;

-- ---------------------------------------------------------------------------
-- Gravações do painel
-- ---------------------------------------------------------------------------
-- Suporte: valores do contrato do profissional. Mudou valor, volta a rascunho
-- e o profissional aceita de novo.
create function public.save_fiscal_issuer_contract(p_issuer_id uuid, p_fee_cents integer, p_unit_price_cents integer, p_allowance integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issuer public.fiscal_issuers%rowtype;
  v_current public.fiscal_issuer_contracts%rowtype;
begin
  if not app.is_platform_staff() then
    raise exception 'Só o Suporte define os valores do contrato de notas.' using errcode = '42501';
  end if;
  select * into v_issuer from public.fiscal_issuers where id = p_issuer_id;
  if v_issuer.id is null or v_issuer.kind <> 'professional' then
    raise exception 'Contrato de notas só para o emissor de um profissional.' using errcode = 'P0001', hint = 'issuer_contract_kind';
  end if;
  select * into v_current from public.fiscal_issuer_contracts where issuer_id = p_issuer_id for update;
  if v_current.issuer_id is null then
    insert into public.fiscal_issuer_contracts (issuer_id, clinic_id, monthly_fee_cents, unit_price_cents, monthly_allowance, updated_by)
    values (p_issuer_id, v_issuer.clinic_id, p_fee_cents, p_unit_price_cents, p_allowance, (select auth.uid()));
  elsif (v_current.monthly_fee_cents, v_current.unit_price_cents, v_current.monthly_allowance) is distinct from (p_fee_cents, p_unit_price_cents, p_allowance) then
    update public.fiscal_issuer_contracts
       set monthly_fee_cents = p_fee_cents, unit_price_cents = p_unit_price_cents, monthly_allowance = p_allowance,
           status = 'draft', accepted_at = null, accepted_by = null, terms_version = null,
           updated_by = (select auth.uid()), updated_at = now()
     where issuer_id = p_issuer_id;
  end if;
end
$$;

-- O próprio profissional (com login) aceita.
create function public.accept_fiscal_issuer_contract(p_issuer_id uuid, p_terms_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issuer public.fiscal_issuers%rowtype;
begin
  select * into v_issuer from public.fiscal_issuers where id = p_issuer_id;
  if v_issuer.id is null or v_issuer.professional_id is null or v_issuer.professional_id is distinct from app.own_professional_id(v_issuer.clinic_id) then
    raise exception 'Só o próprio profissional aceita o contrato de notas.' using errcode = '42501';
  end if;
  if length(coalesce(trim(p_terms_version), '')) = 0 then
    raise exception 'Leia e aceite os termos.' using errcode = 'P0001', hint = 'issuer_contract_terms';
  end if;
  update public.fiscal_issuer_contracts
     set status = 'active', terms_version = p_terms_version, accepted_at = now(), accepted_by = (select auth.uid())
   where issuer_id = p_issuer_id and status = 'draft';
  if not found then
    raise exception 'Não há contrato de notas para aceitar.' using errcode = 'P0001', hint = 'issuer_contract_missing';
  end if;
end
$$;

-- A emissão pelo emissor do profissional pagador espera o contrato aceito.
create or replace function app.nfse_requires_signed_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.provider = 'asaas' and exists (select 1 from public.fiscal_issuers where id = new.issuer_id and payer = 'professional') then
    if not exists (select 1 from public.fiscal_issuer_contracts where issuer_id = new.issuer_id and status = 'active') then
      raise exception 'A emissão pelo CNPJ deste profissional começa depois que ele aceitar o contrato de notas (Minha nota fiscal).'
        using errcode = 'P0001', hint = 'nfse_issuer_contract';
    end if;
    return new;
  end if;
  if not app.billing_invoicing_signed(new.clinic_id) then
    raise exception 'A emissão de nota fiscal só começa depois que o Administrador assinar o contrato com nota fiscal, em Configurações › Assinatura.'
      using errcode = 'P0001', hint = 'nfse_contract';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Apuração (regras 1, 3 e 5)
-- ---------------------------------------------------------------------------
create function app.fiscal_notes_count(p_issuers uuid[], p_period date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.nfse_invoices
   where provider = 'asaas' and issuer_id = any (p_issuers)
     and status in ('issued', 'canceling', 'canceled')
     and (issued_at at time zone 'America/Sao_Paulo')::date >= p_period
     and (issued_at at time zone 'America/Sao_Paulo')::date < (p_period + interval '1 month')::date
$$;

-- Vencimento junto da mensalidade (regra 3): o dia do vencimento do contrato
-- da clínica, no primeiro mês em que ainda não passou.
create function app.fiscal_charge_due_date(p_clinic_id uuid, p_today date)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day integer;
  v_month date := date_trunc('month', p_today)::date;
  v_due date;
begin
  select extract(day from first_due_date)::integer into v_day
    from public.billing_contracts where clinic_id = p_clinic_id and status = 'active'
   order by version desc limit 1;
  v_day := coalesce(v_day, 10);
  v_due := v_month + (least(v_day, extract(day from (v_month + interval '1 month - 1 day'))::integer) - 1);
  if v_due <= p_today then
    v_month := (v_month + interval '1 month')::date;
    v_due := v_month + (least(v_day, extract(day from (v_month + interval '1 month - 1 day'))::integer) - 1);
  end if;
  return v_due;
end
$$;

-- Apura o mês (primeiro dia em p_period) e cria as linhas que faltam. Só o
-- servidor; repetir não duplica.
create function public.platform_compute_fiscal_usage(p_period date, p_today date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract record;
  v_issuer record;
  v_ids uuid[];
  v_count integer;
  v_over integer;
  v_amount integer;
  v_created integer := 0;
begin
  -- Notas pagas pela clínica (o emissor dela e os "junto da clínica").
  for v_contract in
    select distinct on (c.clinic_id) c.clinic_id, c.invoice_unit_price_cents, coalesce(c.invoice_monthly_allowance, 0) as allowance, c.billing_mode
      from public.billing_contracts c
     where c.status in ('active', 'ended') and c.invoice_unit_price_cents is not null
       and c.starts_on <= (p_period + interval '1 month - 1 day')::date and (c.ends_on is null or c.ends_on >= p_period)
     order by c.clinic_id, c.version desc
  loop
    select array_agg(id) into v_ids from public.fiscal_issuers where clinic_id = v_contract.clinic_id and payer = 'clinic';
    if v_ids is null then continue; end if;
    v_count := app.fiscal_notes_count(v_ids, p_period);
    if v_count = 0 then continue; end if;
    v_over := greatest(v_count - v_contract.allowance, 0);
    v_amount := v_over * v_contract.invoice_unit_price_cents;
    insert into public.fiscal_usage_charges (clinic_id, issuer_id, period, notes_count, allowance, unit_price_cents, amount_cents, due_date, status)
    values (v_contract.clinic_id, null, p_period, v_count, v_contract.allowance, v_contract.invoice_unit_price_cents, v_amount,
            app.fiscal_charge_due_date(v_contract.clinic_id, p_today),
            case when v_amount = 0 then 'none' when v_contract.billing_mode = 'manual' then 'manual' else 'creating' end)
    on conflict do nothing;
    if found then v_created := v_created + 1; end if;
  end loop;

  -- Profissional pagador: taxa mensal + notas acima da franquia (regra 2).
  for v_issuer in
    select i.id, i.clinic_id, k.monthly_fee_cents, k.unit_price_cents, k.monthly_allowance
      from public.fiscal_issuers i join public.fiscal_issuer_contracts k on k.issuer_id = i.id
     where i.payer = 'professional' and k.status = 'active' and k.accepted_at < (p_period + interval '1 month')
  loop
    v_count := app.fiscal_notes_count(array[v_issuer.id], p_period);
    v_amount := v_issuer.monthly_fee_cents + greatest(v_count - v_issuer.monthly_allowance, 0) * v_issuer.unit_price_cents;
    insert into public.fiscal_usage_charges (clinic_id, issuer_id, period, notes_count, allowance, unit_price_cents, fee_cents, amount_cents, due_date, status)
    values (v_issuer.clinic_id, v_issuer.id, p_period, v_count, v_issuer.monthly_allowance, v_issuer.unit_price_cents, v_issuer.monthly_fee_cents,
            v_amount, app.fiscal_charge_due_date(v_issuer.clinic_id, p_today), case when v_amount = 0 then 'none' else 'creating' end)
    on conflict do nothing;
    if found then v_created := v_created + 1; end if;
  end loop;
  return v_created;
end
$$;

-- Situação vinda do Asaas.
create function public.platform_set_fiscal_usage_charge(
  p_id uuid, p_asaas_payment_id text, p_raw_status text, p_invoice_url text, p_paid_at timestamptz, p_error text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.fiscal_usage_charges
     set asaas_payment_id = coalesce(p_asaas_payment_id, asaas_payment_id),
         status = case when p_raw_status is null then status else app.billing_charge_status(p_raw_status) end,
         invoice_url = coalesce(p_invoice_url, invoice_url), paid_at = coalesce(p_paid_at, paid_at),
         error = left(p_error, 500), last_synced_at = now()
   where id = p_id
$$;

create function public.platform_set_issuer_contract_customer(p_issuer_id uuid, p_customer text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.fiscal_issuer_contracts set asaas_customer_id = p_customer where issuer_id = p_issuer_id
$$;

-- Suspende e libera (regra 4): cobrança do profissional vencida há 15 dias.
create function public.platform_apply_issuer_suspensions(p_today date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issuer record;
  v_changed integer := 0;
begin
  for v_issuer in
    select i.id, i.clinic_id, i.suspended_at,
           exists (select 1 from public.fiscal_usage_charges c
                    where c.issuer_id = i.id and c.status in ('pending', 'overdue') and c.due_date <= p_today - 15) as overdue
      from public.fiscal_issuers i
     where i.payer = 'professional' or i.suspended_at is not null
  loop
    if v_issuer.overdue and v_issuer.suspended_at is null then
      update public.fiscal_issuers set suspended_at = now(), suspended_reason = 'Cobrança das notas vencida há 15 dias ou mais.' where id = v_issuer.id;
      insert into public.fiscal_audit_log (clinic_id, issuer_id, event) values (v_issuer.clinic_id, v_issuer.id, 'issuer_suspended');
      v_changed := v_changed + 1;
    elsif not v_issuer.overdue and v_issuer.suspended_at is not null then
      update public.fiscal_issuers set suspended_at = null, suspended_reason = null where id = v_issuer.id;
      insert into public.fiscal_audit_log (clinic_id, issuer_id, event) values (v_issuer.clinic_id, v_issuer.id, 'issuer_released');
      v_changed := v_changed + 1;
    end if;
  end loop;
  return v_changed;
end
$$;

revoke execute on function public.save_fiscal_issuer_contract(uuid, integer, integer, integer) from public, anon, clinic_service;
revoke execute on function public.accept_fiscal_issuer_contract(uuid, text) from public, anon, clinic_service;
grant execute on function public.save_fiscal_issuer_contract(uuid, integer, integer, integer) to authenticated;
grant execute on function public.accept_fiscal_issuer_contract(uuid, text) to authenticated;
revoke execute on function app.fiscal_notes_count(uuid[], date) from public, anon, authenticated, clinic_service;
revoke execute on function app.fiscal_charge_due_date(uuid, date) from public, anon, authenticated, clinic_service;
revoke execute on function public.platform_compute_fiscal_usage(date, date) from public, anon, authenticated, clinic_service;
revoke execute on function public.platform_set_fiscal_usage_charge(uuid, text, text, text, timestamptz, text) from public, anon, authenticated, clinic_service;
revoke execute on function public.platform_set_issuer_contract_customer(uuid, text) from public, anon, authenticated, clinic_service;
revoke execute on function public.platform_apply_issuer_suspensions(date) from public, anon, authenticated, clinic_service;
grant execute on function public.platform_compute_fiscal_usage(date, date) to service_role;
grant execute on function public.platform_set_fiscal_usage_charge(uuid, text, text, text, timestamptz, text) to service_role;
grant execute on function public.platform_set_issuer_contract_customer(uuid, text) to service_role;
grant execute on function public.platform_apply_issuer_suspensions(date) to service_role;

-- Tela do pagamento: o emissor do profissional pagador precisa do contrato de notas aceito.
create or replace function public.fiscal_issuer_for_appointment(p_appointment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_professional uuid;
  v_issuer public.fiscal_issuers%rowtype;
  v_issuer_id uuid;
begin
  select a.clinic_id, ag.professional_id into v_clinic, v_professional
    from public.appointments a join public.agendas ag on ag.id = a.agenda_id
   where a.id = p_appointment_id;
  if v_clinic is null or not app.can_read_finance(v_clinic) then
    return null;
  end if;
  v_issuer_id := case
    when v_professional is null then (select id from public.fiscal_issuers where clinic_id = v_clinic and kind = 'clinic')
    else app.fiscal_issuer_for_professional(v_clinic, v_professional)
  end;
  if v_issuer_id is null then
    return jsonb_build_object('issuer_id', null,
      'route_none', v_professional is not null and exists (select 1 from public.professional_fiscal_routes where professional_id = v_professional and mode = 'none'));
  end if;
  select * into v_issuer from public.fiscal_issuers where id = v_issuer_id;
  return jsonb_build_object(
    'issuer_id', v_issuer.id,
    'kind', v_issuer.kind,
    'legal_name', v_issuer.legal_name,
    'environment', v_issuer.environment,
    'issuing_enabled', v_issuer.issuing_enabled,
    'suspended', v_issuer.suspended_at is not null,
    'supports_cancellation', coalesce((v_issuer.municipal_options ->> 'supportsCancellation')::boolean, true),
    'contract_ok', case when v_issuer.payer = 'professional'
      then exists (select 1 from public.fiscal_issuer_contracts where issuer_id = v_issuer.id and status = 'active')
      else app.billing_invoicing_signed(v_clinic) end,
    'payer', v_issuer.payer,
    'route_none', false
  );
end
$$;

