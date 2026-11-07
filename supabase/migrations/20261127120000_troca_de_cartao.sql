-- F12.2g — Troca de cartão pelo Administrador (cliente, 03/nov/2026)
--
-- "Trocar o cartão" na Assinatura abre o Checkout do Asaas (o RecepClinic não
-- vê o cartão; decisão 11.9). O Checkout cria uma assinatura nova no cartão
-- novo, com a 1ª cobrança no próximo vencimento (testado no sandbox em
-- 03/nov/2026: nada é cobrado na hora); concluído, o servidor remove a
-- assinatura antiga (e as cobranças em aberto dela) e liga a nova ao contrato.
-- O pedido fica no contrato até concluir; a conciliação diária termina o que
-- ficou pela metade e descarta o pedido não concluído depois de 1 dia.

alter table public.billing_contracts
  add column card_change_checkout_id text check (card_change_checkout_id is null or length(card_change_checkout_id) <= 100),
  add column card_change_requested_at timestamptz,
  add column card_change_next_due date,
  add constraint billing_contracts_card_change_check check ((card_change_checkout_id is null) = (card_change_requested_at is null));

alter table public.billing_audit_log drop constraint billing_audit_log_action_check;
alter table public.billing_audit_log add constraint billing_audit_log_action_check check (action in (
  'account_created', 'account_updated', 'contacts_updated', 'whatsapp_opt_in', 'whatsapp_opt_out',
  'contract_draft_saved', 'contract_draft_discarded', 'contract_activated', 'contract_ended',
  'contract_accepted', 'contract_notice_sent', 'contract_notice_failed',
  'clinic_suspended', 'suspension_released',
  'asaas_customer_linked', 'asaas_subscription_created', 'charge_created', 'charge_updated', 'asaas_sync_failed',
  'notice_sent', 'notice_failed',
  'contract_canceled', 'asaas_cancel_done', 'asaas_cancel_failed',
  'card_change_requested', 'card_changed', 'card_change_failed'
));

-- Pedido de troca (o servidor criou o Checkout no Asaas).
create function public.billing_record_card_change_request(p_contract_id uuid, p_checkout_id text, p_next_due date, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract public.billing_contracts%rowtype;
begin
  select * into v_contract from public.billing_contracts where id = p_contract_id for update;
  if v_contract.id is null then
    raise exception 'Contrato não encontrado.' using errcode = 'P0001', hint = 'billing_contract_missing';
  end if;
  update public.billing_contracts
     set card_change_checkout_id = p_checkout_id, card_change_requested_at = now(), card_change_next_due = p_next_due, updated_at = now()
   where id = p_contract_id;
  insert into public.billing_audit_log (clinic_id, actor_kind, actor_id, action, after)
  values (v_contract.clinic_id, 'clinic', p_actor, 'card_change_requested',
    jsonb_build_object('checkout_id', p_checkout_id, 'next_due', p_next_due));
end
$$;

-- Troca concluída: a assinatura nova no lugar da antiga (ou o pedido descartado).
create function public.billing_finish_card_change(p_contract_id uuid, p_new_subscription_id text, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract public.billing_contracts%rowtype;
  v_error text := nullif(left(trim(coalesce(p_error, '')), 1000), '');
begin
  select * into v_contract from public.billing_contracts where id = p_contract_id for update;
  if v_contract.id is null or v_contract.card_change_checkout_id is null then
    return;
  end if;
  if p_new_subscription_id is not null then
    update public.billing_contracts
       set asaas_subscription_id = p_new_subscription_id, card_change_checkout_id = null, card_change_requested_at = null,
           card_change_next_due = null, updated_at = now()
     where id = p_contract_id;
    perform app.log_billing(v_contract.clinic_id, 'card_changed',
      jsonb_build_object('asaas_subscription_id', v_contract.asaas_subscription_id),
      jsonb_build_object('asaas_subscription_id', p_new_subscription_id));
  else
    update public.billing_contracts
       set card_change_checkout_id = null, card_change_requested_at = null, card_change_next_due = null, updated_at = now()
     where id = p_contract_id;
    perform app.log_billing(v_contract.clinic_id, 'card_change_failed', null, null, coalesce(v_error, 'Troca não concluída.'));
  end if;
end
$$;

-- Pedidos de troca em aberto (a conciliação termina ou descarta).
create function public.billing_card_changes_open()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.billing_contracts where card_change_checkout_id is not null
$$;

revoke execute on function public.billing_record_card_change_request(uuid, text, date, uuid) from public, anon, authenticated, clinic_service;
revoke execute on function public.billing_finish_card_change(uuid, text, text) from public, anon, authenticated, clinic_service;
revoke execute on function public.billing_card_changes_open() from public, anon, authenticated, clinic_service;
grant execute on function public.billing_record_card_change_request(uuid, text, date, uuid) to service_role;
grant execute on function public.billing_finish_card_change(uuid, text, text) to service_role;
grant execute on function public.billing_card_changes_open() to service_role;
