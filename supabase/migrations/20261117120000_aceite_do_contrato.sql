-- F12.2b — Faturamento do SaaS: aceite do contrato e aviso de 30 dias.
--
-- Plano em docs/planejamento-faturamento-saas.md, item 24 da seção 11 (cliente,
-- 30/out/2026) e a escolha de 02/nov/2026 (texto provisório versionado):
--   1. cada versão ativada guarda a versão do texto do contrato
--      (terms_version, em src/lib/billingContractText.ts);
--   2. o aceite é "pending" (falta o Administrador aceitar), "explicit"
--      (aceito na tela: data, hora, quem, IP e versão do texto) ou "tacit"
--      (mudança de valor com o mesmo texto: o uso continuado vale como aceite);
--   3. precisa de aceite na tela a versão que não tem antes dela uma versão
--      aceita com o mesmo texto: o 1º contrato e a troca do texto (o do
--      advogado, quando vier, substitui o provisório);
--   4. mudança tácita só começa 30 dias depois da ativação (dias corridos,
--      data de Brasília), e o financeiro recebe os novos termos por e-mail; o
--      envio (ou a falha) fica na trilha e no contrato (notice_sent_at);
--   5. a cobrança só começa depois do aceite (regra para a F12.4).
-- Só o Administrador da clínica aceita; o Suporte vê. O IP é o que o servidor
-- recebeu na requisição.

alter table public.billing_contracts
  add column terms_version text check (terms_version is null or length(terms_version) between 1 and 60),
  add column acceptance text check (acceptance in ('pending', 'explicit', 'tacit')),
  add column accepted_at timestamptz,
  add column accepted_by uuid references auth.users (id) on delete set null,
  add column accepted_ip inet,
  add column notice_sent_at timestamptz;

-- Versões já ativadas antes do aceite (só nos bancos de desenvolvimento): pedem aceite.
update public.billing_contracts
   set terms_version = 'anterior-ao-aceite', acceptance = 'pending'
 where status in ('active', 'ended');

alter table public.billing_contracts
  add constraint billing_contracts_acceptance_state_check check (
    case when status in ('draft', 'canceled') then acceptance is null
         else terms_version is not null and acceptance is not null end
  ),
  add constraint billing_contracts_accepted_at_state_check check ((acceptance = 'explicit') = (accepted_at is not null));

alter table public.billing_audit_log drop constraint billing_audit_log_action_check;
alter table public.billing_audit_log add constraint billing_audit_log_action_check check (action in (
  'account_created', 'account_updated', 'contacts_updated', 'whatsapp_opt_in', 'whatsapp_opt_out',
  'contract_draft_saved', 'contract_draft_discarded', 'contract_activated', 'contract_ended',
  'contract_accepted', 'contract_notice_sent', 'contract_notice_failed'
));

create or replace function app.billing_contract_snapshot(p_contract public.billing_contracts)
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
    'notes', p_contract.notes,
    'terms_version', p_contract.terms_version,
    'acceptance', p_contract.acceptance,
    'accepted_at', p_contract.accepted_at,
    'accepted_ip', p_contract.accepted_ip,
    'notice_sent_at', p_contract.notice_sent_at
  ) end
$$;

-- Hoje em Brasília (dias corridos do aviso de 30 dias; decisão 11.13).
create function app.billing_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

-- ---------------------------------------------------------------------------
-- Ativação (substitui a da F12.2): recebe a versão do texto do contrato.
-- ---------------------------------------------------------------------------
drop function public.activate_billing_contract(uuid);

create function public.activate_billing_contract(p_clinic_id uuid, p_terms_version text)
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
  v_terms text := nullif(trim(coalesce(p_terms_version, '')), '');
  v_acceptance text;
begin
  if not app.is_platform_staff() then
    raise exception 'Só o Suporte ativa o contrato.' using errcode = '42501';
  end if;
  if v_terms is null then
    raise exception 'Versão do texto do contrato ausente.' using errcode = 'P0001', hint = 'billing_terms_version';
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

  -- Regra 3: aceite tácito só quando a vigente já foi aceita com o mesmo texto.
  v_acceptance := case
    when v_active.id is not null and v_active.acceptance in ('explicit', 'tacit') and v_active.terms_version = v_terms then 'tacit'
    else 'pending'
  end;

  if v_active.id is not null then
    if v_draft.starts_on <= v_active.starts_on then
      raise exception 'A nova versão começa depois do início da vigente (%).', to_char(v_active.starts_on, 'DD/MM/YYYY')
        using errcode = 'P0001', hint = 'billing_starts_on';
    end if;
    -- Regra 4: 30 dias de aviso para a mudança aceita pelo uso.
    if v_acceptance = 'tacit' and v_draft.starts_on < app.billing_today() + 30 then
      raise exception 'A nova versão só pode começar 30 dias depois da ativação, em % ou depois.', to_char(app.billing_today() + 30, 'DD/MM/YYYY')
        using errcode = 'P0001', hint = 'billing_notice_period';
    end if;
    update public.billing_contracts set status = 'ended', ends_on = v_draft.starts_on - 1, updated_at = now()
     where id = v_active.id returning * into v_ended;
    perform app.log_billing(p_clinic_id, 'contract_ended', app.billing_contract_snapshot(v_active), app.billing_contract_snapshot(v_ended),
      'Vale até a véspera do início da nova versão.');
  end if;

  select coalesce(max(version), 0) + 1 into v_version from public.billing_contracts where clinic_id = p_clinic_id;
  update public.billing_contracts
     set status = 'active', version = v_version, replaces_contract_id = v_active.id,
         terms_version = v_terms, acceptance = v_acceptance,
         activated_by = (select auth.uid()), activated_at = now(), updated_at = now()
   where id = v_draft.id
   returning * into v_saved;
  perform app.log_billing(p_clinic_id, 'contract_activated', app.billing_contract_snapshot(v_draft), app.billing_contract_snapshot(v_saved),
    case v_acceptance when 'tacit' then 'Mudança com o mesmo texto: o uso continuado vale como aceite.' else 'Aguarda o aceite do Administrador da clínica.' end);
end
$$;

-- ---------------------------------------------------------------------------
-- Aceite na tela (regra 2): só o Administrador da clínica.
-- ---------------------------------------------------------------------------
create function public.accept_billing_contract(p_clinic_id uuid, p_contract_id uuid, p_terms_version text, p_ip text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.billing_contracts%rowtype;
  v_saved public.billing_contracts%rowtype;
  v_ip inet;
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
  begin
    v_ip := nullif(trim(coalesce(p_ip, '')), '')::inet;
  exception when others then
    v_ip := null;
  end;

  update public.billing_contracts
     set acceptance = 'explicit', accepted_at = now(), accepted_by = (select auth.uid()), accepted_ip = v_ip, updated_at = now()
   where id = v_current.id
   returning * into v_saved;
  perform app.log_billing(p_clinic_id, 'contract_accepted', app.billing_contract_snapshot(v_current), app.billing_contract_snapshot(v_saved));
end
$$;

-- ---------------------------------------------------------------------------
-- Aviso por e-mail da mudança (regra 4): o servidor envia e registra aqui.
-- ---------------------------------------------------------------------------
create function public.record_billing_contract_notice(p_clinic_id uuid, p_contract_id uuid, p_sent_to text, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.billing_contracts%rowtype;
  v_saved public.billing_contracts%rowtype;
begin
  if not app.is_platform_staff() then
    raise exception 'Só o Suporte registra o aviso do contrato.' using errcode = '42501';
  end if;
  select * into v_current from public.billing_contracts
   where id = p_contract_id and clinic_id = p_clinic_id and status = 'active' and acceptance = 'tacit'
   for update;
  if v_current.id is null then
    raise exception 'Contrato não encontrado.' using errcode = 'P0001', hint = 'billing_contract_missing';
  end if;
  if nullif(trim(coalesce(p_error, '')), '') is not null then
    perform app.log_billing(p_clinic_id, 'contract_notice_failed', null, app.billing_contract_snapshot(v_current),
      left(format('E-mail para %s não saiu: %s', coalesce(p_sent_to, '?'), trim(p_error)), 500));
    return;
  end if;
  update public.billing_contracts set notice_sent_at = now(), updated_at = now()
   where id = v_current.id
   returning * into v_saved;
  perform app.log_billing(p_clinic_id, 'contract_notice_sent', app.billing_contract_snapshot(v_current), app.billing_contract_snapshot(v_saved),
    left(format('Novos termos enviados para %s.', coalesce(p_sent_to, '?')), 500));
end
$$;

revoke execute on function public.activate_billing_contract(uuid, text) from public, anon, clinic_service;
revoke execute on function public.accept_billing_contract(uuid, uuid, text, text) from public, anon, clinic_service;
revoke execute on function public.record_billing_contract_notice(uuid, uuid, text, text) from public, anon, clinic_service;
revoke execute on function app.billing_today() from public, anon, clinic_service;
grant execute on function public.activate_billing_contract(uuid, text) to authenticated;
grant execute on function public.accept_billing_contract(uuid, uuid, text, text) to authenticated;
grant execute on function public.record_billing_contract_notice(uuid, uuid, text, text) to authenticated;
