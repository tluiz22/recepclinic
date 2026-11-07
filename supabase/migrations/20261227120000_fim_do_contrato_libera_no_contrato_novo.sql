-- Suspensão por fim do contrato (cliente, 07/nov/2026, validação do cancelamento no staging): a clínica só volta
-- com um contrato novo, como a inadimplência só sai pelo pagamento. O Suporte não libera à mão. O contrato novo
-- (ativo, aceito depois da suspensão e não cancelado) libera:
--   - no cartão: com o cartão cadastrado na assinatura;
--   - no Pix com implantação: com a implantação paga;
--   - no Pix sem implantação ou no modo Manual (o Suporte cobra por fora): no aceite.
-- Gatilhos no contrato (aceite, cartão) e na cobrança (paga) chamam a liberação; outros motivos abertos
-- (administrativo, inadimplência) mantêm a clínica suspensa.

-- ---------------------------------------------------------------------------
-- O Suporte não libera o fim do contrato
-- ---------------------------------------------------------------------------
create or replace function public.release_clinic_suspension(p_suspension_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.clinic_suspensions%rowtype;
  v_clinic public.clinics%rowtype;
  v_note text := trim(coalesce(p_note, ''));
  v_restored public.clinic_status;
begin
  if not app.is_platform_staff() then
    raise exception 'Só o Suporte libera a suspensão.' using errcode = '42501';
  end if;
  if length(v_note) < 3 or length(v_note) > 1000 then
    raise exception 'Escreva o motivo da liberação (de 3 a 1.000 caracteres).' using errcode = 'P0001', hint = 'suspension_note';
  end if;
  select * into v_row from public.clinic_suspensions where id = p_suspension_id;
  if v_row.id is null then
    raise exception 'Suspensão não encontrada.' using errcode = 'P0001', hint = 'suspension_missing';
  end if;
  perform 1 from public.billing_accounts where clinic_id = v_row.clinic_id for update;
  select * into v_clinic from public.clinics where id = v_row.clinic_id for update;
  select * into v_row from public.clinic_suspensions where id = p_suspension_id for update;
  if v_row.released_at is not null then
    raise exception 'Este motivo já foi liberado.' using errcode = 'P0001', hint = 'suspension_released';
  end if;
  if v_row.reason = 'non_payment' then
    raise exception 'A inadimplência é liberada pelo pagamento.' using errcode = 'P0001', hint = 'suspension_non_payment_auto';
  end if;
  if v_row.reason = 'contract_ended' then
    raise exception 'O fim do contrato é liberado pelo contrato novo (aceite e cartão ou pagamento).'
      using errcode = 'P0001', hint = 'suspension_contract_ended_auto';
  end if;

  update public.clinic_suspensions
     set released_at = now(), released_by = (select auth.uid()), release_note = v_note
   where id = v_row.id;

  if not exists (select 1 from public.clinic_suspensions where clinic_id = v_row.clinic_id and released_at is null) then
    v_restored := coalesce(v_clinic.status_before_suspension, 'active');
    perform set_config('app.clinic_suspension', 'on', true);
    update public.clinics set status = v_restored, status_before_suspension = null where id = v_row.clinic_id;
    perform set_config('app.clinic_suspension', '', true);
  end if;

  perform app.log_billing(v_row.clinic_id, 'suspension_released',
    jsonb_build_object('status', v_clinic.status, 'suspension_id', v_row.id, 'reason', v_row.reason),
    jsonb_build_object('status', coalesce(v_restored, v_clinic.status), 'suspension_id', v_row.id, 'reason', v_row.reason, 'note', v_note));
end
$$;

-- ---------------------------------------------------------------------------
-- Liberação pelo contrato novo
-- ---------------------------------------------------------------------------
create function app.billing_try_release_contract_ended(p_clinic_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic public.clinics%rowtype;
  v_row public.clinic_suspensions%rowtype;
  v_contract public.billing_contracts%rowtype;
  v_restored public.clinic_status;
  v_how text;
begin
  -- Sem suspensão aberta por fim do contrato, nada a fazer (sem travar nada).
  if not exists (select 1 from public.clinic_suspensions where clinic_id = p_clinic_id and reason = 'contract_ended' and released_at is null) then
    return false;
  end if;
  perform 1 from public.billing_accounts where clinic_id = p_clinic_id for update;
  select * into v_clinic from public.clinics where id = p_clinic_id for update;
  select * into v_row from public.clinic_suspensions
   where clinic_id = p_clinic_id and reason = 'contract_ended' and released_at is null
   order by created_at desc limit 1
   for update;
  if v_row.id is null then
    return false;
  end if;

  -- O contrato novo: ativo, aceito depois da suspensão e não cancelado.
  select * into v_contract from public.billing_contracts
   where clinic_id = p_clinic_id and status = 'active' and canceled_at is null
     and acceptance in ('explicit', 'tacit') and accepted_at > v_row.created_at
   order by accepted_at desc limit 1;
  if v_contract.id is null then
    return false;
  end if;

  v_how := case
    when v_contract.billing_mode = 'manual' then 'contrato novo aceito (cobrança manual)'
    when v_contract.payment_method = 'credit_card' and v_contract.card_registered_at is not null then 'contrato novo aceito e cartão cadastrado'
    when v_contract.payment_method = 'pix' and v_contract.setup_cents = 0 then 'contrato novo aceito (Pix, sem implantação)'
    when v_contract.payment_method = 'pix' and exists (
      select 1 from public.billing_charges ch where ch.contract_id = v_contract.id and ch.kind = 'setup' and ch.status = 'paid'
    ) then 'contrato novo aceito e implantação paga'
    else null
  end;
  if v_how is null then
    return false;
  end if;

  update public.clinic_suspensions
     set released_at = now(), released_by = null, release_note = left('Liberada pelo ' || v_how || '.', 1000)
   where clinic_id = p_clinic_id and reason = 'contract_ended' and released_at is null;

  if not exists (select 1 from public.clinic_suspensions where clinic_id = p_clinic_id and released_at is null) then
    v_restored := coalesce(v_clinic.status_before_suspension, 'active');
    perform set_config('app.clinic_suspension', 'on', true);
    update public.clinics set status = v_restored, status_before_suspension = null where id = p_clinic_id;
    perform set_config('app.clinic_suspension', '', true);
  end if;

  perform app.log_billing(p_clinic_id, 'suspension_released',
    jsonb_build_object('status', v_clinic.status, 'suspension_id', v_row.id, 'reason', 'contract_ended'),
    jsonb_build_object('status', coalesce(v_restored, v_clinic.status), 'suspension_id', v_row.id, 'reason', 'contract_ended', 'contract_id', v_contract.id),
    'Reativação automática: ' || v_how || '.');
  return true;
end
$$;
revoke execute on function app.billing_try_release_contract_ended(uuid) from public, anon, authenticated, clinic_service;

create function app.billing_contract_release_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.billing_try_release_contract_ended(new.clinic_id);
  return null;
end
$$;

-- Aceite e cartão cadastrado (o contrato muda de linha).
create trigger billing_contracts_release_contract_ended
  after update of acceptance, card_registered_at, status on public.billing_contracts
  for each row execute function app.billing_contract_release_trigger();

-- Implantação paga (o espelho da cobrança entra ou muda).
create trigger billing_charges_release_contract_ended
  after insert or update of status on public.billing_charges
  for each row when (new.status = 'paid' and new.kind = 'setup')
  execute function app.billing_contract_release_trigger();

-- A volta pelo aceite (cobrança manual ou Pix sem implantação) acontece na transação do Administrador da clínica
-- suspensa: a linha da clínica aceita a mudança de situação feita pelo banco (app.clinic_suspension, a mesma marca
-- da suspensão e da liberação); o resto continua bloqueado ao login da clínica suspensa.
create or replace function app.guard_suspended_clinic_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.is_clinic_login_write() and old.status = 'suspended'
     and coalesce(current_setting('app.clinic_suspension', true), '') <> 'on' then
    raise exception 'Clínica suspensa: o painel fica restrito à Assinatura até a regularização.'
      using errcode = 'P0001', hint = 'clinic_suspended';
  end if;
  return coalesce(new, old);
end
$$;
