-- F12.2c — Contrato e nota fiscal (cliente, 03/nov/2026)
--
-- 1. O texto do contrato só fala de nota fiscal quando o contrato cobra nota
--    (preço por nota). O app escolhe a versão do texto; a ativação confere:
--    com o Módulo financeiro ("finance") liberado, o contrato precisa do preço
--    por nota; sem ele, não pode ter; e a versão do texto com nota termina em
--    "-nf" exatamente quando há preço por nota.
-- 2. Liberou ou desligou o Módulo financeiro na Matriz: o sistema monta o
--    rascunho da nova versão do contrato (com ou sem nota fiscal), a partir da
--    versão vigente, para o Suporte conferir e ativar. Como o texto muda, a
--    clínica assina na tela (aceite explícito). Já havendo rascunho, ele só
--    acompanha o módulo. Sem contrato nenhum, nada é criado (o primeiro
--    contrato já sai com ou sem nota).
-- 3. A emissão de nota fiscal só sai com contrato em vigor, aceito e com preço
--    por nota (também para a clínica sem contrato nenhum).

-- ---------------------------------------------------------------------------
-- Contrato em vigor, aceito e com nota fiscal
-- ---------------------------------------------------------------------------
create function app.billing_invoicing_signed(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.billing_contracts c
     where c.clinic_id = p_clinic_id
       and c.status in ('active', 'ended')
       and c.acceptance in ('explicit', 'tacit')
       and c.invoice_unit_price_cents is not null
       and c.starts_on <= app.billing_today()
       and (c.ends_on is null or c.ends_on >= app.billing_today())
  )
$$;

-- Para a tela do Financeiro (quem lê o Financeiro ou o Suporte).
create function public.billing_invoicing_signed(p_clinic_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (app.is_platform_staff() or (select auth.role()) = 'service_role' or app.can_read_finance(p_clinic_id)) then
    return false;
  end if;
  return app.billing_invoicing_signed(p_clinic_id);
end
$$;
revoke execute on function app.billing_invoicing_signed(uuid) from public, anon, authenticated, clinic_service;
revoke execute on function public.billing_invoicing_signed(uuid) from public, anon, clinic_service;
grant execute on function public.billing_invoicing_signed(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A emissão espera o contrato assinado
-- ---------------------------------------------------------------------------
create function app.nfse_requires_signed_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.billing_invoicing_signed(new.clinic_id) then
    raise exception 'A emissão de nota fiscal só começa depois que o Administrador assinar o contrato com nota fiscal, em Configurações › Assinatura.'
      using errcode = 'P0001', hint = 'nfse_contract';
  end if;
  return new;
end
$$;
revoke execute on function app.nfse_requires_signed_contract() from public, anon, authenticated, clinic_service;

create trigger nfse_invoices_require_contract
  before insert on public.nfse_invoices
  for each row
  when (new.status = 'issuing')
  execute function app.nfse_requires_signed_contract();

-- ---------------------------------------------------------------------------
-- A ativação confere a nota fiscal
-- ---------------------------------------------------------------------------
create function app.billing_contract_invoicing_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoicing boolean := exists (select 1 from public.clinic_features where clinic_id = new.clinic_id and feature_key = 'finance');
begin
  if v_invoicing and new.invoice_unit_price_cents is null then
    raise exception 'Com o Módulo financeiro liberado, o contrato precisa do preço por nota fiscal: preencha no rascunho e salve.'
      using errcode = 'P0001', hint = 'billing_invoice_price';
  end if;
  if not v_invoicing and new.invoice_unit_price_cents is not null then
    raise exception 'Sem o Módulo financeiro, o contrato não cobra nota fiscal: salve o rascunho de novo.'
      using errcode = 'P0001', hint = 'billing_invoice_disabled';
  end if;
  if (new.terms_version like '%-nf') <> (new.invoice_unit_price_cents is not null) then
    raise exception 'O texto do contrato não corresponde à cobrança de nota fiscal.' using errcode = 'P0001', hint = 'billing_terms_version';
  end if;
  return new;
end
$$;
revoke execute on function app.billing_contract_invoicing_rules() from public, anon, authenticated, clinic_service;

create trigger billing_contracts_invoicing_on_activation
  before update on public.billing_contracts
  for each row
  when (old.status = 'draft' and new.status = 'active')
  execute function app.billing_contract_invoicing_rules();

-- ---------------------------------------------------------------------------
-- Liberou ou desligou o Módulo financeiro: rascunho da nova versão
-- ---------------------------------------------------------------------------
create function app.billing_invoicing_feature_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid := coalesce(new.clinic_id, old.clinic_id);
  v_on boolean := tg_op = 'INSERT';
  v_active public.billing_contracts%rowtype;
  v_draft public.billing_contracts%rowtype;
  v_saved public.billing_contracts%rowtype;
  v_price integer;
  v_start date;
  v_due date;
  v_months integer := 0;
  v_reason text := case when v_on then 'Módulo financeiro liberado: rascunho com nota fiscal. Confira o preço por nota e a franquia e ative; a clínica assina na tela.'
                        else 'Módulo financeiro desligado: rascunho sem nota fiscal. Confira e ative; a clínica assina na tela.' end;
begin
  if coalesce(new.feature_key, old.feature_key) <> 'finance' then
    return null;
  end if;
  -- Clínica sendo excluída (cascata): nada a fazer.
  if not exists (select 1 from public.clinics where id = v_clinic) then
    return null;
  end if;

  -- A mesma trava da conta de cobrança (seção 7 do plano).
  perform 1 from public.billing_accounts where clinic_id = v_clinic for update;
  select default_invoice_unit_price_cents into v_price from public.billing_settings;
  select * into v_active from public.billing_contracts where clinic_id = v_clinic and status = 'active';
  select * into v_draft from public.billing_contracts where clinic_id = v_clinic and status = 'draft' for update;

  if v_draft.id is not null then
    -- Já há rascunho: só acompanha o módulo.
    if v_on and v_draft.invoice_unit_price_cents is null then
      update public.billing_contracts set invoice_unit_price_cents = v_price, invoice_monthly_allowance = null, updated_at = now()
       where id = v_draft.id returning * into v_saved;
    elsif not v_on and v_draft.invoice_unit_price_cents is not null then
      update public.billing_contracts set invoice_unit_price_cents = null, invoice_monthly_allowance = null, updated_at = now()
       where id = v_draft.id returning * into v_saved;
    else
      return null;
    end if;
  elsif v_active.id is not null and (v_active.invoice_unit_price_cents is not null) <> v_on then
    -- Nova versão a partir da vigente, começando hoje (ou no dia seguinte ao início dela).
    v_start := greatest(app.billing_today(), v_active.starts_on + 1);
    v_due := v_active.first_due_date;
    while v_due < v_start loop
      v_months := v_months + 1;
      v_due := (v_active.first_due_date + make_interval(months => v_months))::date;
    end loop;
    insert into public.billing_contracts (clinic_id, replaces_contract_id, billing_mode, monthly_cents, setup_cents, payment_method,
      first_due_date, invoice_unit_price_cents, invoice_monthly_allowance, plan_snapshot, notes, starts_on, created_by)
    values (v_clinic, v_active.id, v_active.billing_mode, v_active.monthly_cents, 0, v_active.payment_method,
      v_due, case when v_on then v_price end, null, v_active.plan_snapshot,
      case when v_on then 'Criado pelo sistema ao liberar o Módulo financeiro.' else 'Criado pelo sistema ao desligar o Módulo financeiro.' end,
      v_start, (select auth.uid()))
    returning * into v_saved;
  else
    return null;
  end if;

  perform app.log_billing(v_clinic, 'contract_draft_saved', app.billing_contract_snapshot(v_draft), app.billing_contract_snapshot(v_saved), v_reason);
  return null;
end
$$;
revoke execute on function app.billing_invoicing_feature_changed() from public, anon, authenticated, clinic_service;

create trigger clinic_features_billing_invoicing
  after insert or delete on public.clinic_features
  for each row execute function app.billing_invoicing_feature_changed();
