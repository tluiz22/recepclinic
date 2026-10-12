-- F11.6 — Módulo financeiro: arquivo da DMED do ano.
--
-- Regras do cliente (12/out/2026):
--   1. só o Administrador da clínica gera a DMED (o Suporte só consulta);
--   2. o responsável pelo preenchimento (em geral o contador), o CPF do
--      responsável perante o CNPJ e o CNES ficam guardados para o ano
--      seguinte;
--   3. cada arquivo gerado entra na trilha fiscal (ano e totais, sem CPF).
-- O arquivo em si é montado no servidor a partir dos pagamentos (F11.2).

create table public.clinic_dmed_settings (
  clinic_id uuid primary key references public.clinics (id) on delete cascade,
  filler_cpf text not null check (app.is_valid_cpf(filler_cpf)),
  filler_name text not null check (length(trim(filler_name)) > 0),
  filler_ddd text not null check (filler_ddd ~ '^[1-9][0-9]$'),
  filler_phone text not null check (filler_phone ~ '^[0-9]{8,9}$'),
  filler_extension text check (filler_extension is null or filler_extension ~ '^[0-9]{1,6}$'),
  filler_email text check (filler_email is null or filler_email ~ '^[^@|\s]+@[^@|\s]+\.[^@|\s]+$'),
  legal_responsible_cpf text not null check (app.is_valid_cpf(legal_responsible_cpf)),
  cnes text check (cnes is null or cnes ~ '^[0-9]{7}$'),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create trigger clinic_dmed_settings_rules before insert or update on public.clinic_dmed_settings
  for each row execute function app.fiscal_row_rules();
create trigger clinic_dmed_settings_audit_platform_staff
  after insert or update or delete on public.clinic_dmed_settings
  for each row execute function app.audit_platform_staff_write();

alter table public.clinic_dmed_settings enable row level security;

create policy clinic_dmed_settings_select on public.clinic_dmed_settings
  for select to authenticated using (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]));
create policy clinic_dmed_settings_insert on public.clinic_dmed_settings
  for insert to authenticated with check (app.is_clinic_admin_member(clinic_id));
create policy clinic_dmed_settings_update on public.clinic_dmed_settings
  for update to authenticated using (app.is_clinic_admin_member(clinic_id)) with check (app.is_clinic_admin_member(clinic_id));

revoke delete on public.clinic_dmed_settings from authenticated;
revoke all on public.clinic_dmed_settings from anon, clinic_service;
grant execute on function app.is_clinic_admin_member(uuid) to authenticated;

-- Trilha (regra 3): o arquivo gerado.
alter table public.fiscal_audit_log drop constraint fiscal_audit_log_event_check;
alter table public.fiscal_audit_log add constraint fiscal_audit_log_event_check
  check (event in ('terms_accepted', 'certificate_uploaded', 'certificate_replaced', 'certificate_revoked', 'dmed_generated'));

create function public.log_dmed_generated(p_clinic_id uuid, p_year integer, p_responsibles integer, p_total_cents bigint, p_left_out integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_clinic_admin_member(p_clinic_id) then
    raise exception 'Só o Administrador da clínica gera a DMED.' using errcode = '42501';
  end if;
  perform app.require_feature(p_clinic_id, 'finance');
  insert into public.fiscal_audit_log (clinic_id, event, actor_id, details)
  values (p_clinic_id, 'dmed_generated', (select auth.uid()),
    jsonb_build_object('year', p_year, 'responsibles', p_responsibles, 'total_cents', p_total_cents, 'left_out', p_left_out));
end
$$;

revoke execute on function public.log_dmed_generated(uuid, integer, integer, bigint, integer) from public, anon, clinic_service;
grant execute on function public.log_dmed_generated(uuid, integer, integer, bigint, integer) to authenticated;
