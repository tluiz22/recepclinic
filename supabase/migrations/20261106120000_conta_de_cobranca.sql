-- F12.1 — Faturamento do SaaS: conta de cobrança da clínica e trilha.
--
-- Plano em docs/planejamento-faturamento-saas.md (seções 4, 6 e 7; cliente,
-- 28/out/2026). Sem Asaas nesta fase: os campos do Asaas entram na F12.4.
--   1. uma conta de cobrança por clínica: pagador (nome e CNPJ ou CPF),
--      e-mail financeiro (obrigatório) e telefone financeiro (opcional);
--   2. o Suporte cria e altera a conta inteira; o Administrador da clínica
--      altera só os contatos (e-mail e telefone);
--   3. opt-in do WhatsApp financeiro: só o Administrador da clínica dá ou
--      retira (é o consentimento da clínica), com quando, quem e a versão do
--      texto; exige o telefone, e trocar ou apagar o telefone retira o opt-in;
--   4. nada grava direto nas tabelas: só as funções abaixo, que travam a
--      linha da conta e registram cada mudança na trilha (só inclusão);
--   5. leitura: o Administrador da clínica e o Suporte; Recepção,
--      Profissional, bot e rotinas (clinic_service) não veem.

-- ---------------------------------------------------------------------------
-- Conta de cobrança (regra 1)
-- ---------------------------------------------------------------------------
create table public.billing_accounts (
  clinic_id uuid primary key references public.clinics (id) on delete cascade,
  payer_name text not null check (length(trim(payer_name)) between 1 and 200),
  -- CNPJ (14) ou CPF (11), sem máscara.
  payer_document text not null check (app.is_valid_cnpj(payer_document) or app.is_valid_cpf(payer_document)),
  finance_email text not null
    check (finance_email = lower(trim(finance_email)) and finance_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(finance_email) <= 200),
  finance_phone text check (finance_phone is null or finance_phone ~ '^\+\d{10,15}$'),
  whatsapp_opt_in_at timestamptz,
  whatsapp_opt_in_by uuid references auth.users (id) on delete set null,
  whatsapp_opt_in_version text,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Opt-in só com telefone, e com data e versão do texto.
  check (whatsapp_opt_in_at is null or (finance_phone is not null and whatsapp_opt_in_version is not null))
);

-- ---------------------------------------------------------------------------
-- Trilha do faturamento (regra 4): ator (Administrador da clínica, Suporte,
-- rotina ou webhook), ação, antes e depois, motivo.
-- ---------------------------------------------------------------------------
create table public.billing_audit_log (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  actor_kind text not null check (actor_kind in ('clinic', 'support', 'system', 'webhook')),
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (action in ('account_created', 'account_updated', 'contacts_updated', 'whatsapp_opt_in', 'whatsapp_opt_out')),
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index billing_audit_log_clinic_idx on public.billing_audit_log (clinic_id, created_at desc);

create function app.billing_account_snapshot(p_account public.billing_accounts)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_account.clinic_id is null then null else jsonb_build_object(
    'payer_name', p_account.payer_name,
    'payer_document', p_account.payer_document,
    'finance_email', p_account.finance_email,
    'finance_phone', p_account.finance_phone,
    'whatsapp_opt_in_at', p_account.whatsapp_opt_in_at,
    'whatsapp_opt_in_version', p_account.whatsapp_opt_in_version
  ) end
$$;

create function app.log_billing(p_clinic_id uuid, p_action text, p_before jsonb, p_after jsonb, p_reason text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.billing_audit_log (clinic_id, actor_kind, actor_id, action, before, after, reason)
  values (p_clinic_id, case when (select auth.uid()) is null then 'system' when app.is_platform_staff() then 'support' else 'clinic' end, (select auth.uid()), p_action, p_before, p_after, p_reason)
$$;

-- Contatos normalizados: e-mail em minúsculas; telefone vazio = sem telefone.
create function app.billing_clean_contacts(inout p_email text, inout p_phone text)
language plpgsql
immutable
set search_path = ''
as $$
begin
  p_email := lower(trim(coalesce(p_email, '')));
  p_phone := nullif(trim(coalesce(p_phone, '')), '');
  if p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(p_email) > 200 then
    raise exception 'Informe um e-mail financeiro válido.' using errcode = 'P0001', hint = 'billing_email';
  end if;
  if p_phone is not null and p_phone !~ '^\+\d{10,15}$' then
    raise exception 'Telefone financeiro inválido.' using errcode = 'P0001', hint = 'billing_phone';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Suporte: cria ou altera a conta inteira (regra 2).
-- ---------------------------------------------------------------------------
create function public.save_billing_account(
  p_clinic_id uuid,
  p_payer_name text,
  p_payer_document text,
  p_finance_email text,
  p_finance_phone text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.billing_accounts%rowtype;
  v_saved public.billing_accounts%rowtype;
  v_name text := trim(coalesce(p_payer_name, ''));
  v_document text := upper(coalesce(p_payer_document, ''));
  v_email text;
  v_phone text;
  v_phone_changed boolean;
begin
  if not app.is_platform_staff() then
    raise exception 'Só o Suporte altera a conta de cobrança.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clinics where id = p_clinic_id) then
    raise exception 'Clínica não encontrada.' using errcode = 'P0001', hint = 'clinic_missing';
  end if;
  if length(v_name) = 0 or length(v_name) > 200 then
    raise exception 'Informe o nome ou a razão social do pagador.' using errcode = 'P0001', hint = 'billing_payer_name';
  end if;
  if not (app.is_valid_cnpj(v_document) or app.is_valid_cpf(v_document)) then
    raise exception 'CNPJ ou CPF do pagador inválido.' using errcode = 'P0001', hint = 'billing_payer_document';
  end if;
  select p_email, p_phone into v_email, v_phone from app.billing_clean_contacts(p_finance_email, p_finance_phone);

  select * into v_current from public.billing_accounts where clinic_id = p_clinic_id for update;
  if not found then
    insert into public.billing_accounts (clinic_id, payer_name, payer_document, finance_email, finance_phone, updated_by)
    values (p_clinic_id, v_name, v_document, v_email, v_phone, (select auth.uid()))
    returning * into v_saved;
    perform app.log_billing(p_clinic_id, 'account_created', null, app.billing_account_snapshot(v_saved));
    return;
  end if;

  v_phone_changed := v_phone is distinct from v_current.finance_phone;
  update public.billing_accounts
     set payer_name = v_name, payer_document = v_document, finance_email = v_email, finance_phone = v_phone,
         whatsapp_opt_in_at = case when v_phone_changed then null else whatsapp_opt_in_at end,
         whatsapp_opt_in_by = case when v_phone_changed then null else whatsapp_opt_in_by end,
         whatsapp_opt_in_version = case when v_phone_changed then null else whatsapp_opt_in_version end,
         updated_by = (select auth.uid()), updated_at = now()
   where clinic_id = p_clinic_id
   returning * into v_saved;
  if app.billing_account_snapshot(v_saved) is distinct from app.billing_account_snapshot(v_current) then
    perform app.log_billing(p_clinic_id, 'account_updated', app.billing_account_snapshot(v_current), app.billing_account_snapshot(v_saved),
      case when v_phone_changed and v_current.whatsapp_opt_in_at is not null then 'Telefone trocado: opt-in do WhatsApp retirado.' end);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Administrador da clínica (e o Suporte): só os contatos (regra 2).
-- ---------------------------------------------------------------------------
create function public.save_billing_contacts(p_clinic_id uuid, p_finance_email text, p_finance_phone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.billing_accounts%rowtype;
  v_saved public.billing_accounts%rowtype;
  v_email text;
  v_phone text;
  v_phone_changed boolean;
begin
  if not app.has_clinic_role(p_clinic_id, array['admin']::public.clinic_role[]) then
    raise exception 'Só o Administrador da clínica altera os contatos financeiros.' using errcode = '42501';
  end if;
  select p_email, p_phone into v_email, v_phone from app.billing_clean_contacts(p_finance_email, p_finance_phone);

  select * into v_current from public.billing_accounts where clinic_id = p_clinic_id for update;
  if not found then
    raise exception 'A conta de cobrança ainda não foi cadastrada pelo Suporte.' using errcode = 'P0001', hint = 'billing_account_missing';
  end if;

  v_phone_changed := v_phone is distinct from v_current.finance_phone;
  update public.billing_accounts
     set finance_email = v_email, finance_phone = v_phone,
         whatsapp_opt_in_at = case when v_phone_changed then null else whatsapp_opt_in_at end,
         whatsapp_opt_in_by = case when v_phone_changed then null else whatsapp_opt_in_by end,
         whatsapp_opt_in_version = case when v_phone_changed then null else whatsapp_opt_in_version end,
         updated_by = (select auth.uid()), updated_at = now()
   where clinic_id = p_clinic_id
   returning * into v_saved;
  if app.billing_account_snapshot(v_saved) is distinct from app.billing_account_snapshot(v_current) then
    perform app.log_billing(p_clinic_id, 'contacts_updated', app.billing_account_snapshot(v_current), app.billing_account_snapshot(v_saved),
      case when v_phone_changed and v_current.whatsapp_opt_in_at is not null then 'Telefone trocado: opt-in do WhatsApp retirado.' end);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Opt-in do WhatsApp financeiro (regra 3): só o Administrador da clínica.
-- ---------------------------------------------------------------------------
create function public.set_billing_whatsapp_opt_in(p_clinic_id uuid, p_opt_in boolean, p_text_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.billing_accounts%rowtype;
  v_saved public.billing_accounts%rowtype;
begin
  if not app.is_clinic_admin_member(p_clinic_id) then
    raise exception 'Só o Administrador da clínica autoriza o WhatsApp financeiro.' using errcode = '42501';
  end if;
  select * into v_current from public.billing_accounts where clinic_id = p_clinic_id for update;
  if not found then
    raise exception 'A conta de cobrança ainda não foi cadastrada pelo Suporte.' using errcode = 'P0001', hint = 'billing_account_missing';
  end if;

  if p_opt_in then
    if v_current.finance_phone is null then
      raise exception 'Informe e salve o telefone financeiro antes de autorizar o WhatsApp.' using errcode = 'P0001', hint = 'billing_phone_missing';
    end if;
    if length(coalesce(trim(p_text_version), '')) = 0 then
      raise exception 'Leia e aceite o texto da autorização.' using errcode = 'P0001', hint = 'billing_opt_in_text';
    end if;
    if v_current.whatsapp_opt_in_at is not null then
      return;
    end if;
    update public.billing_accounts
       set whatsapp_opt_in_at = now(), whatsapp_opt_in_by = (select auth.uid()), whatsapp_opt_in_version = trim(p_text_version),
           updated_by = (select auth.uid()), updated_at = now()
     where clinic_id = p_clinic_id
     returning * into v_saved;
    perform app.log_billing(p_clinic_id, 'whatsapp_opt_in', app.billing_account_snapshot(v_current), app.billing_account_snapshot(v_saved));
  else
    if v_current.whatsapp_opt_in_at is null then
      return;
    end if;
    update public.billing_accounts
       set whatsapp_opt_in_at = null, whatsapp_opt_in_by = null, whatsapp_opt_in_version = null,
           updated_by = (select auth.uid()), updated_at = now()
     where clinic_id = p_clinic_id
     returning * into v_saved;
    perform app.log_billing(p_clinic_id, 'whatsapp_opt_out', app.billing_account_snapshot(v_current), app.billing_account_snapshot(v_saved));
  end if;
end
$$;

-- Registro do Suporte (F3), como toda tabela da clínica.
create trigger billing_accounts_audit_platform_staff
  after insert or update or delete on public.billing_accounts
  for each row execute function app.audit_platform_staff_write();
create trigger billing_audit_log_audit_platform_staff
  after insert or update or delete on public.billing_audit_log
  for each row execute function app.audit_platform_staff_write();

-- ---------------------------------------------------------------------------
-- RLS (regra 5): o Administrador e o Suporte leem; ninguém grava direto.
-- ---------------------------------------------------------------------------
alter table public.billing_accounts enable row level security;
alter table public.billing_audit_log enable row level security;

create policy billing_accounts_select on public.billing_accounts
  for select to authenticated using (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]));
create policy billing_audit_log_select on public.billing_audit_log
  for select to authenticated using (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]));

revoke insert, update, delete, truncate on public.billing_accounts, public.billing_audit_log from authenticated;
revoke all on public.billing_accounts, public.billing_audit_log from anon, clinic_service;

revoke execute on function public.save_billing_account(uuid, text, text, text, text) from public, anon, clinic_service;
revoke execute on function public.save_billing_contacts(uuid, text, text) from public, anon, clinic_service;
revoke execute on function public.set_billing_whatsapp_opt_in(uuid, boolean, text) from public, anon, clinic_service;
grant execute on function public.save_billing_account(uuid, text, text, text, text) to authenticated;
grant execute on function public.save_billing_contacts(uuid, text, text) to authenticated;
grant execute on function public.set_billing_whatsapp_opt_in(uuid, boolean, text) to authenticated;
revoke execute on function app.log_billing(uuid, text, jsonb, jsonb, text) from public, anon, authenticated, clinic_service;
revoke execute on function app.billing_account_snapshot(public.billing_accounts) from public, anon, clinic_service;
revoke execute on function app.billing_clean_contacts(text, text) from public, anon, clinic_service;
