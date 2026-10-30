-- F12.2 — Faturamento do SaaS: contrato da clínica, com versões, e o preço
-- padrão por nota fiscal.
--
-- Plano em docs/planejamento-faturamento-saas.md (seções 3, 4 e 6; cliente,
-- 28/out e 29/out/2026) e docs/planejamento-nfse-asaas.md (seção 3). Sem
-- Asaas nesta fase: assinatura, cobranças e os ids do Asaas entram na F12.4.
--   1. contrato = modo de cobrança (automático pelo Asaas ou manual),
--      mensalidade, implantação (0 = isenta), forma de pagamento (só no
--      automático), 1º vencimento, preço por nota e franquia mensal de notas
--      (nula = ilimitada), retrato do plano de referência (informativo) e a
--      data de início;
--   2. só o Suporte escreve. O contrato nasce em rascunho (um por clínica),
--      que o Suporte altera, descarta ou ativa. Ativo não muda: mudança
--      comercial ou troca de modo = nova versão, com data de início depois da
--      vigente (decisões 11.7 e 11.17); ao ativar, a versão anterior é
--      encerrada na véspera do início da nova;
--   3. ativar exige a conta de cobrança (F12.1), sob a mesma trava da conta;
--   4. preço padrão por nota: parâmetro do Suporte, copiado para o rascunho e
--      negociável ali; mudar o padrão não muda contrato nenhum;
--   5. o Administrador da clínica lê o contrato ativo e as versões anteriores
--      (o rascunho, não); Recepção, Profissional e bot não leem; trilha em
--      billing_audit_log.

-- ---------------------------------------------------------------------------
-- Preço padrão por nota (regra 4): uma linha só; nulo = ainda não definido.
-- ---------------------------------------------------------------------------
create table public.billing_settings (
  id boolean primary key default true check (id),
  default_invoice_unit_price_cents integer check (default_invoice_unit_price_cents is null or default_invoice_unit_price_cents between 0 and 100000),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.billing_settings (id) values (true);

-- ---------------------------------------------------------------------------
-- Contrato (regras 1 e 2)
-- ---------------------------------------------------------------------------
create table public.billing_contracts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  -- Número da versão, dado ao ativar (o rascunho não tem).
  version integer check (version is null or version > 0),
  replaces_contract_id uuid references public.billing_contracts (id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'active', 'ended', 'canceled')),
  billing_mode text not null check (billing_mode in ('asaas', 'manual')),
  monthly_cents integer not null check (monthly_cents between 1 and 10000000),
  setup_cents integer not null default 0 check (setup_cents between 0 and 10000000),
  -- Só no automático; o manual é cobrado por fora.
  payment_method text check (payment_method in ('pix', 'credit_card')),
  first_due_date date not null,
  invoice_unit_price_cents integer not null check (invoice_unit_price_cents between 0 and 100000),
  invoice_monthly_allowance integer check (invoice_monthly_allowance is null or invoice_monthly_allowance between 0 and 100000),
  plan_snapshot jsonb not null default '{}'::jsonb,
  notes text check (notes is null or length(notes) <= 1000),
  starts_on date not null,
  ends_on date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_by uuid references auth.users (id) on delete set null,
  activated_at timestamptz,
  check ((billing_mode = 'asaas') = (payment_method is not null)),
  check (first_due_date >= starts_on),
  check (ends_on is null or ends_on >= starts_on - 1),
  -- Versão só depois de ativado; o rascunho descartado fica sem versão.
  check (case status when 'draft' then version is null when 'canceled' then true else version is not null end),
  unique (clinic_id, version)
);

create unique index billing_contracts_one_draft on public.billing_contracts (clinic_id) where status = 'draft';
create unique index billing_contracts_one_active on public.billing_contracts (clinic_id) where status = 'active';
create index billing_contracts_clinic_idx on public.billing_contracts (clinic_id, created_at desc);

-- Novas ações na trilha.
alter table public.billing_audit_log drop constraint billing_audit_log_action_check;
alter table public.billing_audit_log add constraint billing_audit_log_action_check check (action in (
  'account_created', 'account_updated', 'contacts_updated', 'whatsapp_opt_in', 'whatsapp_opt_out',
  'contract_draft_saved', 'contract_draft_discarded', 'contract_activated', 'contract_ended'
));

create function app.billing_contract_snapshot(p_contract public.billing_contracts)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_contract.id is null then null else jsonb_build_object(
    'contract_id', p_contract.id,
    'version', p_contract.version,
    'status', p_contract.status,
    'billing_mode', p_contract.billing_mode,
    'monthly_cents', p_contract.monthly_cents,
    'setup_cents', p_contract.setup_cents,
    'payment_method', p_contract.payment_method,
    'first_due_date', p_contract.first_due_date,
    'invoice_unit_price_cents', p_contract.invoice_unit_price_cents,
    'invoice_monthly_allowance', p_contract.invoice_monthly_allowance,
    'starts_on', p_contract.starts_on,
    'ends_on', p_contract.ends_on,
    'notes', p_contract.notes
  ) end
$$;

-- ---------------------------------------------------------------------------
-- Preço padrão por nota (só o Suporte).
-- ---------------------------------------------------------------------------
create function public.set_billing_default_invoice_price(p_cents integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_platform_staff() then
    raise exception 'Só o Suporte altera o preço padrão por nota.' using errcode = '42501';
  end if;
  if p_cents is null or p_cents < 0 or p_cents > 100000 then
    raise exception 'Preço por nota inválido.' using errcode = 'P0001', hint = 'billing_invoice_price';
  end if;
  update public.billing_settings
     set default_invoice_unit_price_cents = p_cents, updated_by = (select auth.uid()), updated_at = now()
   where id;
end
$$;

-- ---------------------------------------------------------------------------
-- Rascunho: cria ou altera o rascunho da clínica (só o Suporte).
-- ---------------------------------------------------------------------------
create function public.save_billing_contract_draft(
  p_clinic_id uuid,
  p_billing_mode text,
  p_monthly_cents integer,
  p_setup_cents integer,
  p_payment_method text,
  p_first_due_date date,
  p_invoice_unit_price_cents integer,
  p_invoice_monthly_allowance integer,
  p_starts_on date,
  p_plan_snapshot jsonb,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active public.billing_contracts%rowtype;
  v_draft public.billing_contracts%rowtype;
  v_saved public.billing_contracts%rowtype;
  v_method text := case when p_billing_mode = 'asaas' then p_payment_method end;
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
begin
  if not app.is_platform_staff() then
    raise exception 'Só o Suporte altera o contrato.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clinics where id = p_clinic_id) then
    raise exception 'Clínica não encontrada.' using errcode = 'P0001', hint = 'clinic_missing';
  end if;
  if p_billing_mode is null or p_billing_mode not in ('asaas', 'manual') then
    raise exception 'Escolha o modo de cobrança.' using errcode = 'P0001', hint = 'billing_mode';
  end if;
  if p_billing_mode = 'asaas' and (v_method is null or v_method not in ('pix', 'credit_card')) then
    raise exception 'Escolha a forma de pagamento.' using errcode = 'P0001', hint = 'billing_payment_method';
  end if;
  if p_starts_on is null or p_first_due_date is null or p_first_due_date < p_starts_on then
    raise exception 'O 1º vencimento não pode ser antes do início do contrato.' using errcode = 'P0001', hint = 'billing_dates';
  end if;

  -- A mesma trava da conta de cobrança (seção 7 do plano).
  perform 1 from public.billing_accounts where clinic_id = p_clinic_id for update;
  select * into v_active from public.billing_contracts where clinic_id = p_clinic_id and status = 'active';
  if v_active.id is not null and p_starts_on <= v_active.starts_on then
    raise exception 'A nova versão começa depois do início da vigente (%).', to_char(v_active.starts_on, 'DD/MM/YYYY')
      using errcode = 'P0001', hint = 'billing_starts_on';
  end if;

  select * into v_draft from public.billing_contracts where clinic_id = p_clinic_id and status = 'draft' for update;
  if v_draft.id is null then
    insert into public.billing_contracts (clinic_id, replaces_contract_id, billing_mode, monthly_cents, setup_cents, payment_method,
      first_due_date, invoice_unit_price_cents, invoice_monthly_allowance, plan_snapshot, notes, starts_on, created_by)
    values (p_clinic_id, v_active.id, p_billing_mode, p_monthly_cents, coalesce(p_setup_cents, 0), v_method,
      p_first_due_date, p_invoice_unit_price_cents, p_invoice_monthly_allowance, coalesce(p_plan_snapshot, '{}'::jsonb), v_notes, p_starts_on, (select auth.uid()))
    returning * into v_saved;
  else
    update public.billing_contracts
       set replaces_contract_id = v_active.id, billing_mode = p_billing_mode, monthly_cents = p_monthly_cents,
           setup_cents = coalesce(p_setup_cents, 0), payment_method = v_method, first_due_date = p_first_due_date,
           invoice_unit_price_cents = p_invoice_unit_price_cents, invoice_monthly_allowance = p_invoice_monthly_allowance,
           plan_snapshot = coalesce(p_plan_snapshot, '{}'::jsonb), notes = v_notes, starts_on = p_starts_on, updated_at = now()
     where id = v_draft.id
     returning * into v_saved;
  end if;
  if app.billing_contract_snapshot(v_saved) is distinct from app.billing_contract_snapshot(v_draft) then
    perform app.log_billing(p_clinic_id, 'contract_draft_saved', app.billing_contract_snapshot(v_draft), app.billing_contract_snapshot(v_saved));
  end if;
  return v_saved.id;
end
$$;

-- Descarta o rascunho (fica como cancelado, na trilha).
create function public.discard_billing_contract_draft(p_clinic_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft public.billing_contracts%rowtype;
  v_saved public.billing_contracts%rowtype;
begin
  if not app.is_platform_staff() then
    raise exception 'Só o Suporte altera o contrato.' using errcode = '42501';
  end if;
  select * into v_draft from public.billing_contracts where clinic_id = p_clinic_id and status = 'draft' for update;
  if v_draft.id is null then
    raise exception 'Não há rascunho de contrato.' using errcode = 'P0001', hint = 'billing_draft_missing';
  end if;
  update public.billing_contracts set status = 'canceled', updated_at = now() where id = v_draft.id returning * into v_saved;
  perform app.log_billing(p_clinic_id, 'contract_draft_discarded', app.billing_contract_snapshot(v_draft), app.billing_contract_snapshot(v_saved));
end
$$;

-- ---------------------------------------------------------------------------
-- Ativa o rascunho (regras 2 e 3): a vigente é encerrada na véspera.
-- ---------------------------------------------------------------------------
create function public.activate_billing_contract(p_clinic_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft public.billing_contracts%rowtype;
  v_active public.billing_contracts%rowtype;
  v_ended public.billing_contracts%rowtype;
  v_saved public.billing_contracts%rowtype;
  v_version integer;
begin
  if not app.is_platform_staff() then
    raise exception 'Só o Suporte ativa o contrato.' using errcode = '42501';
  end if;
  perform 1 from public.billing_accounts where clinic_id = p_clinic_id for update;
  if not found then
    raise exception 'Cadastre antes a conta de cobrança.' using errcode = 'P0001', hint = 'billing_account_missing';
  end if;
  select * into v_draft from public.billing_contracts where clinic_id = p_clinic_id and status = 'draft' for update;
  if v_draft.id is null then
    raise exception 'Não há rascunho de contrato.' using errcode = 'P0001', hint = 'billing_draft_missing';
  end if;
  select * into v_active from public.billing_contracts where clinic_id = p_clinic_id and status = 'active' for update;
  if v_active.id is not null then
    if v_draft.starts_on <= v_active.starts_on then
      raise exception 'A nova versão começa depois do início da vigente (%).', to_char(v_active.starts_on, 'DD/MM/YYYY')
        using errcode = 'P0001', hint = 'billing_starts_on';
    end if;
    update public.billing_contracts set status = 'ended', ends_on = v_draft.starts_on - 1, updated_at = now()
     where id = v_active.id returning * into v_ended;
    perform app.log_billing(p_clinic_id, 'contract_ended', app.billing_contract_snapshot(v_active), app.billing_contract_snapshot(v_ended),
      'Vale até a véspera do início da nova versão.');
  end if;

  select coalesce(max(version), 0) + 1 into v_version from public.billing_contracts where clinic_id = p_clinic_id;
  update public.billing_contracts
     set status = 'active', version = v_version, replaces_contract_id = v_active.id,
         activated_by = (select auth.uid()), activated_at = now(), updated_at = now()
   where id = v_draft.id
   returning * into v_saved;
  perform app.log_billing(p_clinic_id, 'contract_activated', app.billing_contract_snapshot(v_draft), app.billing_contract_snapshot(v_saved));
end
$$;

-- Registro do Suporte (F3).
create trigger billing_contracts_audit_platform_staff
  after insert or update or delete on public.billing_contracts
  for each row execute function app.audit_platform_staff_write();
create trigger billing_settings_audit_platform_staff
  after insert or update or delete on public.billing_settings
  for each row execute function app.audit_platform_staff_write();

-- ---------------------------------------------------------------------------
-- RLS (regra 5)
-- ---------------------------------------------------------------------------
alter table public.billing_settings enable row level security;
alter table public.billing_contracts enable row level security;

create policy billing_settings_select on public.billing_settings
  for select to authenticated using (app.is_platform_staff());
create policy billing_contracts_select on public.billing_contracts
  for select to authenticated using (
    app.is_platform_staff()
    or (status in ('active', 'ended') and app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]))
  );

revoke insert, update, delete, truncate on public.billing_settings, public.billing_contracts from authenticated;
revoke all on public.billing_settings, public.billing_contracts from anon, clinic_service;

revoke execute on function public.set_billing_default_invoice_price(integer) from public, anon, clinic_service;
revoke execute on function public.save_billing_contract_draft(uuid, text, integer, integer, text, date, integer, integer, date, jsonb, text) from public, anon, clinic_service;
revoke execute on function public.discard_billing_contract_draft(uuid) from public, anon, clinic_service;
revoke execute on function public.activate_billing_contract(uuid) from public, anon, clinic_service;
grant execute on function public.set_billing_default_invoice_price(integer) to authenticated;
grant execute on function public.save_billing_contract_draft(uuid, text, integer, integer, text, date, integer, integer, date, jsonb, text) to authenticated;
grant execute on function public.discard_billing_contract_draft(uuid) to authenticated;
grant execute on function public.activate_billing_contract(uuid) to authenticated;
revoke execute on function app.billing_contract_snapshot(public.billing_contracts) from public, anon, clinic_service;
