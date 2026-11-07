-- Troca da forma de pagamento, cartão ↔ Pix (cliente, 07/nov/2026; plano do faturamento, "Troca cartão ↔ Pix").
--
-- Muda o contrato vigente (sem nova versão nem novo aceite: a seção 5 do contrato prevê a troca), com registro na
-- trilha. Cartão → Pix: o Administrador da clínica ou o Suporte; o servidor muda a assinatura e as cobranças em
-- aberto no Asaas e depois grava aqui (o cartão sai do contrato). Pix → cartão: o Checkout da troca de cartão; ao
-- concluir, a assinatura nova (no cartão) entra no contrato e a forma vira cartão, com o cartão cadastrado.
-- Vale para todas as versões ativas da clínica (a vigente e a próxima, se houver).
--
-- Reversão: drop de billing_set_payment_method; recriar billing_finish_card_change como na 20261127120000; tirar
-- 'payment_method_changed' da lista de ações (antes, apagar as linhas da trilha com essa ação).

alter table public.billing_audit_log drop constraint billing_audit_log_action_check;
alter table public.billing_audit_log add constraint billing_audit_log_action_check check (action in (
  'account_created', 'account_updated', 'contacts_updated', 'whatsapp_opt_in', 'whatsapp_opt_out',
  'contract_draft_saved', 'contract_draft_discarded', 'contract_activated', 'contract_ended',
  'contract_accepted', 'contract_notice_sent', 'contract_notice_failed',
  'clinic_suspended', 'suspension_released',
  'asaas_customer_linked', 'asaas_subscription_created', 'charge_created', 'charge_updated', 'asaas_sync_failed',
  'notice_sent', 'notice_failed',
  'contract_canceled', 'asaas_cancel_done', 'asaas_cancel_failed',
  'card_change_requested', 'card_changed', 'card_change_failed',
  'card_registered',
  'payment_method_changed'
));

-- Cartão → Pix, depois de o servidor mudar o Asaas. Só o servidor (service role) chama: quem pediu vem em p_actor e
-- p_actor_kind ('clinic' = Administrador, 'support' = Suporte), conferidos antes pela rota.
create function public.billing_set_payment_method(p_contract_id uuid, p_method text, p_actor uuid, p_actor_kind text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract public.billing_contracts%rowtype;
begin
  if p_method not in ('pix', 'credit_card') then
    raise exception 'Forma de pagamento inválida.' using errcode = '22023';
  end if;
  if p_actor_kind not in ('clinic', 'support') then
    raise exception 'Quem pediu a troca é inválido.' using errcode = '22023';
  end if;
  select * into v_contract from public.billing_contracts where id = p_contract_id for update;
  if v_contract.id is null or v_contract.status <> 'active' or v_contract.billing_mode <> 'asaas' then
    raise exception 'Não há assinatura ativa no Asaas.' using errcode = 'P0001', hint = 'billing_contract_missing';
  end if;
  if v_contract.payment_method = p_method then
    return false;
  end if;
  update public.billing_contracts
     set payment_method = p_method,
         card_registered_at = case when p_method = 'pix' then null else card_registered_at end,
         card_last4 = case when p_method = 'pix' then null else card_last4 end,
         updated_at = now()
   where clinic_id = v_contract.clinic_id and status = 'active' and billing_mode = 'asaas';
  insert into public.billing_audit_log (clinic_id, actor_kind, actor_id, action, before, after)
  values (v_contract.clinic_id, p_actor_kind, p_actor, 'payment_method_changed',
    jsonb_build_object('payment_method', v_contract.payment_method, 'card_last4', v_contract.card_last4),
    jsonb_build_object('payment_method', p_method));
  return true;
end
$$;
revoke execute on function public.billing_set_payment_method(uuid, text, uuid, text) from public, anon, authenticated, clinic_service;
grant execute on function public.billing_set_payment_method(uuid, text, uuid, text) to service_role;

-- Troca concluída (como na 20261127120000) e, no Pix → cartão, a forma vira cartão, já com o cartão cadastrado.
create or replace function public.billing_finish_card_change(p_contract_id uuid, p_new_subscription_id text, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract public.billing_contracts%rowtype;
  v_error text := nullif(left(trim(coalesce(p_error, '')), 1000), '');
  v_requester uuid;
  v_requester_kind text;
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
    if v_contract.payment_method = 'pix' then
      -- Quem abriu o Checkout (o pedido da troca, na trilha).
      select l.actor_id, l.actor_kind into v_requester, v_requester_kind
        from public.billing_audit_log l
       where l.clinic_id = v_contract.clinic_id and l.action = 'card_change_requested'
       order by l.created_at desc, l.id desc
       limit 1;
      update public.billing_contracts
         set payment_method = 'credit_card', card_registered_at = now(), updated_at = now()
       where clinic_id = v_contract.clinic_id and status = 'active' and billing_mode = 'asaas';
      insert into public.billing_audit_log (clinic_id, actor_kind, actor_id, action, before, after, reason)
      values (v_contract.clinic_id, coalesce(v_requester_kind, 'clinic'), v_requester, 'payment_method_changed',
        jsonb_build_object('payment_method', 'pix'),
        jsonb_build_object('payment_method', 'credit_card'),
        'Cartão informado na página do Asaas: a clínica autorizou a cobrança automática da mensalidade nele, a cada mês, até o cancelamento.');
    end if;
  else
    update public.billing_contracts
       set card_change_checkout_id = null, card_change_requested_at = null, card_change_next_due = null, updated_at = now()
     where id = p_contract_id;
    perform app.log_billing(v_contract.clinic_id, 'card_change_failed', null, null, coalesce(v_error, 'Troca não concluída.'));
  end if;
end
$$;
