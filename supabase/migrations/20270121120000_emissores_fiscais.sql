-- N2a — Emissores fiscais (planejamento-nfse-asaas.md, seções 14 e 15).
--
-- Decisões do cliente (07/nov/2026):
--   1. a nota é configurada por emissor: a clínica e cada profissional com
--      CNPJ próprio; cada emissor tem uma subconta no Asaas (chave da API e
--      token do webhook no Vault);
--   2. N-P1: profissional sem emissor próprio emite pelo emissor da clínica
--      ou não emite pelo sistema; o Administrador escolhe, por profissional
--      (sem escolha: pela clínica, como a clínica piloto, N-P7);
--   3. N-P2: o Administrador e o próprio profissional (com login) configuram
--      o emissor dele; o Suporte cria a subconta; a Recepção só emite;
--   4. o código de serviço por serviço vale por emissor;
--   5. o pagador das notas do emissor (clínica ou o profissional) e a
--      suspensão por inadimplência (N-P5) ficam no emissor; N-P6: pagador
--      profissional precisa de login.
-- O emissor antigo (clinic_fiscal_settings, certificado no Vault) segue até
-- a N5; os dados fiscais dele são copiados para o emissor da clínica.
--
-- Reversão: drop das tabelas fiscal_issuers, professional_fiscal_routes e
-- fiscal_issuer_service_codes, das funções criadas aqui e da coluna
-- fiscal_audit_log.issuer_id; restaurar o check de eventos anterior.

-- ---------------------------------------------------------------------------
-- Emissores
-- ---------------------------------------------------------------------------
create table public.fiscal_issuers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  kind text not null check (kind in ('clinic', 'professional')),
  professional_id uuid,
  -- Dados fiscais (o Administrador ou o profissional preenchem).
  cnpj text not null check (app.is_valid_cnpj(cnpj)),
  legal_name text not null check (length(trim(legal_name)) between 1 and 200),
  fiscal_email text not null check (fiscal_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  mobile_phone text not null check (mobile_phone ~ '^[0-9]{10,11}$'),
  company_type text not null default 'LIMITED' check (company_type in ('MEI', 'LIMITED', 'INDIVIDUAL', 'ASSOCIATION')),
  monthly_income_cents bigint not null default 0 check (monthly_income_cents >= 0),
  postal_code text not null check (postal_code ~ '^[0-9]{8}$'),
  street text not null check (length(trim(street)) between 1 and 200),
  street_number text not null check (length(trim(street_number)) between 1 and 20),
  complement text check (complement is null or length(complement) <= 100),
  district text not null check (length(trim(district)) between 1 and 100),
  municipality_ibge text not null check (app.is_supported_fiscal_municipality(municipality_ibge)),
  municipal_registration text check (municipal_registration is null or municipal_registration ~ '^[0-9A-Za-z./-]{1,20}$'),
  simples_nacional boolean not null default false,
  -- Valor da lista do município (municipalOptions.specialTaxRegimesList).
  special_tax_regime text check (special_tax_regime is null or length(special_tax_regime) <= 40),
  cnae text check (cnae is null or cnae ~ '^[0-9]{7}$'),
  -- Item da lista de serviço (04.01) e código de tributação (04.01.01).
  service_list_item text check (service_list_item is null or service_list_item ~ '^[0-9]{2}\.[0-9]{2}$'),
  service_code text check (service_code is null or app.is_valid_service_code(service_code)),
  service_name text check (service_name is null or length(trim(service_name)) between 1 and 250),
  nbs_code text check (nbs_code is null or nbs_code ~ '^[0-9]\.[0-9]{4}\.[0-9]{2}\.[0-9]{2}$'),
  iss_rate numeric(5, 2) not null default 0 check (iss_rate >= 0 and iss_rate <= 5),
  -- IBS/CBS e PIS/COFINS (contador; seção 13.5): códigos do Asaas.
  pis_cofins_tax_status text check (pis_cofins_tax_status is null or pis_cofins_tax_status ~ '^[A-Z_]{2,60}$'),
  tax_situation_code text check (tax_situation_code is null or tax_situation_code ~ '^[0-9]{3}$'),
  tax_classification_code text check (tax_classification_code is null or tax_classification_code ~ '^[0-9]{6}$'),
  operation_indicator_code text check (operation_indicator_code is null or operation_indicator_code ~ '^[0-9]{6}$'),
  rps_series text check (rps_series is null or rps_series ~ '^[0-9A-Za-z]{1,10}$'),
  rps_next_number integer check (rps_next_number is null or rps_next_number > 0),
  -- Asaas (só o servidor grava, pelas funções da plataforma).
  environment text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  asaas_account_id text unique,
  asaas_wallet_id text,
  api_key_secret_id uuid,
  webhook_token_secret_id uuid,
  account_status text not null default 'none' check (account_status in ('none', 'pending', 'awaiting_approval', 'approved', 'rejected')),
  municipal_options jsonb,
  fiscal_info_status text not null default 'pending' check (fiscal_info_status in ('pending', 'configured', 'error')),
  fiscal_info_message text check (fiscal_info_message is null or length(fiscal_info_message) <= 1000),
  fiscal_info_synced_at timestamptz,
  certificate_sent_at timestamptz,
  certificate_valid_until timestamptz,
  issuing_enabled boolean not null default false,
  -- Quem paga as notas deste emissor (N4b): a clínica (assinatura) ou o profissional.
  payer text not null default 'clinic' check (payer in ('clinic', 'professional')),
  suspended_at timestamptz,
  suspended_reason text check (suspended_reason is null or length(suspended_reason) <= 300),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, professional_id) references public.professionals (clinic_id, id) on delete cascade,
  check ((kind = 'clinic') = (professional_id is null)),
  check (kind = 'professional' or payer = 'clinic'),
  check ((asaas_account_id is null) = (api_key_secret_id is null)),
  check (not issuing_enabled or asaas_account_id is not null)
);

create unique index fiscal_issuers_one_clinic_idx on public.fiscal_issuers (clinic_id) where kind = 'clinic';
create unique index fiscal_issuers_one_per_professional_idx on public.fiscal_issuers (professional_id) where professional_id is not null;
-- Um CNPJ, um emissor na clínica.
create unique index fiscal_issuers_cnpj_idx on public.fiscal_issuers (clinic_id, cnpj);

-- N-P1: profissional sem emissor próprio (sem linha: pela clínica).
create table public.professional_fiscal_routes (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  professional_id uuid primary key,
  mode text not null check (mode in ('clinic', 'none')),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (clinic_id, professional_id) references public.professionals (clinic_id, id) on delete cascade
);

-- Código de tributação de um serviço num emissor (sem linha: o do emissor).
create table public.fiscal_issuer_service_codes (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  issuer_id uuid not null,
  service_id uuid not null,
  service_code text not null check (app.is_valid_service_code(service_code)),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (issuer_id, service_id),
  foreign key (clinic_id, issuer_id) references public.fiscal_issuers (clinic_id, id) on delete cascade,
  foreign key (clinic_id, service_id) references public.services (clinic_id, id) on delete cascade
);

-- Trilha: emissor e eventos novos.
alter table public.fiscal_audit_log add column issuer_id uuid references public.fiscal_issuers (id) on delete set null;
alter table public.fiscal_audit_log drop constraint fiscal_audit_log_event_check;
alter table public.fiscal_audit_log add constraint fiscal_audit_log_event_check
  check (event in (
    'terms_accepted', 'certificate_uploaded', 'certificate_replaced', 'certificate_revoked', 'dmed_generated',
    'environment_changed', 'nfse_issue_requested', 'nfse_issued', 'nfse_rejected',
    'nfse_cancel_requested', 'nfse_canceled', 'nfse_cancel_rejected',
    'issuer_saved', 'issuer_route_changed', 'issuer_payer_changed', 'asaas_account_created', 'account_status_changed',
    'fiscal_info_saved', 'fiscal_info_failed', 'issuing_enabled', 'issuing_disabled', 'issuer_suspended', 'issuer_released'
  ));

-- Os segredos somem com o emissor.
create function app.delete_fiscal_issuer_secrets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id in (old.api_key_secret_id, old.webhook_token_secret_id);
  return null;
end
$$;

create trigger fiscal_issuers_delete_secrets after delete on public.fiscal_issuers
  for each row execute function app.delete_fiscal_issuer_secrets();

create trigger fiscal_issuers_audit_platform_staff
  after insert or update or delete on public.fiscal_issuers
  for each row execute function app.audit_platform_staff_write();
create trigger professional_fiscal_routes_audit_platform_staff
  after insert or update or delete on public.professional_fiscal_routes
  for each row execute function app.audit_platform_staff_write();
create trigger fiscal_issuer_service_codes_audit_platform_staff
  after insert or update or delete on public.fiscal_issuer_service_codes
  for each row execute function app.audit_platform_staff_write();

-- Clínica suspensa (F12.3b): o login dela não grava; o Suporte e o servidor sim.
create trigger fiscal_issuers_guard_suspended before insert or update or delete on public.fiscal_issuers
  for each row execute function app.guard_suspended_clinic_write();
create trigger professional_fiscal_routes_guard_suspended before insert or update or delete on public.professional_fiscal_routes
  for each row execute function app.guard_suspended_clinic_write();
create trigger fiscal_issuer_service_codes_guard_suspended before insert or update or delete on public.fiscal_issuer_service_codes
  for each row execute function app.guard_suspended_clinic_write();

-- ---------------------------------------------------------------------------
-- Permissões (N-P2)
-- ---------------------------------------------------------------------------
-- Quem configura o emissor: o Administrador (e o Suporte, pelo papel) ou o
-- profissional dono do emissor.
create function app.can_manage_fiscal_issuer(p_clinic uuid, p_professional uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_clinic_role(p_clinic, array['admin']::public.clinic_role[])
      or (p_professional is not null and p_professional = app.own_professional_id(p_clinic))
$$;

grant execute on function app.can_manage_fiscal_issuer(uuid, uuid) to authenticated;

alter table public.fiscal_issuers enable row level security;
alter table public.professional_fiscal_routes enable row level security;
alter table public.fiscal_issuer_service_codes enable row level security;

create policy fiscal_issuers_select on public.fiscal_issuers
  for select to authenticated using (app.can_manage_fiscal_issuer(clinic_id, professional_id));
create policy professional_fiscal_routes_select on public.professional_fiscal_routes
  for select to authenticated using (app.can_manage_fiscal_issuer(clinic_id, professional_id));
create policy fiscal_issuer_service_codes_select on public.fiscal_issuer_service_codes
  for select to authenticated using (
    exists (select 1 from public.fiscal_issuers i where i.id = issuer_id and app.can_manage_fiscal_issuer(i.clinic_id, i.professional_id))
  );

-- O profissional lê a trilha do próprio emissor (o Administrador já lê toda a da clínica).
create policy fiscal_audit_log_select_own_issuer on public.fiscal_audit_log
  for select to authenticated using (
    issuer_id is not null and exists (
      select 1 from public.fiscal_issuers i
       where i.id = issuer_id and i.professional_id is not null and i.professional_id = app.own_professional_id(i.clinic_id)
    )
  );

-- Só as funções gravam.
revoke insert, update, delete on public.fiscal_issuers, public.professional_fiscal_routes, public.fiscal_issuer_service_codes from authenticated;
revoke all on public.fiscal_issuers, public.professional_fiscal_routes, public.fiscal_issuer_service_codes from anon, clinic_service;

-- ---------------------------------------------------------------------------
-- Gravações do painel
-- ---------------------------------------------------------------------------
-- Cria ou atualiza os dados fiscais de um emissor (o da clínica com
-- p_professional null). CNPJ não muda depois da subconta criada.
create function public.save_fiscal_issuer(p_clinic_id uuid, p_professional_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.fiscal_issuers%rowtype;
  v_id uuid;
  v_cnpj text := upper(regexp_replace(coalesce(p_data ->> 'cnpj', ''), '[^0-9A-Za-z]', '', 'g'));
begin
  if not app.can_manage_fiscal_issuer(p_clinic_id, p_professional_id) then
    raise exception 'Sem permissão para configurar este emissor.' using errcode = '42501';
  end if;
  perform app.require_feature(p_clinic_id, 'finance');
  if p_professional_id is not null and not exists (
    select 1 from public.professionals where id = p_professional_id and clinic_id = p_clinic_id
  ) then
    raise exception 'Profissional não encontrado.' using errcode = 'P0001', hint = 'issuer_professional';
  end if;

  select * into v_current from public.fiscal_issuers
   where clinic_id = p_clinic_id and professional_id is not distinct from p_professional_id
     and kind = case when p_professional_id is null then 'clinic' else 'professional' end
   for update;

  if v_current.id is not null and v_current.asaas_account_id is not null and v_current.cnpj <> v_cnpj then
    raise exception 'O CNPJ não muda depois da subconta criada no Asaas: fale com o Suporte.' using errcode = 'P0001', hint = 'issuer_cnpj_locked';
  end if;
  if exists (select 1 from public.fiscal_issuers where clinic_id = p_clinic_id and cnpj = v_cnpj and id is distinct from v_current.id) then
    raise exception 'Este CNPJ já é de outro emissor da clínica.' using errcode = 'P0001', hint = 'issuer_cnpj_taken';
  end if;

  if v_current.id is null then
    insert into public.fiscal_issuers (
      clinic_id, kind, professional_id, cnpj, legal_name, fiscal_email, mobile_phone, company_type, monthly_income_cents,
      postal_code, street, street_number, complement, district, municipality_ibge, municipal_registration, simples_nacional,
      special_tax_regime, cnae, service_list_item, service_code, service_name, nbs_code, iss_rate, pis_cofins_tax_status,
      tax_situation_code, tax_classification_code, operation_indicator_code, rps_series, rps_next_number, updated_by
    ) values (
      p_clinic_id, case when p_professional_id is null then 'clinic' else 'professional' end, p_professional_id, v_cnpj,
      trim(p_data ->> 'legal_name'), lower(trim(p_data ->> 'fiscal_email')), regexp_replace(coalesce(p_data ->> 'mobile_phone', ''), '\D', '', 'g'),
      coalesce(p_data ->> 'company_type', 'LIMITED'), coalesce((p_data ->> 'monthly_income_cents')::bigint, 0),
      regexp_replace(coalesce(p_data ->> 'postal_code', ''), '\D', '', 'g'), trim(p_data ->> 'street'), trim(p_data ->> 'street_number'),
      nullif(trim(p_data ->> 'complement'), ''), trim(p_data ->> 'district'), p_data ->> 'municipality_ibge',
      nullif(trim(p_data ->> 'municipal_registration'), ''), coalesce((p_data ->> 'simples_nacional')::boolean, false),
      nullif(p_data ->> 'special_tax_regime', ''), nullif(regexp_replace(coalesce(p_data ->> 'cnae', ''), '\D', '', 'g'), ''),
      nullif(p_data ->> 'service_list_item', ''), nullif(p_data ->> 'service_code', ''), nullif(trim(p_data ->> 'service_name'), ''),
      nullif(p_data ->> 'nbs_code', ''), coalesce((p_data ->> 'iss_rate')::numeric, 0), nullif(p_data ->> 'pis_cofins_tax_status', ''),
      nullif(p_data ->> 'tax_situation_code', ''), nullif(p_data ->> 'tax_classification_code', ''),
      nullif(p_data ->> 'operation_indicator_code', ''), nullif(p_data ->> 'rps_series', ''),
      nullif(p_data ->> 'rps_next_number', '')::integer, (select auth.uid())
    ) returning id into v_id;
  else
    update public.fiscal_issuers set
      cnpj = v_cnpj, legal_name = trim(p_data ->> 'legal_name'), fiscal_email = lower(trim(p_data ->> 'fiscal_email')),
      mobile_phone = regexp_replace(coalesce(p_data ->> 'mobile_phone', ''), '\D', '', 'g'),
      company_type = coalesce(p_data ->> 'company_type', company_type),
      monthly_income_cents = coalesce((p_data ->> 'monthly_income_cents')::bigint, monthly_income_cents),
      postal_code = regexp_replace(coalesce(p_data ->> 'postal_code', ''), '\D', '', 'g'), street = trim(p_data ->> 'street'),
      street_number = trim(p_data ->> 'street_number'), complement = nullif(trim(p_data ->> 'complement'), ''),
      district = trim(p_data ->> 'district'), municipality_ibge = p_data ->> 'municipality_ibge',
      municipal_registration = nullif(trim(p_data ->> 'municipal_registration'), ''),
      simples_nacional = coalesce((p_data ->> 'simples_nacional')::boolean, false),
      special_tax_regime = nullif(p_data ->> 'special_tax_regime', ''),
      cnae = nullif(regexp_replace(coalesce(p_data ->> 'cnae', ''), '\D', '', 'g'), ''),
      service_list_item = nullif(p_data ->> 'service_list_item', ''), service_code = nullif(p_data ->> 'service_code', ''),
      service_name = nullif(trim(p_data ->> 'service_name'), ''), nbs_code = nullif(p_data ->> 'nbs_code', ''),
      iss_rate = coalesce((p_data ->> 'iss_rate')::numeric, 0), pis_cofins_tax_status = nullif(p_data ->> 'pis_cofins_tax_status', ''),
      tax_situation_code = nullif(p_data ->> 'tax_situation_code', ''), tax_classification_code = nullif(p_data ->> 'tax_classification_code', ''),
      operation_indicator_code = nullif(p_data ->> 'operation_indicator_code', ''), rps_series = nullif(p_data ->> 'rps_series', ''),
      rps_next_number = nullif(p_data ->> 'rps_next_number', '')::integer,
      -- Dado mudou: precisa reenviar ao Asaas (a emissão só volta depois).
      fiscal_info_status = case when fiscal_info_status = 'configured' then 'pending' else fiscal_info_status end,
      issuing_enabled = false,
      updated_by = (select auth.uid()), updated_at = now()
     where id = v_current.id;
    v_id := v_current.id;
  end if;

  insert into public.fiscal_audit_log (clinic_id, issuer_id, event, actor_id, details)
  values (p_clinic_id, v_id, 'issuer_saved', (select auth.uid()), jsonb_build_object('kind', case when p_professional_id is null then 'clinic' else 'professional' end));
  return v_id;
end
$$;

-- N-P1: só o Administrador escolhe (pela clínica ou não emite).
create function public.set_professional_fiscal_route(p_clinic_id uuid, p_professional_id uuid, p_mode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_clinic_role(p_clinic_id, array['admin']::public.clinic_role[]) then
    raise exception 'Só o Administrador escolhe como o profissional emite.' using errcode = '42501';
  end if;
  perform app.require_feature(p_clinic_id, 'finance');
  if p_mode not in ('clinic', 'none') then
    raise exception 'Escolha: pela clínica ou não emite.' using errcode = 'P0001', hint = 'issuer_route';
  end if;
  if not exists (select 1 from public.professionals where id = p_professional_id and clinic_id = p_clinic_id) then
    raise exception 'Profissional não encontrado.' using errcode = 'P0001', hint = 'issuer_professional';
  end if;
  insert into public.professional_fiscal_routes (clinic_id, professional_id, mode, updated_by)
  values (p_clinic_id, p_professional_id, p_mode, (select auth.uid()))
  on conflict (professional_id) do update set mode = excluded.mode, updated_by = excluded.updated_by, updated_at = now();
  insert into public.fiscal_audit_log (clinic_id, event, actor_id, details)
  values (p_clinic_id, 'issuer_route_changed', (select auth.uid()), jsonb_build_object('professional_id', p_professional_id, 'mode', p_mode));
end
$$;

-- Pagador das notas do emissor do profissional (só o Administrador; N-P6:
-- profissional pagador precisa de login).
create function public.set_fiscal_issuer_payer(p_issuer_id uuid, p_payer text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issuer public.fiscal_issuers%rowtype;
begin
  select * into v_issuer from public.fiscal_issuers where id = p_issuer_id for update;
  if v_issuer.id is null or not app.has_clinic_role(v_issuer.clinic_id, array['admin']::public.clinic_role[]) then
    raise exception 'Só o Administrador escolhe quem paga as notas.' using errcode = '42501';
  end if;
  if v_issuer.kind = 'clinic' and p_payer <> 'clinic' then
    raise exception 'As notas do emissor da clínica são pagas pela clínica.' using errcode = 'P0001', hint = 'issuer_payer';
  end if;
  if p_payer not in ('clinic', 'professional') then
    raise exception 'Escolha quem paga.' using errcode = 'P0001', hint = 'issuer_payer';
  end if;
  if p_payer = 'professional' and not exists (
    select 1 from public.professionals where id = v_issuer.professional_id and user_id is not null
  ) then
    raise exception 'Para pagar as próprias notas, o profissional precisa de login no RecepClinic.' using errcode = 'P0001', hint = 'issuer_payer_login';
  end if;
  update public.fiscal_issuers set payer = p_payer, updated_by = (select auth.uid()), updated_at = now() where id = p_issuer_id;
  insert into public.fiscal_audit_log (clinic_id, issuer_id, event, actor_id, details)
  values (v_issuer.clinic_id, p_issuer_id, 'issuer_payer_changed', (select auth.uid()), jsonb_build_object('from', v_issuer.payer, 'to', p_payer));
end
$$;

-- O que falta para ligar a emissão (vazio = pode ligar).
create function app.fiscal_issuer_missing(p_issuer public.fiscal_issuers)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_remove(array[
    case when p_issuer.asaas_account_id is null then 'subconta' end,
    case when p_issuer.account_status <> 'approved' then 'aprovacao' end,
    case when p_issuer.fiscal_info_status <> 'configured' then 'configuracao' end,
    case when p_issuer.service_code is null or p_issuer.service_name is null then 'servico' end,
    case when coalesce(p_issuer.municipal_options ->> 'authenticationType', 'CERTIFICATE') = 'CERTIFICATE'
              and p_issuer.certificate_sent_at is null then 'certificado' end,
    case when not p_issuer.simples_nacional and p_issuer.pis_cofins_tax_status is null then 'pis_cofins' end,
    case when p_issuer.suspended_at is not null then 'suspenso' end
  ], null)
$$;

create function public.set_fiscal_issuing_enabled(p_issuer_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issuer public.fiscal_issuers%rowtype;
  v_missing text[];
begin
  select * into v_issuer from public.fiscal_issuers where id = p_issuer_id for update;
  if v_issuer.id is null or not app.can_manage_fiscal_issuer(v_issuer.clinic_id, v_issuer.professional_id) then
    raise exception 'Emissor não encontrado.' using errcode = '42501';
  end if;
  perform app.require_feature(v_issuer.clinic_id, 'finance');
  if p_enabled then
    v_missing := app.fiscal_issuer_missing(v_issuer);
    if cardinality(v_missing) > 0 then
      raise exception 'Ainda falta: %.', array_to_string(v_missing, ', ') using errcode = 'P0001', hint = 'issuer_not_ready';
    end if;
  end if;
  if v_issuer.issuing_enabled = p_enabled then
    return;
  end if;
  update public.fiscal_issuers set issuing_enabled = p_enabled, updated_by = (select auth.uid()), updated_at = now() where id = p_issuer_id;
  insert into public.fiscal_audit_log (clinic_id, issuer_id, event, actor_id)
  values (v_issuer.clinic_id, p_issuer_id, case when p_enabled then 'issuing_enabled' else 'issuing_disabled' end, (select auth.uid()));
end
$$;

-- Código de um serviço no emissor (null apaga: volta o do emissor).
create function public.set_fiscal_issuer_service_code(p_issuer_id uuid, p_service_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issuer public.fiscal_issuers%rowtype;
begin
  select * into v_issuer from public.fiscal_issuers where id = p_issuer_id;
  if v_issuer.id is null or not app.can_manage_fiscal_issuer(v_issuer.clinic_id, v_issuer.professional_id) then
    raise exception 'Emissor não encontrado.' using errcode = '42501';
  end if;
  if p_code is null or trim(p_code) = '' then
    delete from public.fiscal_issuer_service_codes where issuer_id = p_issuer_id and service_id = p_service_id;
    return;
  end if;
  insert into public.fiscal_issuer_service_codes (clinic_id, issuer_id, service_id, service_code, updated_by)
  values (v_issuer.clinic_id, p_issuer_id, p_service_id, trim(p_code), (select auth.uid()))
  on conflict (issuer_id, service_id) do update set service_code = excluded.service_code, updated_by = excluded.updated_by, updated_at = now();
end
$$;

-- ---------------------------------------------------------------------------
-- Gravações do servidor (service role), depois de falar com o Asaas
-- ---------------------------------------------------------------------------
-- Subconta criada (pelo Suporte): chave e token no Vault.
create function public.platform_link_fiscal_issuer_account(
  p_issuer_id uuid, p_account_id text, p_wallet_id text, p_api_key text, p_webhook_token text,
  p_environment text, p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issuer public.fiscal_issuers%rowtype;
begin
  select * into v_issuer from public.fiscal_issuers where id = p_issuer_id for update;
  if v_issuer.id is null then
    raise exception 'Emissor não encontrado.' using errcode = 'P0001';
  end if;
  if v_issuer.asaas_account_id is not null then
    raise exception 'Este emissor já tem subconta.' using errcode = 'P0001', hint = 'issuer_has_account';
  end if;
  update public.fiscal_issuers set
    asaas_account_id = p_account_id, asaas_wallet_id = p_wallet_id, environment = p_environment, account_status = 'pending',
    api_key_secret_id = vault.create_secret(p_api_key, 'asaas_issuer_key_' || p_issuer_id::text, 'Chave da subconta Asaas do emissor'),
    webhook_token_secret_id = vault.create_secret(p_webhook_token, 'asaas_issuer_webhook_' || p_issuer_id::text, 'Token do webhook da subconta'),
    updated_at = now()
   where id = p_issuer_id;
  insert into public.fiscal_audit_log (clinic_id, issuer_id, event, actor_id, details)
  values (v_issuer.clinic_id, p_issuer_id, 'asaas_account_created', p_actor, jsonb_build_object('account_id', p_account_id, 'environment', p_environment));
end
$$;

create function public.platform_set_fiscal_issuer_account_status(p_issuer_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issuer public.fiscal_issuers%rowtype;
begin
  select * into v_issuer from public.fiscal_issuers where id = p_issuer_id for update;
  if v_issuer.id is null or v_issuer.account_status = p_status then
    return;
  end if;
  update public.fiscal_issuers set account_status = p_status,
    issuing_enabled = case when p_status = 'approved' then issuing_enabled else false end, updated_at = now()
   where id = p_issuer_id;
  insert into public.fiscal_audit_log (clinic_id, issuer_id, event, details)
  values (v_issuer.clinic_id, p_issuer_id, 'account_status_changed', jsonb_build_object('from', v_issuer.account_status, 'to', p_status));
end
$$;

-- Resultado do envio da configuração fiscal ao Asaas.
create function public.platform_set_fiscal_issuer_fiscal_info(
  p_issuer_id uuid, p_ok boolean, p_message text, p_municipal_options jsonb,
  p_certificate_sent boolean, p_certificate_valid_until timestamptz, p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issuer public.fiscal_issuers%rowtype;
begin
  select * into v_issuer from public.fiscal_issuers where id = p_issuer_id for update;
  if v_issuer.id is null then
    raise exception 'Emissor não encontrado.' using errcode = 'P0001';
  end if;
  update public.fiscal_issuers set
    fiscal_info_status = case when p_ok then 'configured' else 'error' end,
    fiscal_info_message = left(p_message, 1000),
    fiscal_info_synced_at = now(),
    municipal_options = coalesce(p_municipal_options, municipal_options),
    certificate_sent_at = case when p_ok and p_certificate_sent then now() else certificate_sent_at end,
    certificate_valid_until = case when p_ok and p_certificate_sent then p_certificate_valid_until else certificate_valid_until end,
    issuing_enabled = case when p_ok then issuing_enabled else false end,
    updated_at = now()
   where id = p_issuer_id;
  insert into public.fiscal_audit_log (clinic_id, issuer_id, event, actor_id, details)
  values (v_issuer.clinic_id, p_issuer_id, case when p_ok then 'fiscal_info_saved' else 'fiscal_info_failed' end, p_actor,
    jsonb_build_object('certificate_sent', p_certificate_sent, 'certificate_valid_until', p_certificate_valid_until));
end
$$;

-- Regras do município lidas da subconta (sem mudar a situação fiscal).
create function public.platform_set_fiscal_issuer_municipal_options(p_issuer_id uuid, p_options jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.fiscal_issuers set municipal_options = p_options, updated_at = now() where id = p_issuer_id
$$;

-- Chave da subconta (só o servidor).
create function public.get_fiscal_issuer_api_key(p_issuer_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
    from public.fiscal_issuers i
    join vault.decrypted_secrets s on s.id = i.api_key_secret_id
   where i.id = p_issuer_id
$$;

-- Webhook: o emissor pela subconta e o token dele.
create function public.find_fiscal_issuer_by_account(p_account_id text)
returns table (issuer_id uuid, clinic_id uuid, webhook_token text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.clinic_id, s.decrypted_secret
    from public.fiscal_issuers i
    join vault.decrypted_secrets s on s.id = i.webhook_token_secret_id
   where i.asaas_account_id = p_account_id
$$;

-- ---------------------------------------------------------------------------
-- Emissor de um profissional (N-P1): o próprio, o da clínica ou nenhum.
-- ---------------------------------------------------------------------------
create function app.fiscal_issuer_for_professional(p_clinic uuid, p_professional uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select id from public.fiscal_issuers where professional_id = p_professional and clinic_id = p_clinic),
    case when coalesce((select mode from public.professional_fiscal_routes where professional_id = p_professional), 'clinic') = 'clinic'
         then (select id from public.fiscal_issuers where clinic_id = p_clinic and kind = 'clinic') end
  )
$$;

-- ---------------------------------------------------------------------------
-- Cópia dos dados fiscais atuais para o emissor da clínica
-- ---------------------------------------------------------------------------
-- O emissor antigo não guardava endereço nem e-mail fiscal: a cópia usa os da
-- conta de cobrança (quando houver) e marca a situação fiscal como pendente.
insert into public.fiscal_issuers (
  clinic_id, kind, cnpj, legal_name, fiscal_email, mobile_phone, postal_code, street, street_number, complement, district,
  municipality_ibge, municipal_registration, simples_nacional, service_code, service_list_item, iss_rate
)
select f.clinic_id, 'clinic', f.cnpj, f.legal_name,
       coalesce(nullif(b.finance_email, ''), 'pendente@recepclinic.com.br'),
       coalesce(nullif(right(regexp_replace(coalesce(b.finance_phone, ''), '\D', '', 'g'), 11), ''), '84000000000'),
       coalesce(nullif(b.postal_code, ''), '59600000'), coalesce(nullif(b.street, ''), 'A preencher'),
       coalesce(nullif(b.address_number, ''), 's/n'), b.address_complement, coalesce(nullif(b.district, ''), 'A preencher'),
       f.municipality_ibge, f.municipal_registration, f.simples_nacional <> 'not_optant', f.service_code,
       substr(f.service_code, 1, 5), f.iss_rate
  from public.clinic_fiscal_settings f
  left join public.billing_accounts b on b.clinic_id = f.clinic_id;

-- ---------------------------------------------------------------------------
-- Execução
-- ---------------------------------------------------------------------------
revoke execute on function public.save_fiscal_issuer(uuid, uuid, jsonb) from public, anon, clinic_service;
revoke execute on function public.set_professional_fiscal_route(uuid, uuid, text) from public, anon, clinic_service;
revoke execute on function public.set_fiscal_issuer_payer(uuid, text) from public, anon, clinic_service;
revoke execute on function public.set_fiscal_issuing_enabled(uuid, boolean) from public, anon, clinic_service;
revoke execute on function public.set_fiscal_issuer_service_code(uuid, uuid, text) from public, anon, clinic_service;
grant execute on function public.save_fiscal_issuer(uuid, uuid, jsonb) to authenticated;
grant execute on function public.set_professional_fiscal_route(uuid, uuid, text) to authenticated;
grant execute on function public.set_fiscal_issuer_payer(uuid, text) to authenticated;
grant execute on function public.set_fiscal_issuing_enabled(uuid, boolean) to authenticated;
grant execute on function public.set_fiscal_issuer_service_code(uuid, uuid, text) to authenticated;

revoke execute on function public.platform_link_fiscal_issuer_account(uuid, text, text, text, text, text, uuid) from public, anon, authenticated, clinic_service;
revoke execute on function public.platform_set_fiscal_issuer_account_status(uuid, text) from public, anon, authenticated, clinic_service;
revoke execute on function public.platform_set_fiscal_issuer_fiscal_info(uuid, boolean, text, jsonb, boolean, timestamptz, uuid) from public, anon, authenticated, clinic_service;
revoke execute on function public.platform_set_fiscal_issuer_municipal_options(uuid, jsonb) from public, anon, authenticated, clinic_service;
revoke execute on function public.get_fiscal_issuer_api_key(uuid) from public, anon, authenticated, clinic_service;
revoke execute on function public.find_fiscal_issuer_by_account(text) from public, anon, authenticated, clinic_service;
grant execute on function public.platform_link_fiscal_issuer_account(uuid, text, text, text, text, text, uuid) to service_role;
grant execute on function public.platform_set_fiscal_issuer_account_status(uuid, text) to service_role;
grant execute on function public.platform_set_fiscal_issuer_fiscal_info(uuid, boolean, text, jsonb, boolean, timestamptz, uuid) to service_role;
grant execute on function public.platform_set_fiscal_issuer_municipal_options(uuid, jsonb) to service_role;
grant execute on function public.get_fiscal_issuer_api_key(uuid) to service_role;
grant execute on function public.find_fiscal_issuer_by_account(text) to service_role;

revoke execute on function app.delete_fiscal_issuer_secrets() from public, anon, authenticated, clinic_service;
revoke execute on function app.fiscal_issuer_missing(public.fiscal_issuers) from public, anon, clinic_service;
grant execute on function app.fiscal_issuer_missing(public.fiscal_issuers) to authenticated, service_role;
revoke execute on function app.fiscal_issuer_for_professional(uuid, uuid) from public, anon, clinic_service;
grant execute on function app.fiscal_issuer_for_professional(uuid, uuid) to authenticated, service_role;
