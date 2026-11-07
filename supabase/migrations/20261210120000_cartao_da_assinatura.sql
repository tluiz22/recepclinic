-- F12.2i — Passo do pagamento na Assinatura (cliente, 04/nov/2026; canvas "Assinatura: aceite e WhatsApp", linha
-- "Passo do cartão")
--
-- Sequência: Contrato → Cartão (ou Pagamento, no Pix) → WhatsApp → Pronto. No cartão, o passo só termina com o cartão
-- ligado à assinatura das mensalidades no Asaas. Testado no sandbox (04/nov/2026): pagar a implantação (cobrança
-- avulsa) com cartão NÃO liga o cartão à assinatura; o servidor liga depois, com o token que o Asaas devolve no
-- pagamento (sem cobrar nada). Sem implantação, o cartão é cadastrado pelo Checkout do Asaas, como na troca de cartão
-- (1ª mensalidade só no vencimento). O RecepClinic guarda só o final do cartão (decisão 11.9).
-- No Pix, "Pagar depois" deixa o passo Pagamento para trás (a cobrança fica em Cobranças).

alter table public.billing_contracts
  add column card_registered_at timestamptz,
  add column card_last4 text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  add column payment_step_dismissed_at timestamptz;

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
  'card_registered'
));

-- Cartão ligado à assinatura (o servidor, depois de conferir no Asaas).
create function public.billing_record_card_registered(p_contract_id uuid, p_last4 text, p_source text)
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
  if p_source not in ('setup', 'checkout') then
    raise exception 'Origem do cartão inválida.' using errcode = '22023';
  end if;
  -- Já cadastrado (troca de cartão): só o final muda; a trilha já tem "Cartão trocado".
  if v_contract.card_registered_at is not null then
    update public.billing_contracts
       set card_last4 = case when p_last4 ~ '^[0-9]{4}$' then p_last4 else card_last4 end, updated_at = now()
     where id = p_contract_id;
    return;
  end if;
  update public.billing_contracts
     set card_registered_at = now(), card_last4 = case when p_last4 ~ '^[0-9]{4}$' then p_last4 else card_last4 end, updated_at = now()
   where id = p_contract_id;
  perform app.log_billing(v_contract.clinic_id, 'card_registered', null,
    jsonb_build_object('origem', p_source, 'final', nullif(p_last4, '')));
end
$$;

-- Contratos no cartão, ativos e aceitos, ainda sem o cartão (a conciliação confere de novo).
create function public.billing_contracts_without_card()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.billing_contracts
   where status = 'active' and billing_mode = 'asaas' and payment_method = 'credit_card'
     and acceptance in ('explicit', 'tacit') and card_registered_at is null and asaas_subscription_id is not null
$$;

-- Pix: "Pagar depois" no passo Pagamento (só o Administrador da clínica).
create function public.dismiss_billing_payment_step(p_clinic_id uuid, p_contract_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_clinic_admin_member(p_clinic_id) then
    raise exception 'Só o Administrador da clínica conclui a assinatura.' using errcode = '42501';
  end if;
  update public.billing_contracts
     set payment_step_dismissed_at = coalesce(payment_step_dismissed_at, now()), updated_at = now()
   where id = p_contract_id and clinic_id = p_clinic_id;
end
$$;

revoke execute on function public.billing_record_card_registered(uuid, text, text) from public, anon, authenticated, clinic_service;
revoke execute on function public.billing_contracts_without_card() from public, anon, authenticated, clinic_service;
revoke execute on function public.dismiss_billing_payment_step(uuid, uuid) from public, anon, clinic_service;
grant execute on function public.billing_record_card_registered(uuid, text, text) to service_role;
grant execute on function public.billing_contracts_without_card() to service_role;
grant execute on function public.dismiss_billing_payment_step(uuid, uuid) to authenticated;
