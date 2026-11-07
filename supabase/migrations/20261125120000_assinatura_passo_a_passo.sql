-- F12.2e — Assinatura em passo a passo (cliente, 03/nov/2026)
--
-- 1. O aceite do contrato leva também a autorização da cobrança recorrente
--    (CDC: consentimento prévio, destacado e nunca pré-marcado): a frase que a
--    tela mostrou fica no contrato, com a data, quem e o IP do aceite.
-- 2. "Agora não" no passo do WhatsApp financeiro fica registrado na conta de
--    cobrança, para o passo não voltar; autorizar depois segue pelo cartão
--    WhatsApp financeiro da tela.

alter table public.billing_contracts
  add column recurring_consent text check (recurring_consent is null or length(recurring_consent) between 1 and 500);

alter table public.billing_accounts
  add column whatsapp_prompt_dismissed_at timestamptz;

-- ---------------------------------------------------------------------------
-- Aceite com a autorização da cobrança recorrente
-- ---------------------------------------------------------------------------
drop function public.accept_billing_contract(uuid, uuid, text, text);

create function public.accept_billing_contract(p_clinic_id uuid, p_contract_id uuid, p_terms_version text, p_ip text, p_recurring_consent text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.billing_contracts%rowtype;
  v_saved public.billing_contracts%rowtype;
  v_ip inet;
  v_consent text := nullif(trim(coalesce(p_recurring_consent, '')), '');
begin
  if not app.is_clinic_admin_member(p_clinic_id) then
    raise exception 'Só o Administrador da clínica aceita o contrato.' using errcode = '42501';
  end if;
  select * into v_current from public.billing_contracts
   where id = p_contract_id and clinic_id = p_clinic_id and status = 'active'
   for update;
  if v_current.id is null then
    raise exception 'Contrato não encontrado.' using errcode = 'P0001', hint = 'billing_contract_missing';
  end if;
  if v_current.acceptance <> 'pending' then
    return;
  end if;
  -- A tela mostrou outro texto (mudou entre abrir e aceitar).
  if v_current.terms_version is distinct from trim(coalesce(p_terms_version, '')) then
    raise exception 'O texto do contrato mudou. Recarregue a tela e leia de novo.' using errcode = 'P0001', hint = 'billing_terms_changed';
  end if;
  if v_consent is null then
    raise exception 'Marque a autorização da cobrança mensal.' using errcode = 'P0001', hint = 'billing_recurring_consent';
  end if;
  begin
    v_ip := nullif(trim(coalesce(p_ip, '')), '')::inet;
  exception when others then
    v_ip := null;
  end;

  update public.billing_contracts
     set acceptance = 'explicit', accepted_at = now(), accepted_by = (select auth.uid()), accepted_ip = v_ip,
         recurring_consent = v_consent, updated_at = now()
   where id = v_current.id
   returning * into v_saved;
  perform app.log_billing(p_clinic_id, 'contract_accepted', app.billing_contract_snapshot(v_current), app.billing_contract_snapshot(v_saved),
    'Autorização da cobrança mensal: ' || v_consent);
end
$$;
revoke execute on function public.accept_billing_contract(uuid, uuid, text, text, text) from public, anon, clinic_service;
grant execute on function public.accept_billing_contract(uuid, uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- "Agora não" no passo do WhatsApp financeiro
-- ---------------------------------------------------------------------------
create function public.dismiss_billing_whatsapp_prompt(p_clinic_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_clinic_admin_member(p_clinic_id) then
    raise exception 'Só o Administrador da clínica decide sobre o WhatsApp financeiro.' using errcode = '42501';
  end if;
  update public.billing_accounts
     set whatsapp_prompt_dismissed_at = coalesce(whatsapp_prompt_dismissed_at, now())
   where clinic_id = p_clinic_id;
end
$$;
revoke execute on function public.dismiss_billing_whatsapp_prompt(uuid) from public, anon, clinic_service;
grant execute on function public.dismiss_billing_whatsapp_prompt(uuid) to authenticated;
