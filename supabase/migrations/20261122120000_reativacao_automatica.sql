-- F12.6 — Faturamento do SaaS: reativação automática com trava.
--
-- Plano em docs/planejamento-faturamento-saas.md (fluxos 9 e 10; decisões
-- 11.1 e 11.2; seção 7, concorrência):
--   1. cada cobrança que fica paga (CONFIRMED, RECEIVED ou RECEIVED_IN_CASH)
--      tenta reativar a clínica, na mesma trava da conta de cobrança;
--   2. só libera a inadimplência, e só sem nenhuma cobrança do Asaas vencida em
--      aberto (vencimento antes de hoje, em Brasília); outros motivos ficam;
--   3. sem outro motivo ativo, a clínica volta à situação de antes;
--   4. quem libera é o sistema (released_by nulo), com o pagamento na trilha.

-- Cobrança do Asaas vencida e ainda em aberto.
create function app.billing_has_overdue_open(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.billing_charges
     where clinic_id = p_clinic_id and origin = 'asaas' and status in ('pending', 'overdue') and due_date < app.billing_today()
  )
$$;

-- Regras 1 a 4; devolve verdadeiro se liberou a inadimplência.
create function app.billing_try_reactivate(p_clinic_id uuid, p_payment_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic public.clinics%rowtype;
  v_row public.clinic_suspensions%rowtype;
  v_restored public.clinic_status;
begin
  perform 1 from public.billing_accounts where clinic_id = p_clinic_id for update;
  select * into v_clinic from public.clinics where id = p_clinic_id for update;
  select * into v_row from public.clinic_suspensions
   where clinic_id = p_clinic_id and reason = 'non_payment' and released_at is null
   for update;
  if v_row.id is null or app.billing_has_overdue_open(p_clinic_id) then
    return false;
  end if;

  update public.clinic_suspensions
     set released_at = now(), released_by = null,
         release_note = left(format('Pagamento reconhecido (%s): sem cobrança vencida em aberto.', coalesce(p_payment_id, '?')), 1000)
   where id = v_row.id;

  if not exists (select 1 from public.clinic_suspensions where clinic_id = p_clinic_id and released_at is null) then
    v_restored := coalesce(v_clinic.status_before_suspension, 'active');
    perform set_config('app.clinic_suspension', 'on', true);
    update public.clinics set status = v_restored, status_before_suspension = null where id = p_clinic_id;
    perform set_config('app.clinic_suspension', '', true);
  end if;

  perform app.log_billing(p_clinic_id, 'suspension_released',
    jsonb_build_object('status', v_clinic.status, 'suspension_id', v_row.id, 'reason', 'non_payment'),
    jsonb_build_object('status', coalesce(v_restored, v_clinic.status), 'suspension_id', v_row.id, 'reason', 'non_payment', 'payment', p_payment_id),
    'Reativação automática: pagamento reconhecido.');
  return true;
end
$$;

create or replace function public.billing_upsert_asaas_charge(
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
  -- A mesma trava da suspensão e da reativação (seção 7).
  perform 1 from public.billing_accounts where clinic_id = v_contract.clinic_id for update;
  select * into v_current from public.billing_charges where asaas_payment_id = p_payment_id for update;
  if v_current.id is null then
    insert into public.billing_charges (clinic_id, contract_id, asaas_payment_id, kind, due_date, value_cents, billing_type,
      status, raw_status, paid_at, invoice_url, last_synced_at)
    values (v_contract.clinic_id, p_contract_id, p_payment_id, p_kind, p_due_date, p_value_cents, p_billing_type,
      v_status, p_raw_status, p_paid_at, p_invoice_url, now());
    perform app.log_billing(v_contract.clinic_id, 'charge_created', null, jsonb_build_object(
      'asaas_payment_id', p_payment_id, 'kind', p_kind, 'due_date', p_due_date, 'value_cents', p_value_cents, 'status', v_status));
  else
    update public.billing_charges
       set due_date = p_due_date, value_cents = p_value_cents, billing_type = p_billing_type, status = v_status,
           raw_status = p_raw_status, paid_at = p_paid_at, invoice_url = p_invoice_url, last_synced_at = now(), updated_at = now()
     where id = v_current.id;
    if v_current.status is distinct from v_status then
      perform app.log_billing(v_contract.clinic_id, 'charge_updated',
        jsonb_build_object('asaas_payment_id', p_payment_id, 'status', v_current.status),
        jsonb_build_object('asaas_payment_id', p_payment_id, 'status', v_status));
    end if;
  end if;
  -- F12.6: pagou, tenta reativar (só a inadimplência, só sem vencida em aberto).
  if v_status = 'paid' then
    perform app.billing_try_reactivate(v_contract.clinic_id, p_payment_id);
  end if;
end
$$;

revoke execute on function app.billing_has_overdue_open(uuid) from public, anon, clinic_service;
revoke execute on function app.billing_try_reactivate(uuid, text) from public, anon, authenticated, clinic_service;
