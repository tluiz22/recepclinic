-- F11.3 — Módulo financeiro: dados fiscais da clínica e certificado A1.
--
-- Regras do cliente (12/out/2026):
--   1. dados fiscais (CNPJ, razão social, inscrição municipal, município,
--      Simples Nacional, regime especial, código do serviço e alíquota do
--      ISS): o Administrador preenche; o Suporte também (implantação);
--   2. código do serviço: um padrão da clínica e, quando for diferente, um
--      próprio por serviço;
--   3. município: só os liberados (por ora, Mossoró/RN, IBGE 2408003);
--   4. certificado A1 (.pfx e senha) no cofre (Vault): só o Administrador da
--      clínica envia, troca e revoga (o Suporte nunca), aceitando o termo de
--      autorização; nunca volta para a tela (só titular, CNPJ e validade);
--   5. o certificado só é aceito se for do mesmo CNPJ dos dados fiscais e
--      ainda válido;
--   6. trilha só de inclusão: aceite do termo, envio, troca e revogação.

-- ---------------------------------------------------------------------------
-- CNPJ: 14 caracteres sem máscara, com os dígitos verificadores certos. Já no
-- formato alfanumérico da Receita (letras nas 12 primeiras posições, valor =
-- código ASCII − 48); o CNPJ só de números é o caso comum.
-- ---------------------------------------------------------------------------
create function app.is_valid_cnpj(p_cnpj text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_weights integer[] := array[6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  v_sum integer;
  v_check integer;
begin
  if p_cnpj is null or p_cnpj !~ '^[0-9A-Z]{12}[0-9]{2}$' or p_cnpj = repeat(substr(p_cnpj, 1, 1), 14) then
    return false;
  end if;
  for v_pos in 13..14 loop
    v_sum := 0;
    for i in 1..(v_pos - 1) loop
      v_sum := v_sum + (ascii(substr(p_cnpj, i, 1)) - 48) * v_weights[i + 14 - v_pos];
    end loop;
    v_check := case when v_sum % 11 < 2 then 0 else 11 - v_sum % 11 end;
    if v_check <> substr(p_cnpj, v_pos, 1)::integer then
      return false;
    end if;
  end loop;
  return true;
end
$$;

-- Municípios liberados (regra 3): cidade nova entra por migração, depois de
-- conferido que ela emite pelo padrão nacional.
create function app.is_supported_fiscal_municipality(p_ibge text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_ibge = any (array['2408003'])
$$;

-- Código de tributação nacional: item, subitem e desdobro (ex.: 04.01.01).
create function app.is_valid_service_code(p_code text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_code ~ '^[0-9]{2}\.[0-9]{2}\.[0-9]{2}$'
$$;

-- ---------------------------------------------------------------------------
-- Dados fiscais da clínica (regra 1)
-- ---------------------------------------------------------------------------
create table public.clinic_fiscal_settings (
  clinic_id uuid primary key references public.clinics (id) on delete cascade,
  cnpj text not null check (app.is_valid_cnpj(cnpj)),
  legal_name text not null check (length(trim(legal_name)) > 0),
  municipal_registration text check (municipal_registration is null or municipal_registration ~ '^[0-9A-Za-z./-]{1,20}$'),
  municipality_ibge text not null check (app.is_supported_fiscal_municipality(municipality_ibge)),
  -- Situação no Simples Nacional (opSimpNac da nota): não optante, MEI ou ME/EPP.
  simples_nacional text not null check (simples_nacional in ('not_optant', 'mei', 'me_epp')),
  -- Regime especial de tributação (regEspTrib da nota).
  special_regime text not null default 'none'
    check (special_regime in ('none', 'cooperative', 'estimate', 'municipal_micro', 'notary', 'autonomous', 'professional_society')),
  service_code text not null check (app.is_valid_service_code(service_code)),
  iss_rate numeric(5, 2) not null check (iss_rate >= 0 and iss_rate <= 5),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Código próprio de um serviço (regra 2); sem linha, vale o da clínica.
create table public.service_fiscal_codes (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  service_id uuid primary key,
  service_code text not null check (app.is_valid_service_code(service_code)),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (clinic_id, service_id) references public.services (clinic_id, id) on delete cascade
);

-- Item liberado; quem gravou e quando.
create function app.fiscal_row_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_feature(new.clinic_id, 'finance');
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  return new;
end
$$;

create trigger clinic_fiscal_settings_rules before insert or update on public.clinic_fiscal_settings
  for each row execute function app.fiscal_row_rules();
create trigger service_fiscal_codes_rules before insert or update on public.service_fiscal_codes
  for each row execute function app.fiscal_row_rules();

-- ---------------------------------------------------------------------------
-- Certificado A1 (regras 4 e 5): o arquivo e a senha ficam no Vault; aqui,
-- só o que a tela mostra e os ponteiros para os segredos.
-- ---------------------------------------------------------------------------
create table public.clinic_fiscal_certificates (
  clinic_id uuid primary key references public.clinics (id) on delete cascade,
  pfx_secret_id uuid not null,
  password_secret_id uuid not null,
  subject_name text not null,
  subject_cnpj text not null,
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  terms_version text not null,
  uploaded_by uuid references auth.users (id) on delete set null,
  uploaded_at timestamptz not null default now()
);

-- Trilha (regra 6): só a função grava; ninguém altera nem apaga.
create table public.fiscal_audit_log (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  event text not null check (event in ('terms_accepted', 'certificate_uploaded', 'certificate_replaced', 'certificate_revoked')),
  actor_id uuid references auth.users (id) on delete set null,
  -- Sem segredo nenhum: versão do termo, titular, CNPJ e validade.
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index fiscal_audit_log_clinic_idx on public.fiscal_audit_log (clinic_id, created_at desc);

-- O segredo some junto com o certificado (revogar ou excluir a clínica).
create function app.delete_fiscal_certificate_secrets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id in (old.pfx_secret_id, old.password_secret_id);
  return null;
end
$$;

create trigger clinic_fiscal_certificates_delete_secrets
  after delete on public.clinic_fiscal_certificates
  for each row execute function app.delete_fiscal_certificate_secrets();

-- Administrador de verdade da clínica (o Suporte não conta: regra 4).
create function app.is_clinic_admin_member(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinic_members
     where clinic_id = p_clinic_id
       and user_id = (select auth.uid())
       and 'admin' = any (roles)
  )
$$;

-- Envia ou troca o certificado. Titular, CNPJ e validade vêm do servidor,
-- que abriu o .pfx com a senha; aqui o banco confere o CNPJ e a validade.
create function public.set_fiscal_certificate(
  p_clinic_id uuid,
  p_pfx_base64 text,
  p_password text,
  p_subject_name text,
  p_subject_cnpj text,
  p_valid_from timestamptz,
  p_valid_until timestamptz,
  p_terms_version text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cnpj text;
  v_current public.clinic_fiscal_certificates%rowtype;
  v_pfx uuid;
  v_password uuid;
  v_details jsonb;
begin
  if not app.is_clinic_admin_member(p_clinic_id) then
    raise exception 'Só o Administrador da clínica envia o certificado.' using errcode = '42501';
  end if;
  perform app.require_feature(p_clinic_id, 'finance');
  if length(coalesce(trim(p_terms_version), '')) = 0 then
    raise exception 'Aceite o termo de autorização.' using errcode = 'P0001', hint = 'fiscal_terms';
  end if;
  if length(coalesce(p_pfx_base64, '')) = 0 or p_password is null then
    raise exception 'Envie o arquivo do certificado e a senha.' using errcode = 'P0001', hint = 'fiscal_certificate';
  end if;
  select cnpj into v_cnpj from public.clinic_fiscal_settings where clinic_id = p_clinic_id;
  if v_cnpj is null then
    raise exception 'Preencha e salve os dados fiscais (CNPJ) antes do certificado.' using errcode = 'P0001', hint = 'fiscal_settings_missing';
  end if;
  if upper(coalesce(p_subject_cnpj, '')) <> v_cnpj then
    raise exception 'O certificado é de outro CNPJ (%), diferente do CNPJ da clínica.', coalesce(p_subject_cnpj, 'sem CNPJ')
      using errcode = 'P0001', hint = 'fiscal_certificate_cnpj';
  end if;
  if p_valid_until <= now() then
    raise exception 'Este certificado já venceu.' using errcode = 'P0001', hint = 'fiscal_certificate_expired';
  end if;

  select * into v_current from public.clinic_fiscal_certificates where clinic_id = p_clinic_id for update;
  if found then
    perform vault.update_secret(v_current.pfx_secret_id, p_pfx_base64);
    perform vault.update_secret(v_current.password_secret_id, p_password);
    update public.clinic_fiscal_certificates
       set subject_name = p_subject_name, subject_cnpj = upper(p_subject_cnpj), valid_from = p_valid_from,
           valid_until = p_valid_until, terms_version = p_terms_version,
           uploaded_by = (select auth.uid()), uploaded_at = now()
     where clinic_id = p_clinic_id;
  else
    v_pfx := vault.create_secret(p_pfx_base64, 'fiscal_pfx_' || p_clinic_id::text, 'Certificado A1 da clínica');
    v_password := vault.create_secret(p_password, 'fiscal_pfx_password_' || p_clinic_id::text, 'Senha do certificado A1 da clínica');
    insert into public.clinic_fiscal_certificates
      (clinic_id, pfx_secret_id, password_secret_id, subject_name, subject_cnpj, valid_from, valid_until, terms_version, uploaded_by)
    values (p_clinic_id, v_pfx, v_password, p_subject_name, upper(p_subject_cnpj), p_valid_from, p_valid_until, p_terms_version, (select auth.uid()));
  end if;

  v_details := jsonb_build_object('subject_name', p_subject_name, 'cnpj', upper(p_subject_cnpj), 'valid_until', p_valid_until);
  insert into public.fiscal_audit_log (clinic_id, event, actor_id, details) values
    (p_clinic_id, 'terms_accepted', (select auth.uid()), jsonb_build_object('terms_version', p_terms_version)),
    (p_clinic_id, case when v_current.clinic_id is null then 'certificate_uploaded' else 'certificate_replaced' end, (select auth.uid()), v_details);
end
$$;

-- Revoga: apaga o certificado e a senha do Vault e desliga a emissão na hora.
-- Vale mesmo com o item desligado.
create function public.revoke_fiscal_certificate(p_clinic_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.clinic_fiscal_certificates%rowtype;
begin
  if not app.is_clinic_admin_member(p_clinic_id) then
    raise exception 'Só o Administrador da clínica revoga o certificado.' using errcode = '42501';
  end if;
  delete from public.clinic_fiscal_certificates where clinic_id = p_clinic_id returning * into v_current;
  if v_current.clinic_id is null then
    raise exception 'A clínica não tem certificado.' using errcode = 'P0001', hint = 'fiscal_certificate_missing';
  end if;
  insert into public.fiscal_audit_log (clinic_id, event, actor_id, details) values
    (p_clinic_id, 'certificate_revoked', (select auth.uid()),
     jsonb_build_object('subject_name', v_current.subject_name, 'cnpj', v_current.subject_cnpj, 'valid_until', v_current.valid_until));
end
$$;

-- Registro do Suporte (F3), como toda tabela da clínica.
create trigger clinic_fiscal_settings_audit_platform_staff
  after insert or update or delete on public.clinic_fiscal_settings
  for each row execute function app.audit_platform_staff_write();
create trigger service_fiscal_codes_audit_platform_staff
  after insert or update or delete on public.service_fiscal_codes
  for each row execute function app.audit_platform_staff_write();
create trigger clinic_fiscal_certificates_audit_platform_staff
  after insert or update or delete on public.clinic_fiscal_certificates
  for each row execute function app.audit_platform_staff_write();
create trigger fiscal_audit_log_audit_platform_staff
  after insert or update or delete on public.fiscal_audit_log
  for each row execute function app.audit_platform_staff_write();

-- ---------------------------------------------------------------------------
-- RLS: o Administrador (e o Suporte) leem; dados fiscais e códigos, os dois
-- gravam; certificado e trilha, só pelas funções acima.
-- ---------------------------------------------------------------------------
alter table public.clinic_fiscal_settings enable row level security;
alter table public.service_fiscal_codes enable row level security;
alter table public.clinic_fiscal_certificates enable row level security;
alter table public.fiscal_audit_log enable row level security;

create policy clinic_fiscal_settings_select on public.clinic_fiscal_settings
  for select to authenticated using (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]));
create policy clinic_fiscal_settings_insert on public.clinic_fiscal_settings
  for insert to authenticated with check (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]));
create policy clinic_fiscal_settings_update on public.clinic_fiscal_settings
  for update to authenticated using (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]))
  with check (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]));

create policy service_fiscal_codes_select on public.service_fiscal_codes
  for select to authenticated using (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]));
create policy service_fiscal_codes_insert on public.service_fiscal_codes
  for insert to authenticated with check (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]));
create policy service_fiscal_codes_update on public.service_fiscal_codes
  for update to authenticated using (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]))
  with check (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]));
create policy service_fiscal_codes_delete on public.service_fiscal_codes
  for delete to authenticated using (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]));

create policy clinic_fiscal_certificates_select on public.clinic_fiscal_certificates
  for select to authenticated using (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]));
create policy fiscal_audit_log_select on public.fiscal_audit_log
  for select to authenticated using (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]));

revoke delete on public.clinic_fiscal_settings from authenticated;
revoke insert, update, delete on public.clinic_fiscal_certificates, public.fiscal_audit_log from authenticated;
revoke all on public.clinic_fiscal_settings, public.service_fiscal_codes, public.clinic_fiscal_certificates, public.fiscal_audit_log
  from anon, clinic_service;

revoke execute on function public.set_fiscal_certificate(uuid, text, text, text, text, timestamptz, timestamptz, text) from public, anon, clinic_service;
revoke execute on function public.revoke_fiscal_certificate(uuid) from public, anon, clinic_service;
grant execute on function public.set_fiscal_certificate(uuid, text, text, text, text, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.revoke_fiscal_certificate(uuid) to authenticated;
revoke execute on function app.fiscal_row_rules(), app.delete_fiscal_certificate_secrets() from public, anon, authenticated, clinic_service;
revoke execute on function app.is_clinic_admin_member(uuid) from public, anon, clinic_service;
grant execute on function app.is_valid_cnpj(text), app.is_supported_fiscal_municipality(text), app.is_valid_service_code(text) to authenticated;
