-- F12.2f — Cancelamento da assinatura pelo Administrador (cliente, 03/nov/2026)
--
-- Regras (contrato aprovado, cláusulas "Direito de arrependimento" e
-- "Cancelamento e fim do contrato"):
-- 1. Só o Administrador da clínica cancela, em Configurações › Assinatura, com
--    o motivo (lista; comentário obrigatório em "Outro").
-- 2. Arrependimento: até 7 dias do aceite, tudo o que foi pago é devolvido e o
--    acesso acaba na hora (a clínica é suspensa por "fim do contrato").
-- 3. Cancelamento normal: a clínica usa até a véspera do próximo vencimento;
--    a mensalidade desse vencimento continua devida e nada é gerado depois.
--    No dia seguinte ao fim, a rotina suspende a clínica por "fim do contrato".
-- 4. O contrato fica encerrado (status "ended") no último dia de acesso, com
--    quem cancelou, quando, o tipo e o motivo; rascunho e versão futura saem.
--    O Asaas é ajustado pelo servidor logo depois (registro do resultado aqui).

alter table public.billing_contracts
  add column canceled_at timestamptz,
  add column canceled_by uuid references auth.users (id) on delete set null,
  add column cancel_kind text check (cancel_kind in ('cancel', 'withdrawal')),
  add column cancel_reason text check (cancel_reason in ('price', 'low_usage', 'missing_feature', 'whatsapp_issues', 'other_system', 'clinic_closed', 'other')),
  add column cancel_comment text check (cancel_comment is null or length(cancel_comment) <= 1000),
  add column cancel_next_due date,
  add column asaas_cancel_synced_at timestamptz,
  add column asaas_cancel_error text check (asaas_cancel_error is null or length(asaas_cancel_error) <= 1000),
  add constraint billing_contracts_cancel_state_check check ((canceled_at is null) = (cancel_kind is null) and (canceled_at is null) = (cancel_reason is null));

alter table public.billing_audit_log drop constraint billing_audit_log_action_check;
alter table public.billing_audit_log add constraint billing_audit_log_action_check check (action in (
  'account_created', 'account_updated', 'contacts_updated', 'whatsapp_opt_in', 'whatsapp_opt_out',
  'contract_draft_saved', 'contract_draft_discarded', 'contract_activated', 'contract_ended',
  'contract_accepted', 'contract_notice_sent', 'contract_notice_failed',
  'clinic_suspended', 'suspension_released',
  'asaas_customer_linked', 'asaas_subscription_created', 'charge_created', 'charge_updated', 'asaas_sync_failed',
  'notice_sent', 'notice_failed',
  'contract_canceled', 'asaas_cancel_done', 'asaas_cancel_failed'
));

-- ---------------------------------------------------------------------------
-- A trava da situação da clínica aceita a suspensão feita pelas funções de
-- suspensão (app.clinic_suspension = on) mesmo quando quem dispara é o
-- Administrador (arrependimento); fora delas, segue só o Suporte.
-- ---------------------------------------------------------------------------
create or replace function app.guard_clinic_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Sem usuário (service role, migrações): livre.
  if new.status is distinct from old.status and (select auth.uid()) is not null then
    if (old.status = 'suspended' or new.status = 'suspended')
       and coalesce(current_setting('app.clinic_suspension', true), '') = 'on' then
      return new;
    end if;
    if not app.is_platform_staff() then
      raise exception 'Só o Suporte do RecepClinic muda a situação da clínica.' using errcode = '42501';
    end if;
    if old.status = 'suspended' or new.status = 'suspended' then
      raise exception 'A suspensão entra e sai pelos motivos, na aba Faturamento da clínica.'
        using errcode = 'P0001', hint = 'clinic_suspension_by_reason';
    end if;
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Suspensão pelo sistema (fim do contrato), sem o Suporte
-- ---------------------------------------------------------------------------
create function app.suspend_clinic_by_system(p_clinic_id uuid, p_reason text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic public.clinics%rowtype;
  v_id uuid;
begin
  if exists (select 1 from public.clinic_suspensions where clinic_id = p_clinic_id and reason = p_reason and released_at is null) then
    return;
  end if;
  select * into v_clinic from public.clinics where id = p_clinic_id for update;
  if v_clinic.id is null then
    return;
  end if;
  insert into public.clinic_suspensions (clinic_id, reason, note, created_by)
  values (p_clinic_id, p_reason, p_note, null)
  returning id into v_id;
  if v_clinic.status <> 'suspended' then
    perform set_config('app.clinic_suspension', 'on', true);
    update public.clinics set status_before_suspension = v_clinic.status, status = 'suspended' where id = p_clinic_id;
    perform set_config('app.clinic_suspension', '', true);
  end if;
  perform app.log_billing(p_clinic_id, 'clinic_suspended',
    jsonb_build_object('status', v_clinic.status),
    jsonb_build_object('status', 'suspended', 'suspension_id', v_id, 'reason', p_reason, 'note', p_note));
end
$$;
revoke execute on function app.suspend_clinic_by_system(uuid, text, text) from public, anon, authenticated, clinic_service;

-- ---------------------------------------------------------------------------
-- Próximo vencimento depois de hoje (mesmo dia do mês do 1º vencimento)
-- ---------------------------------------------------------------------------
create function app.billing_next_due(p_first_due date, p_today date)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_months integer := 0;
  v_due date := p_first_due;
begin
  while v_due <= p_today loop
    v_months := v_months + 1;
    v_due := (p_first_due + make_interval(months => v_months))::date;
  end loop;
  return v_due;
end
$$;

-- ---------------------------------------------------------------------------
-- Cancelar a assinatura (Administrador)
-- ---------------------------------------------------------------------------
create function public.cancel_billing_subscription(p_clinic_id uuid, p_reason text, p_comment text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := app.billing_today();
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
  v_contract public.billing_contracts%rowtype;
  v_saved public.billing_contracts%rowtype;
  v_kind text;
  v_next_due date;
  v_until date;
begin
  if not app.is_clinic_admin_member(p_clinic_id) then
    raise exception 'Só o Administrador da clínica cancela a assinatura.' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('price', 'low_usage', 'missing_feature', 'whatsapp_issues', 'other_system', 'clinic_closed', 'other') then
    raise exception 'Escolha o motivo do cancelamento.' using errcode = 'P0001', hint = 'billing_cancel_reason';
  end if;
  if p_reason = 'other' and v_comment is null then
    raise exception 'Conte o motivo do cancelamento.' using errcode = 'P0001', hint = 'billing_cancel_comment';
  end if;
  if v_comment is not null and length(v_comment) > 1000 then
    raise exception 'Comentário longo demais (até 1.000 caracteres).' using errcode = 'P0001', hint = 'billing_cancel_comment';
  end if;

  perform 1 from public.billing_accounts where clinic_id = p_clinic_id for update;
  -- A versão vigente: a ativa que já começou (ou a única ativa).
  select * into v_contract from public.billing_contracts
   where clinic_id = p_clinic_id and status = 'active'
   order by (starts_on <= v_today) desc, starts_on
   limit 1
   for update;
  if v_contract.id is null then
    raise exception 'Não há assinatura ativa para cancelar.' using errcode = 'P0001', hint = 'billing_cancel_missing';
  end if;

  v_kind := case when v_contract.acceptance = 'explicit' and v_contract.accepted_at >= now() - interval '7 days' then 'withdrawal' else 'cancel' end;
  v_next_due := app.billing_next_due(v_contract.first_due_date, v_today);
  v_until := case when v_kind = 'withdrawal' then v_today else v_next_due - 1 end;
  v_until := greatest(v_until, v_contract.starts_on - 1);

  update public.billing_contracts
     set status = 'ended', ends_on = v_until, canceled_at = now(), canceled_by = (select auth.uid()),
         cancel_kind = v_kind, cancel_reason = p_reason, cancel_comment = v_comment,
         cancel_next_due = case when v_kind = 'cancel' then v_next_due end, updated_at = now()
   where id = v_contract.id
   returning * into v_saved;
  perform app.log_billing(p_clinic_id, 'contract_canceled', app.billing_contract_snapshot(v_contract), app.billing_contract_snapshot(v_saved),
    case v_kind when 'withdrawal' then 'Arrependimento (até 7 dias do aceite): devolução do que foi pago e fim do acesso na hora.'
                else 'Cancelamento: acesso até ' || to_char(v_until, 'DD/MM/YYYY') || '; a mensalidade de ' || to_char(v_next_due, 'DD/MM/YYYY') || ' continua devida.' end);

  -- Versões futuras e o rascunho saem com o cancelamento.
  update public.billing_contracts set status = 'ended', ends_on = starts_on - 1, updated_at = now()
   where clinic_id = p_clinic_id and status = 'active' and id <> v_contract.id;
  update public.billing_contracts set status = 'canceled', updated_at = now()
   where clinic_id = p_clinic_id and status = 'draft';

  if v_kind = 'withdrawal' then
    perform app.suspend_clinic_by_system(p_clinic_id, 'contract_ended', 'Assinatura cancelada no prazo de arrependimento (7 dias).');
  end if;

  return jsonb_build_object('contract_id', v_contract.id, 'kind', v_kind, 'access_until', v_until, 'next_due', v_next_due,
    'billing_mode', v_contract.billing_mode, 'subscription_id', v_contract.asaas_subscription_id);
end
$$;
revoke execute on function public.cancel_billing_subscription(uuid, text, text) from public, anon, clinic_service;
grant execute on function public.cancel_billing_subscription(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Resultado do ajuste no Asaas (servidor)
-- ---------------------------------------------------------------------------
create function public.billing_record_cancel_sync(p_contract_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract public.billing_contracts%rowtype;
  v_error text := nullif(left(trim(coalesce(p_error, '')), 1000), '');
begin
  select * into v_contract from public.billing_contracts where id = p_contract_id;
  if v_contract.id is null then
    return;
  end if;
  update public.billing_contracts
     set asaas_cancel_synced_at = case when v_error is null then now() else asaas_cancel_synced_at end,
         asaas_cancel_error = v_error, updated_at = now()
   where id = p_contract_id;
  perform app.log_billing(v_contract.clinic_id, case when v_error is null then 'asaas_cancel_done' else 'asaas_cancel_failed' end, null, null, v_error);
end
$$;
revoke execute on function public.billing_record_cancel_sync(uuid, text) from public, anon, authenticated, clinic_service;
grant execute on function public.billing_record_cancel_sync(uuid, text) to service_role;

-- Contratos cancelados ainda sem o ajuste no Asaas (a conciliação tenta de novo).
create function public.billing_cancels_to_sync()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.billing_contracts
   where canceled_at is not null and billing_mode = 'asaas' and asaas_subscription_id is not null and asaas_cancel_synced_at is null
$$;
revoke execute on function public.billing_cancels_to_sync() from public, anon, authenticated, clinic_service;
grant execute on function public.billing_cancels_to_sync() to service_role;

-- ---------------------------------------------------------------------------
-- Fim do acesso: a rotina diária suspende quem passou do último dia
-- ---------------------------------------------------------------------------
create function public.billing_suspend_ended_contracts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select c.clinic_id, c.ends_on from public.billing_contracts c
     where c.canceled_at is not null and c.ends_on < app.billing_today()
       and not exists (select 1 from public.billing_contracts o where o.clinic_id = c.clinic_id and o.status = 'active')
       and not exists (select 1 from public.clinic_suspensions s where s.clinic_id = c.clinic_id and s.reason = 'contract_ended' and s.released_at is null)
       and c.canceled_at = (select max(canceled_at) from public.billing_contracts m where m.clinic_id = c.clinic_id)
  loop
    perform app.suspend_clinic_by_system(v_row.clinic_id, 'contract_ended', 'Assinatura cancelada: acesso até ' || to_char(v_row.ends_on, 'DD/MM/YYYY') || '.');
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;
revoke execute on function public.billing_suspend_ended_contracts() from public, anon, authenticated, clinic_service;
grant execute on function public.billing_suspend_ended_contracts() to service_role;
