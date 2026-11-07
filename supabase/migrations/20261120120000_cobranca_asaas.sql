-- F12.4 — Faturamento do SaaS: cliente, assinatura e cobranças no Asaas, com o
-- espelho local.
--
-- Plano em docs/planejamento-faturamento-saas.md (seções 4 e 5; decisões 11.2,
-- 11.8, 11.11 e itens 20, 28 e 29 da seção 11; cliente, 28/out a 02/nov/2026):
--   1. no aceite do contrato (modo automático), o servidor cria no Asaas o
--      cliente (procura antes pelo CNPJ/CPF), a assinatura da mensalidade e a
--      cobrança da implantação, que vence no dia do aceite (item 29); os avisos
--      do Asaas ficam desligados (11.11);
--   2. o espelho (billing_charges) guarda cada cobrança do Asaas, com a
--      situação local: paga = CONFIRMED, RECEIVED ou RECEIVED_IN_CASH (11.2);
--   3. só o servidor grava, pela service role, por estas funções; o Suporte e o
--      Administrador da clínica leem; a trilha registra cada passo;
--   4. a inadimplência (non_payment) passa a valer: o banco só aceita com uma
--      cobrança do Asaas em aberto a partir do 15º dia de atraso (item 20); no
--      modo manual, segue recusada (item 28).
-- Mudança de versão de quem já tem assinatura e a troca de modo ficam para a
-- etapa seguinte; aqui, só a 1ª assinatura.

alter table public.billing_accounts add column asaas_customer_id text unique;

alter table public.billing_contracts
  add column asaas_subscription_id text unique,
  add column asaas_synced_at timestamptz,
  add column asaas_sync_error text check (asaas_sync_error is null or length(asaas_sync_error) <= 1000);

create table public.billing_charges (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  contract_id uuid references public.billing_contracts (id) on delete set null,
  origin text not null default 'asaas' check (origin in ('asaas', 'manual')),
  asaas_payment_id text unique,
  kind text not null check (kind in ('monthly', 'setup', 'other')),
  due_date date not null,
  value_cents integer not null check (value_cents >= 0),
  billing_type text,
  status text not null check (status in ('pending', 'paid', 'overdue', 'refunded', 'canceled', 'other')),
  raw_status text,
  paid_at timestamptz,
  invoice_url text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((origin = 'asaas') = (asaas_payment_id is not null))
);

create index billing_charges_clinic_idx on public.billing_charges (clinic_id, due_date desc);

alter table public.billing_audit_log drop constraint billing_audit_log_action_check;
alter table public.billing_audit_log add constraint billing_audit_log_action_check check (action in (
  'account_created', 'account_updated', 'contacts_updated', 'whatsapp_opt_in', 'whatsapp_opt_out',
  'contract_draft_saved', 'contract_draft_discarded', 'contract_activated', 'contract_ended',
  'contract_accepted', 'contract_notice_sent', 'contract_notice_failed',
  'clinic_suspended', 'suspension_released',
  'asaas_customer_linked', 'asaas_subscription_created', 'charge_created', 'charge_updated', 'asaas_sync_failed'
));

-- Situação local a partir da do Asaas (regra 2).
create function app.billing_charge_status(p_raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_raw in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH') then 'paid'
    when p_raw in ('PENDING', 'AWAITING_RISK_ANALYSIS') then 'pending'
    when p_raw = 'OVERDUE' then 'overdue'
    when p_raw in ('REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'PARTIALLY_REFUNDED',
                   'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL') then 'refunded'
    when p_raw = 'DELETED' then 'canceled'
    else 'other'
  end
$$;

-- ---------------------------------------------------------------------------
-- Gravações do servidor (service role)
-- ---------------------------------------------------------------------------
create function public.billing_link_asaas_customer(p_clinic_id uuid, p_customer_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.billing_accounts%rowtype;
begin
  select * into v_current from public.billing_accounts where clinic_id = p_clinic_id for update;
  if v_current.clinic_id is null then
    raise exception 'Conta de cobrança não encontrada.' using errcode = 'P0001', hint = 'billing_account_missing';
  end if;
  if v_current.asaas_customer_id is not distinct from p_customer_id then
    return;
  end if;
  update public.billing_accounts set asaas_customer_id = p_customer_id, updated_at = now() where clinic_id = p_clinic_id;
  perform app.log_billing(p_clinic_id, 'asaas_customer_linked',
    jsonb_build_object('asaas_customer_id', v_current.asaas_customer_id), jsonb_build_object('asaas_customer_id', p_customer_id));
end
$$;

create function public.billing_link_asaas_subscription(p_contract_id uuid, p_subscription_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.billing_contracts%rowtype;
begin
  select * into v_current from public.billing_contracts where id = p_contract_id for update;
  if v_current.id is null then
    raise exception 'Contrato não encontrado.' using errcode = 'P0001', hint = 'billing_contract_missing';
  end if;
  if v_current.asaas_subscription_id is not distinct from p_subscription_id then
    return;
  end if;
  update public.billing_contracts set asaas_subscription_id = p_subscription_id, updated_at = now() where id = p_contract_id;
  perform app.log_billing(v_current.clinic_id, 'asaas_subscription_created', null,
    jsonb_build_object('contract_id', p_contract_id, 'version', v_current.version, 'asaas_subscription_id', p_subscription_id));
end
$$;

-- Fim de uma tentativa de sincronizar: sem erro = em dia; com erro, fica na tela do Suporte e na trilha.
create function public.billing_record_asaas_sync(p_contract_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.billing_contracts%rowtype;
  v_error text := left(nullif(trim(coalesce(p_error, '')), ''), 1000);
begin
  select * into v_current from public.billing_contracts where id = p_contract_id for update;
  if v_current.id is null then
    raise exception 'Contrato não encontrado.' using errcode = 'P0001', hint = 'billing_contract_missing';
  end if;
  update public.billing_contracts
     set asaas_synced_at = case when v_error is null then now() else asaas_synced_at end,
         asaas_sync_error = v_error, updated_at = now()
   where id = p_contract_id;
  if v_error is not null and v_error is distinct from v_current.asaas_sync_error then
    perform app.log_billing(v_current.clinic_id, 'asaas_sync_failed', null, jsonb_build_object('contract_id', p_contract_id), v_error);
  end if;
end
$$;

-- Espelho de uma cobrança do Asaas (regra 2): cria ou atualiza; a trilha só quando muda a situação.
create function public.billing_upsert_asaas_charge(
  p_contract_id uuid,
  p_payment_id text,
  p_kind text,
  p_due_date date,
  p_value_cents integer,
  p_billing_type text,
  p_raw_status text,
  p_paid_at timestamptz,
  p_invoice_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract public.billing_contracts%rowtype;
  v_current public.billing_charges%rowtype;
  v_status text := app.billing_charge_status(p_raw_status);
begin
  select * into v_contract from public.billing_contracts where id = p_contract_id;
  if v_contract.id is null then
    raise exception 'Contrato não encontrado.' using errcode = 'P0001', hint = 'billing_contract_missing';
  end if;
  select * into v_current from public.billing_charges where asaas_payment_id = p_payment_id for update;
  if v_current.id is null then
    insert into public.billing_charges (clinic_id, contract_id, asaas_payment_id, kind, due_date, value_cents, billing_type,
      status, raw_status, paid_at, invoice_url, last_synced_at)
    values (v_contract.clinic_id, p_contract_id, p_payment_id, p_kind, p_due_date, p_value_cents, p_billing_type,
      v_status, p_raw_status, p_paid_at, p_invoice_url, now());
    perform app.log_billing(v_contract.clinic_id, 'charge_created', null, jsonb_build_object(
      'asaas_payment_id', p_payment_id, 'kind', p_kind, 'due_date', p_due_date, 'value_cents', p_value_cents, 'status', v_status));
    return;
  end if;
  update public.billing_charges
     set due_date = p_due_date, value_cents = p_value_cents, billing_type = p_billing_type, status = v_status,
         raw_status = p_raw_status, paid_at = p_paid_at, invoice_url = p_invoice_url, last_synced_at = now(), updated_at = now()
   where id = v_current.id;
  if v_current.status is distinct from v_status then
    perform app.log_billing(v_contract.clinic_id, 'charge_updated',
      jsonb_build_object('asaas_payment_id', p_payment_id, 'status', v_current.status),
      jsonb_build_object('asaas_payment_id', p_payment_id, 'status', v_status));
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Inadimplência (regra 4): cobrança do Asaas em aberto no 15º dia de atraso ou depois.
-- ---------------------------------------------------------------------------
create function app.billing_overdue_15(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.billing_charges
     where clinic_id = p_clinic_id and origin = 'asaas' and status in ('pending', 'overdue')
       and due_date + 15 <= app.billing_today()
  )
$$;

create or replace function public.suspend_clinic(p_clinic_id uuid, p_reason text, p_note text, p_no_app_confirmed boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic public.clinics%rowtype;
  v_note text := trim(coalesce(p_note, ''));
  v_id uuid;
begin
  if not app.is_platform_staff() then
    raise exception 'Só o Suporte suspende a clínica.' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('non_payment', 'administrative', 'contract_ended') then
    raise exception 'Escolha o motivo da suspensão.' using errcode = 'P0001', hint = 'suspension_reason';
  end if;
  if length(v_note) < 3 or length(v_note) > 1000 then
    raise exception 'Escreva o motivo (de 3 a 1.000 caracteres).' using errcode = 'P0001', hint = 'suspension_note';
  end if;

  perform 1 from public.billing_accounts where clinic_id = p_clinic_id for update;
  select * into v_clinic from public.clinics where id = p_clinic_id for update;
  if v_clinic.id is null then
    raise exception 'Clínica não encontrada.' using errcode = 'P0001', hint = 'clinic_missing';
  end if;
  -- Item 20: só a partir do 15º dia de atraso de uma cobrança do Asaas (no manual, nunca; item 28).
  if p_reason = 'non_payment' and not app.billing_overdue_15(p_clinic_id) then
    raise exception 'Inadimplência só com uma cobrança em aberto a partir do 15º dia de atraso.'
      using errcode = 'P0001', hint = 'suspension_non_payment_too_early';
  end if;
  if exists (select 1 from public.clinic_suspensions where clinic_id = p_clinic_id and reason = p_reason and released_at is null) then
    raise exception 'A clínica já está suspensa por este motivo.' using errcode = 'P0001', hint = 'suspension_reason_active';
  end if;
  if exists (select 1 from public.whatsapp_connections where clinic_id = p_clinic_id and status = 'connected' and not coexistence)
     and not coalesce(p_no_app_confirmed, false) then
    raise exception 'A clínica não usa o app WhatsApp Business: confirme que, suspensa, ninguém vai receber as mensagens dos pacientes.'
      using errcode = 'P0001', hint = 'suspension_no_app_confirm';
  end if;

  insert into public.clinic_suspensions (clinic_id, reason, note, created_by)
  values (p_clinic_id, p_reason, v_note, (select auth.uid()))
  returning id into v_id;

  if v_clinic.status <> 'suspended' then
    perform set_config('app.clinic_suspension', 'on', true);
    update public.clinics set status_before_suspension = v_clinic.status, status = 'suspended' where id = p_clinic_id;
    perform set_config('app.clinic_suspension', '', true);
  end if;

  perform app.log_billing(p_clinic_id, 'clinic_suspended',
    jsonb_build_object('status', v_clinic.status),
    jsonb_build_object('status', 'suspended', 'suspension_id', v_id, 'reason', p_reason, 'note', v_note));
  return v_id;
end
$$;

-- Para a tela do Suporte: a clínica já pode ser suspensa por inadimplência?
create function public.billing_can_suspend_for_non_payment(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_platform_staff() and app.billing_overdue_15(p_clinic_id)
$$;

create trigger billing_charges_audit_platform_staff
  after insert or update or delete on public.billing_charges
  for each row execute function app.audit_platform_staff_write();

alter table public.billing_charges enable row level security;
create policy billing_charges_select on public.billing_charges
  for select to authenticated using (
    app.is_platform_staff() or app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[])
  );
revoke insert, update, delete, truncate on public.billing_charges from authenticated;
revoke all on public.billing_charges from anon, clinic_service;

revoke execute on function public.billing_link_asaas_customer(uuid, text) from public, anon, authenticated, clinic_service;
revoke execute on function public.billing_link_asaas_subscription(uuid, text) from public, anon, authenticated, clinic_service;
revoke execute on function public.billing_record_asaas_sync(uuid, text) from public, anon, authenticated, clinic_service;
revoke execute on function public.billing_upsert_asaas_charge(uuid, text, text, date, integer, text, text, timestamptz, text) from public, anon, authenticated, clinic_service;
grant execute on function public.billing_link_asaas_customer(uuid, text) to service_role;
grant execute on function public.billing_link_asaas_subscription(uuid, text) to service_role;
grant execute on function public.billing_record_asaas_sync(uuid, text) to service_role;
grant execute on function public.billing_upsert_asaas_charge(uuid, text, text, date, integer, text, text, timestamptz, text) to service_role;
revoke execute on function public.billing_can_suspend_for_non_payment(uuid) from public, anon, clinic_service;
grant execute on function public.billing_can_suspend_for_non_payment(uuid) to authenticated;
revoke execute on function app.billing_overdue_15(uuid) from public, anon, clinic_service;

-- Bloqueio da suspensão (F12.3b): o espelho das cobranças é só do servidor, fora do bloqueio.
create or replace function app.suspension_free_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'billing_accounts', 'billing_audit_log', 'billing_contracts', 'billing_charges', 'clinic_suspensions',
    'platform_access_log', 'platform_audit_log', 'system_errors', 'job_runs', 'clinic_usage_monthly',
    'push_subscriptions'
  ]
$$;
