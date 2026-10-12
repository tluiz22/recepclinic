-- F11.4 — Módulo financeiro: emissão e cancelamento da NFS-e na API nacional
-- (Sefin Nacional), com o certificado A1 da clínica.
--
-- Regras do cliente (12/out/2026):
--   1. a nota sai ao registrar o pagamento (ou depois, por "Emitir nota"), com
--      a competência na data do pagamento, no CPF de quem pagou;
--   2. uma nota ativa por pagamento; número da DPS sequencial por clínica e
--      ambiente, com trava; estado "emitindo" durante o pedido; resposta
--      perdida = consultar a Receita antes de repetir (botão e rotina diária);
--   3. a Recepção e o Administrador emitem; só o Administrador cancela (com o
--      motivo da Receita: 1 erro na emissão, 2 serviço não prestado, 9 outros);
--   4. toda clínica começa em Produção Restrita (testes); só o Suporte passa
--      para Produção, e a troca vai para a trilha;
--   5. pagamento com nota ativa não se exclui (cancele a nota antes);
--   6. ME/EPP do Simples: regime de apuração e percentual aproximado de
--      tributos do Simples, exigidos pela nota nacional;
--   7. XML da nota num bucket privado, pasta por clínica; trilha só de
--      inclusão (pedido, resultado, código de erro da Receita).

-- ---------------------------------------------------------------------------
-- Dados fiscais: Simples (regra 6) e ambiente (regra 4)
-- ---------------------------------------------------------------------------
alter table public.clinic_fiscal_settings
  add column simples_regime text check (simples_regime is null or simples_regime in ('1', '2', '3')),
  add column simples_total_rate numeric(4, 2) check (simples_total_rate is null or (simples_total_rate >= 0 and simples_total_rate < 100)),
  add column environment text not null default 'restricted' check (environment in ('restricted', 'production'));

alter table public.clinic_fiscal_settings
  add constraint clinic_fiscal_settings_simples_check
  check (simples_nacional <> 'me_epp' or (simples_regime is not null and simples_total_rate is not null));

alter table public.fiscal_audit_log drop constraint fiscal_audit_log_event_check;
alter table public.fiscal_audit_log add constraint fiscal_audit_log_event_check
  check (event in (
    'terms_accepted', 'certificate_uploaded', 'certificate_replaced', 'certificate_revoked', 'dmed_generated',
    'environment_changed', 'nfse_issue_requested', 'nfse_issued', 'nfse_rejected',
    'nfse_cancel_requested', 'nfse_canceled', 'nfse_cancel_rejected'
  ));

-- Ambiente: clínica nova em Produção Restrita; só o Suporte troca (regra 4).
create function app.fiscal_environment_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.environment <> 'restricted' and not app.is_platform_staff() then
      new.environment := 'restricted';
    end if;
    return new;
  end if;
  if new.environment is distinct from old.environment then
    if not app.is_platform_staff() then
      raise exception 'Só o Suporte troca o ambiente da nota fiscal.' using errcode = '42501';
    end if;
    insert into public.fiscal_audit_log (clinic_id, event, actor_id, details)
    values (new.clinic_id, 'environment_changed', (select auth.uid()), jsonb_build_object('from', old.environment, 'to', new.environment));
  end if;
  return new;
end
$$;

create trigger clinic_fiscal_settings_environment before insert or update on public.clinic_fiscal_settings
  for each row execute function app.fiscal_environment_rules();

-- ---------------------------------------------------------------------------
-- Número da DPS por clínica e ambiente (regra 2)
-- ---------------------------------------------------------------------------
create table public.nfse_dps_counters (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  environment text not null check (environment in ('restricted', 'production')),
  last_number bigint not null check (last_number > 0),
  primary key (clinic_id, environment)
);

-- ---------------------------------------------------------------------------
-- Notas
-- ---------------------------------------------------------------------------
create table public.nfse_invoices (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  payment_id uuid not null,
  environment text not null check (environment in ('restricted', 'production')),
  series text not null,
  dps_number bigint not null check (dps_number > 0),
  -- "DPS" + município + tipo de inscrição + CNPJ + série + número (45).
  dps_id text not null check (dps_id ~ '^DPS[0-9]{42}$'),
  -- issuing: pedido em curso (ou resposta perdida); issued: nota emitida;
  -- rejected: a Receita recusou; canceling: cancelamento em curso; canceled.
  status text not null default 'issuing' check (status in ('issuing', 'issued', 'rejected', 'canceling', 'canceled')),
  access_key text check (access_key is null or access_key ~ '^[0-9]{50}$'),
  nfse_number text,
  xml_path text,
  error_code text,
  error_message text,
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  issued_at timestamptz,
  checked_at timestamptz,
  cancel_reason_code smallint check (cancel_reason_code is null or cancel_reason_code in (1, 2, 9)),
  cancel_reason_text text,
  cancel_requested_by uuid references auth.users (id) on delete set null,
  canceled_at timestamptz,
  unique (clinic_id, id),
  unique (clinic_id, environment, dps_number),
  foreign key (clinic_id, payment_id) references public.payments (clinic_id, id),
  check (status not in ('issued', 'canceling', 'canceled') or access_key is not null)
);

-- Uma nota ativa por pagamento (regra 2).
create unique index nfse_invoices_one_active_per_payment on public.nfse_invoices (payment_id)
  where status in ('issuing', 'issued', 'canceling');
create index nfse_invoices_pending_idx on public.nfse_invoices (status, requested_at) where status in ('issuing', 'canceling');

create trigger nfse_dps_counters_audit_platform_staff
  after insert or update or delete on public.nfse_dps_counters
  for each row execute function app.audit_platform_staff_write();
create trigger nfse_invoices_audit_platform_staff
  after insert or update or delete on public.nfse_invoices
  for each row execute function app.audit_platform_staff_write();

alter table public.nfse_dps_counters enable row level security;
alter table public.nfse_invoices enable row level security;

create policy nfse_dps_counters_select on public.nfse_dps_counters
  for select to authenticated using (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]));
create policy nfse_invoices_select on public.nfse_invoices
  for select to authenticated using (app.can_read_finance(clinic_id));

-- Só as funções abaixo gravam.
revoke insert, update, delete on public.nfse_dps_counters, public.nfse_invoices from authenticated;
revoke all on public.nfse_dps_counters, public.nfse_invoices from anon, clinic_service;

-- Pagamento com nota ativa não se exclui (regra 5).
create function app.payment_keep_with_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null and exists (
    select 1 from public.nfse_invoices where payment_id = new.id and status in ('issuing', 'issued', 'canceling')
  ) then
    raise exception 'Este pagamento tem nota fiscal: cancele a nota antes de excluir.' using errcode = 'P0001', hint = 'payment_has_invoice';
  end if;
  return new;
end
$$;

create trigger payments_keep_with_invoice before update on public.payments
  for each row execute function app.payment_keep_with_invoice();

-- ---------------------------------------------------------------------------
-- Emitir (regras 1 a 3)
-- ---------------------------------------------------------------------------
-- Começa a emissão: confere tudo, reserva o número (com trava) e cria a nota
-- "emitindo". Devolve o que o servidor precisa para montar a DPS.
create function public.begin_nfse_issue(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_settings public.clinic_fiscal_settings%rowtype;
  v_certificate public.clinic_fiscal_certificates%rowtype;
  v_number bigint;
  v_series text := '1';
  v_invoice uuid;
  v_dps_id text;
  v_category text;
  v_service_code text;
  v_appointment_at timestamptz;
  v_timezone text;
  v_patient_name text;
begin
  select * into v_payment from public.payments where id = p_payment_id;
  if v_payment.id is null or not app.can_edit_finance(v_payment.clinic_id) then
    raise exception 'Pagamento não encontrado.' using errcode = '42501';
  end if;
  perform app.require_feature(v_payment.clinic_id, 'finance');
  if v_payment.deleted_at is not null then
    raise exception 'Pagamento excluído não recebe nota.' using errcode = 'P0001', hint = 'nfse_payment_deleted';
  end if;
  if v_payment.payer_cpf is null then
    raise exception 'Falta o CPF de quem pagou: exclua e registre o pagamento de novo com o CPF.' using errcode = 'P0001', hint = 'nfse_payer_cpf';
  end if;
  if exists (select 1 from public.nfse_invoices where payment_id = p_payment_id and status in ('issuing', 'issued', 'canceling')) then
    raise exception 'Este pagamento já tem nota (ou uma emissão em curso).' using errcode = 'P0001', hint = 'nfse_active';
  end if;

  select * into v_settings from public.clinic_fiscal_settings where clinic_id = v_payment.clinic_id;
  if v_settings.clinic_id is null then
    raise exception 'Preencha os dados fiscais da clínica em Configurações › Nota fiscal.' using errcode = 'P0001', hint = 'nfse_settings';
  end if;
  if v_settings.cnpj !~ '^[0-9]{14}$' then
    raise exception 'A nota nacional ainda não aceita CNPJ com letras.' using errcode = 'P0001', hint = 'nfse_cnpj';
  end if;
  select * into v_certificate from public.clinic_fiscal_certificates where clinic_id = v_payment.clinic_id;
  if v_certificate.clinic_id is null then
    raise exception 'A clínica ainda não enviou o certificado digital A1.' using errcode = 'P0001', hint = 'nfse_certificate';
  end if;
  if v_certificate.valid_until <= now() then
    raise exception 'O certificado digital A1 venceu: envie o novo em Configurações › Nota fiscal.' using errcode = 'P0001', hint = 'nfse_certificate';
  end if;

  select a.scheduled_at, s.category::text, coalesce(c.service_code, v_settings.service_code), pt.full_name
    into v_appointment_at, v_category, v_service_code, v_patient_name
    from public.appointments a
    join public.services s on s.id = a.service_id
    join public.patients pt on pt.id = a.patient_id
    left join public.service_fiscal_codes c on c.service_id = a.service_id
   where a.id = v_payment.appointment_id;
  select timezone into v_timezone from public.clinic_settings where clinic_id = v_payment.clinic_id;

  insert into public.nfse_dps_counters as c (clinic_id, environment, last_number)
  values (v_payment.clinic_id, v_settings.environment, 1)
  on conflict (clinic_id, environment) do update set last_number = c.last_number + 1
  returning last_number into v_number;

  v_dps_id := 'DPS' || v_settings.municipality_ibge || '2' || v_settings.cnpj || lpad(v_series, 5, '0') || lpad(v_number::text, 15, '0');
  insert into public.nfse_invoices (clinic_id, payment_id, environment, series, dps_number, dps_id, requested_by)
  values (v_payment.clinic_id, p_payment_id, v_settings.environment, v_series, v_number, v_dps_id, (select auth.uid()))
  returning id into v_invoice;

  insert into public.fiscal_audit_log (clinic_id, event, actor_id, details)
  values (v_payment.clinic_id, 'nfse_issue_requested', (select auth.uid()),
    jsonb_build_object('invoice_id', v_invoice, 'payment_id', p_payment_id, 'dps_number', v_number, 'environment', v_settings.environment));

  return jsonb_build_object(
    'invoice_id', v_invoice,
    'environment', v_settings.environment,
    'series', v_series,
    'dps_number', v_number,
    'dps_id', v_dps_id,
    'competence', v_payment.paid_on,
    'amount_cents', v_payment.amount_cents,
    'payer_cpf', v_payment.payer_cpf,
    'payer_name', v_payment.payer_name,
    'patient_name', v_patient_name,
    'appointment_date', (v_appointment_at at time zone v_timezone)::date,
    'category', v_category,
    'timezone', v_timezone,
    'cnpj', v_settings.cnpj,
    'municipal_registration', v_settings.municipal_registration,
    'municipality_ibge', v_settings.municipality_ibge,
    'simples_nacional', v_settings.simples_nacional,
    'simples_regime', v_settings.simples_regime,
    'simples_total_rate', v_settings.simples_total_rate,
    'special_regime', v_settings.special_regime,
    'service_code', v_service_code,
    'iss_rate', v_settings.iss_rate
  );
end
$$;

-- Resultado da emissão: issued (com a chave), rejected (código e texto da
-- Receita) ou pending (sem resposta: fica "emitindo" e guarda o motivo).
create function public.finish_nfse_issue(
  p_invoice_id uuid,
  p_outcome text,
  p_access_key text default null,
  p_nfse_number text default null,
  p_xml_path text default null,
  p_error_code text default null,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.nfse_invoices%rowtype;
begin
  select * into v_invoice from public.nfse_invoices where id = p_invoice_id for update;
  if v_invoice.id is null or not ((select auth.role()) = 'service_role' or app.can_edit_finance(v_invoice.clinic_id)) then
    raise exception 'Nota não encontrada.' using errcode = '42501';
  end if;
  if v_invoice.status <> 'issuing' then
    raise exception 'Esta nota não está em emissão.' using errcode = 'P0001', hint = 'nfse_state';
  end if;
  if p_outcome = 'issued' then
    update public.nfse_invoices
       set status = 'issued', access_key = p_access_key, nfse_number = p_nfse_number, xml_path = p_xml_path,
           issued_at = now(), checked_at = now(), error_code = null, error_message = null
     where id = p_invoice_id;
    insert into public.fiscal_audit_log (clinic_id, event, actor_id, details)
    values (v_invoice.clinic_id, 'nfse_issued', (select auth.uid()),
      jsonb_build_object('invoice_id', p_invoice_id, 'nfse_number', p_nfse_number, 'environment', v_invoice.environment));
  elsif p_outcome = 'rejected' then
    update public.nfse_invoices
       set status = 'rejected', error_code = left(p_error_code, 50), error_message = left(p_error_message, 2000), checked_at = now()
     where id = p_invoice_id;
    insert into public.fiscal_audit_log (clinic_id, event, actor_id, details)
    values (v_invoice.clinic_id, 'nfse_rejected', (select auth.uid()),
      jsonb_build_object('invoice_id', p_invoice_id, 'error_code', left(p_error_code, 50)));
  elsif p_outcome = 'pending' then
    update public.nfse_invoices
       set error_code = left(p_error_code, 50), error_message = left(p_error_message, 2000), checked_at = now()
     where id = p_invoice_id;
  else
    raise exception 'Resultado desconhecido.' using errcode = 'P0001';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Cancelar (regra 3): só o Administrador da clínica
-- ---------------------------------------------------------------------------
create function public.begin_nfse_cancel(p_invoice_id uuid, p_reason_code integer, p_reason_text text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.nfse_invoices%rowtype;
  v_cnpj text;
begin
  select * into v_invoice from public.nfse_invoices where id = p_invoice_id for update;
  if v_invoice.id is null or not app.is_clinic_admin_member(v_invoice.clinic_id) then
    raise exception 'Só o Administrador da clínica cancela a nota.' using errcode = '42501';
  end if;
  perform app.require_feature(v_invoice.clinic_id, 'finance');
  if v_invoice.status <> 'issued' then
    raise exception 'Só nota emitida pode ser cancelada.' using errcode = 'P0001', hint = 'nfse_state';
  end if;
  if p_reason_code not in (1, 2, 9) then
    raise exception 'Escolha o motivo do cancelamento.' using errcode = 'P0001', hint = 'nfse_cancel_reason';
  end if;
  if length(trim(coalesce(p_reason_text, ''))) not between 15 and 255 then
    raise exception 'Explique o motivo com 15 a 255 caracteres.' using errcode = 'P0001', hint = 'nfse_cancel_reason';
  end if;
  if not exists (select 1 from public.clinic_fiscal_certificates where clinic_id = v_invoice.clinic_id and valid_until > now()) then
    raise exception 'Sem certificado digital A1 em dia: envie o certificado antes de cancelar.' using errcode = 'P0001', hint = 'nfse_certificate';
  end if;
  select cnpj into v_cnpj from public.clinic_fiscal_settings where clinic_id = v_invoice.clinic_id;

  update public.nfse_invoices
     set status = 'canceling', cancel_reason_code = p_reason_code, cancel_reason_text = trim(p_reason_text),
         cancel_requested_by = (select auth.uid()), error_code = null, error_message = null
   where id = p_invoice_id;
  insert into public.fiscal_audit_log (clinic_id, event, actor_id, details)
  values (v_invoice.clinic_id, 'nfse_cancel_requested', (select auth.uid()),
    jsonb_build_object('invoice_id', p_invoice_id, 'nfse_number', v_invoice.nfse_number, 'reason_code', p_reason_code));

  return jsonb_build_object(
    'invoice_id', p_invoice_id,
    'environment', v_invoice.environment,
    'access_key', v_invoice.access_key,
    'cnpj', v_cnpj,
    'reason_code', p_reason_code,
    'reason_text', trim(p_reason_text)
  );
end
$$;

-- Resultado do cancelamento: canceled, rejected (a nota volta a "emitida",
-- com o erro) ou pending (sem resposta: fica "cancelando").
create function public.finish_nfse_cancel(
  p_invoice_id uuid,
  p_outcome text,
  p_error_code text default null,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.nfse_invoices%rowtype;
begin
  select * into v_invoice from public.nfse_invoices where id = p_invoice_id for update;
  if v_invoice.id is null or not ((select auth.role()) = 'service_role' or app.is_clinic_admin_member(v_invoice.clinic_id)) then
    raise exception 'Nota não encontrada.' using errcode = '42501';
  end if;
  if v_invoice.status <> 'canceling' then
    raise exception 'Esta nota não está em cancelamento.' using errcode = 'P0001', hint = 'nfse_state';
  end if;
  if p_outcome = 'canceled' then
    update public.nfse_invoices set status = 'canceled', canceled_at = now(), checked_at = now() where id = p_invoice_id;
    insert into public.fiscal_audit_log (clinic_id, event, actor_id, details)
    values (v_invoice.clinic_id, 'nfse_canceled', (select auth.uid()),
      jsonb_build_object('invoice_id', p_invoice_id, 'nfse_number', v_invoice.nfse_number));
  elsif p_outcome = 'rejected' then
    update public.nfse_invoices
       set status = 'issued', error_code = left(p_error_code, 50), error_message = left(p_error_message, 2000), checked_at = now()
     where id = p_invoice_id;
    insert into public.fiscal_audit_log (clinic_id, event, actor_id, details)
    values (v_invoice.clinic_id, 'nfse_cancel_rejected', (select auth.uid()),
      jsonb_build_object('invoice_id', p_invoice_id, 'error_code', left(p_error_code, 50)));
  elsif p_outcome = 'pending' then
    update public.nfse_invoices
       set error_code = left(p_error_code, 50), error_message = left(p_error_message, 2000), checked_at = now()
     where id = p_invoice_id;
  else
    raise exception 'Resultado desconhecido.' using errcode = 'P0001';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Só a plataforma (service role): certificado para assinar e as pendentes
-- para a rotina diária (regra 2).
-- ---------------------------------------------------------------------------
create function public.get_fiscal_certificate_secret(p_clinic_id uuid)
returns table (pfx_base64 text, password text)
language sql
stable
security definer
set search_path = ''
as $$
  select pfx.decrypted_secret, pwd.decrypted_secret
    from public.clinic_fiscal_certificates c
    join vault.decrypted_secrets pfx on pfx.id = c.pfx_secret_id
    join vault.decrypted_secrets pwd on pwd.id = c.password_secret_id
   where c.clinic_id = p_clinic_id and c.valid_until > now()
$$;

create function public.list_pending_nfse_invoices(p_before timestamptz)
returns table (invoice_id uuid, clinic_id uuid, status text, environment text, dps_id text, access_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select id, clinic_id, status, environment, dps_id, access_key
    from public.nfse_invoices
   where status in ('issuing', 'canceling') and requested_at < p_before
   order by requested_at
   limit 200
$$;

revoke execute on function public.begin_nfse_issue(uuid) from public, anon, clinic_service;
revoke execute on function public.finish_nfse_issue(uuid, text, text, text, text, text, text) from public, anon, clinic_service;
revoke execute on function public.begin_nfse_cancel(uuid, integer, text) from public, anon, clinic_service;
revoke execute on function public.finish_nfse_cancel(uuid, text, text, text) from public, anon, clinic_service;
grant execute on function public.begin_nfse_issue(uuid) to authenticated;
grant execute on function public.finish_nfse_issue(uuid, text, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.begin_nfse_cancel(uuid, integer, text) to authenticated;
grant execute on function public.finish_nfse_cancel(uuid, text, text, text) to authenticated, service_role;
revoke execute on function public.get_fiscal_certificate_secret(uuid) from public, anon, authenticated, clinic_service;
revoke execute on function public.list_pending_nfse_invoices(timestamptz) from public, anon, authenticated, clinic_service;
grant execute on function public.get_fiscal_certificate_secret(uuid) to service_role;
grant execute on function public.list_pending_nfse_invoices(timestamptz) to service_role;
revoke execute on function app.fiscal_environment_rules(), app.payment_keep_with_invoice() from public, anon, authenticated, clinic_service;

-- ---------------------------------------------------------------------------
-- XML das notas (regra 7): bucket privado, "<clinic_id>/<nota>.xml"
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nfse-xml', 'nfse-xml', false, 1048576, array['application/xml']);

create function app.nfse_xml_folder_clinic(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_folder text := split_part(p_name, '/', 1);
begin
  if v_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return v_folder::uuid;
end
$$;

grant execute on function app.nfse_xml_folder_clinic(text) to authenticated;

create policy nfse_xml_select on storage.objects
  for select to authenticated
  using (bucket_id = 'nfse-xml' and app.can_read_finance(app.nfse_xml_folder_clinic(name)));
create policy nfse_xml_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'nfse-xml' and app.can_edit_finance(app.nfse_xml_folder_clinic(name)));

-- Rotina diária (regra 2): confere na Receita as notas "emitindo" ou
-- "cancelando" sem resposta. 3h30 de Brasília.
select cron.schedule('notas-fiscais', '30 6 * * *', $$ select app.call_system_route('/api/cron/notas-fiscais') $$);
