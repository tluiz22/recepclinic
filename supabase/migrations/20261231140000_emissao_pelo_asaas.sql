-- N3b — Emissão e cancelamento da NFS-e pelo Asaas, pelo emissor do
-- atendimento (planejamento-nfse-asaas.md, seções 5, 14 e 15).
--
--   1. a nota sai pelo emissor do profissional do atendimento (agenda →
--      profissional → emissor próprio, o da clínica ou nenhum, N-P1); agenda
--      sem profissional (exames) → emissor da clínica;
--   2. só com o emissor com a emissão ligada e sem suspensão (N-P5); o
--      tomador precisa de CPF, e-mail e endereço (13.6);
--   3. pedido aceito ≠ nota emitida: a nota fica "emitindo" com o id do Asaas
--      até o webhook (ou a conciliação) confirmar AUTHORIZED ou ERROR;
--   4. cancelar: o Administrador e o profissional dono do emissor (N-P2),
--      só onde o município cancela pelo sistema;
--   5. eventos do webhook gravados uma vez (id do evento), por emissor; o
--      estado vem sempre do GET da nota;
--   6. contrato: emissor pago pela clínica exige o contrato da clínica com
--      nota (como antes); o do profissional pagador vem na N4b.
-- O emissor antigo (DPS na Sefin) continua para as notas antigas até a N5.
--
-- Reversão: drop das funções e da tabela criadas aqui, das colunas novas de
-- nfse_invoices; restaurar os checks e app.nfse_requires_signed_contract.

-- ---------------------------------------------------------------------------
-- Notas: provedor, emissor e o que o Asaas devolve
-- ---------------------------------------------------------------------------
alter table public.nfse_invoices
  add column provider text not null default 'sefin' check (provider in ('sefin', 'asaas')),
  add column issuer_id uuid references public.fiscal_issuers (id) on delete set null,
  add column asaas_invoice_id text unique,
  add column asaas_status text check (asaas_status is null or length(asaas_status) <= 60),
  add column validation_code text check (validation_code is null or length(validation_code) <= 200),
  add column pdf_path text,
  add column cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 255);

alter table public.nfse_invoices alter column series drop not null;
alter table public.nfse_invoices alter column dps_number drop not null;
alter table public.nfse_invoices alter column dps_id drop not null;

alter table public.nfse_invoices drop constraint nfse_invoices_environment_check;
alter table public.nfse_invoices add constraint nfse_invoices_environment_check
  check (environment in ('restricted', 'production', 'simulation', 'sandbox'));

-- A chave de acesso de 50 dígitos é da nota nacional (emissor antigo).
do $$
declare
  v_name text;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'public.nfse_invoices'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%access_key IS NOT NULL%';
  if v_name is not null then
    execute format('alter table public.nfse_invoices drop constraint %I', v_name);
  end if;
end
$$;
alter table public.nfse_invoices add constraint nfse_invoices_provider_fields check (
  (provider = 'sefin' and series is not null and dps_number is not null and dps_id is not null
     and (status not in ('issued', 'canceling', 'canceled') or access_key is not null))
  or (provider = 'asaas' and issuer_id is not null)
);

create index nfse_invoices_asaas_pending_idx on public.nfse_invoices (status, requested_at) where provider = 'asaas' and status in ('issuing', 'canceling');

-- Contrato (regra 6): emissor pago pela clínica, ou o emissor antigo.
create or replace function app.nfse_requires_signed_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.provider = 'asaas' and exists (select 1 from public.fiscal_issuers where id = new.issuer_id and payer = 'professional') then
    return new;
  end if;
  if not app.billing_invoicing_signed(new.clinic_id) then
    raise exception 'A emissão de nota fiscal só começa depois que o Administrador assinar o contrato com nota fiscal, em Configurações › Assinatura.'
      using errcode = 'P0001', hint = 'nfse_contract';
  end if;
  return new;
end
$$;

alter table public.fiscal_audit_log drop constraint fiscal_audit_log_event_check;
alter table public.fiscal_audit_log add constraint fiscal_audit_log_event_check
  check (event in (
    'terms_accepted', 'certificate_uploaded', 'certificate_replaced', 'certificate_revoked', 'dmed_generated',
    'environment_changed', 'nfse_issue_requested', 'nfse_issued', 'nfse_rejected',
    'nfse_cancel_requested', 'nfse_canceled', 'nfse_cancel_rejected',
    'issuer_saved', 'issuer_route_changed', 'issuer_payer_changed', 'asaas_account_created', 'account_status_changed',
    'fiscal_info_saved', 'fiscal_info_failed', 'issuing_enabled', 'issuing_disabled', 'issuer_suspended', 'issuer_released',
    'balance_topped_up'
  ));

-- ---------------------------------------------------------------------------
-- Eventos do webhook (regra 5)
-- ---------------------------------------------------------------------------
create table public.nfse_provider_events (
  id text primary key check (length(id) between 1 and 200),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  issuer_id uuid references public.fiscal_issuers (id) on delete set null,
  event text not null check (length(event) <= 80),
  asaas_invoice_id text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text check (error is null or length(error) <= 1000)
);

create index nfse_provider_events_pending_idx on public.nfse_provider_events (received_at) where processed_at is null;

create trigger nfse_provider_events_audit_platform_staff
  after insert or update or delete on public.nfse_provider_events
  for each row execute function app.audit_platform_staff_write();
-- Gravada só pelo servidor (service role), que a suspensão não barra.
create trigger nfse_provider_events_guard_suspended before insert or update or delete on public.nfse_provider_events
  for each row execute function app.guard_suspended_clinic_write();

alter table public.nfse_provider_events enable row level security;
create policy nfse_provider_events_select on public.nfse_provider_events
  for select to authenticated using (app.is_platform_staff());
revoke insert, update, delete on public.nfse_provider_events from authenticated;
revoke all on public.nfse_provider_events from anon, clinic_service;

-- ---------------------------------------------------------------------------
-- Quem pode cancelar (regra 4)
-- ---------------------------------------------------------------------------
create function app.can_cancel_invoice_of(p_clinic uuid, p_issuer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_clinic_admin_member(p_clinic)
      or exists (
        select 1 from public.fiscal_issuers i
         where i.id = p_issuer and i.professional_id is not null and i.professional_id = app.own_professional_id(p_clinic)
      )
$$;

-- ---------------------------------------------------------------------------
-- Emitir (regras 1 a 3)
-- ---------------------------------------------------------------------------
create function public.begin_asaas_invoice(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_issuer public.fiscal_issuers%rowtype;
  v_professional uuid;
  v_service uuid;
  v_service_name text;
  v_appointment_at timestamptz;
  v_timezone text;
  v_patient_name text;
  v_code text;
  v_invoice uuid;
  v_issuer_id uuid;
begin
  select * into v_payment from public.payments where id = p_payment_id;
  if v_payment.id is null or not app.can_edit_finance(v_payment.clinic_id) then
    raise exception 'Pagamento não encontrado.' using errcode = '42501';
  end if;
  perform app.require_feature(v_payment.clinic_id, 'finance');
  if v_payment.deleted_at is not null then
    raise exception 'Pagamento excluído não recebe nota.' using errcode = 'P0001', hint = 'nfse_payment_deleted';
  end if;
  if exists (select 1 from public.nfse_invoices where payment_id = p_payment_id and status in ('issuing', 'issued', 'canceling')) then
    raise exception 'Este pagamento já tem nota (ou uma emissão em curso).' using errcode = 'P0001', hint = 'nfse_active';
  end if;

  select a.scheduled_at, ag.professional_id, a.service_id, s.name, pt.full_name
    into v_appointment_at, v_professional, v_service, v_service_name, v_patient_name
    from public.appointments a
    join public.agendas ag on ag.id = a.agenda_id
    join public.services s on s.id = a.service_id
    join public.patients pt on pt.id = a.patient_id
   where a.id = v_payment.appointment_id;

  v_issuer_id := case
    when v_professional is null then (select id from public.fiscal_issuers where clinic_id = v_payment.clinic_id and kind = 'clinic')
    else app.fiscal_issuer_for_professional(v_payment.clinic_id, v_professional)
  end;
  if v_issuer_id is null then
    if v_professional is not null and exists (select 1 from public.professional_fiscal_routes where professional_id = v_professional and mode = 'none') then
      raise exception 'Este profissional não emite nota pelo sistema (Configurações › Nota fiscal).' using errcode = 'P0001', hint = 'nfse_no_issuer';
    end if;
    raise exception 'A clínica ainda não tem emissor de nota fiscal (Configurações › Nota fiscal).' using errcode = 'P0001', hint = 'nfse_no_issuer';
  end if;
  select * into v_issuer from public.fiscal_issuers where id = v_issuer_id;
  if v_issuer.suspended_at is not null then
    raise exception 'A emissão de notas de % está suspensa por falta de pagamento.', v_issuer.legal_name using errcode = 'P0001', hint = 'nfse_issuer_suspended';
  end if;
  if not v_issuer.issuing_enabled then
    raise exception 'A emissão de % ainda não está ligada (Configurações › Nota fiscal).', v_issuer.legal_name using errcode = 'P0001', hint = 'nfse_issuer_off';
  end if;

  if v_payment.payer_cpf is null then
    raise exception 'Falta o CPF de quem pagou: exclua e registre o pagamento de novo com o CPF.' using errcode = 'P0001', hint = 'nfse_payer_cpf';
  end if;
  if v_payment.payer_email is null or v_payment.payer_postal_code is null then
    raise exception 'Falta o e-mail e o endereço de quem pagou.' using errcode = 'P0001', hint = 'nfse_payer_contact';
  end if;

  select coalesce((select service_code from public.fiscal_issuer_service_codes where issuer_id = v_issuer.id and service_id = v_service), v_issuer.service_code)
    into v_code;
  select timezone into v_timezone from public.clinic_settings where clinic_id = v_payment.clinic_id;

  insert into public.nfse_invoices (clinic_id, payment_id, environment, provider, issuer_id, requested_by)
  values (v_payment.clinic_id, p_payment_id, v_issuer.environment, 'asaas', v_issuer.id, (select auth.uid()))
  returning id into v_invoice;

  insert into public.fiscal_audit_log (clinic_id, issuer_id, event, actor_id, details)
  values (v_payment.clinic_id, v_issuer.id, 'nfse_issue_requested', (select auth.uid()),
    jsonb_build_object('invoice_id', v_invoice, 'payment_id', p_payment_id, 'environment', v_issuer.environment));

  return jsonb_build_object(
    'invoice_id', v_invoice,
    'issuer_id', v_issuer.id,
    'environment', v_issuer.environment,
    'competence', v_payment.paid_on,
    'amount_cents', v_payment.amount_cents,
    'payer_cpf', v_payment.payer_cpf,
    'payer_name', v_payment.payer_name,
    'payer_email', v_payment.payer_email,
    'payer_postal_code', v_payment.payer_postal_code,
    'payer_street', v_payment.payer_street,
    'payer_number', v_payment.payer_address_number,
    'payer_complement', v_payment.payer_address_complement,
    'payer_district', v_payment.payer_district,
    'patient_name', v_patient_name,
    'service_name', v_service_name,
    'appointment_date', (v_appointment_at at time zone v_timezone)::date,
    'service_code', v_code,
    'municipal_service_name', v_issuer.service_name,
    'iss_rate', v_issuer.iss_rate,
    'nbs_code', v_issuer.nbs_code,
    'pis_cofins_tax_status', v_issuer.pis_cofins_tax_status,
    'tax_situation_code', v_issuer.tax_situation_code,
    'tax_classification_code', v_issuer.tax_classification_code,
    'operation_indicator_code', v_issuer.operation_indicator_code
  );
end
$$;

-- Resultado (pela tela, pelo webhook ou pela conciliação): pending (aceito,
-- aguardando a prefeitura), issued, rejected. Repetir o mesmo resultado não
-- muda nada (o webhook pode chegar mais de uma vez).
create function public.finish_asaas_invoice(
  p_invoice_id uuid, p_outcome text, p_asaas_invoice_id text, p_asaas_status text,
  p_number text default null, p_validation_code text default null, p_message text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.nfse_invoices%rowtype;
begin
  select * into v_invoice from public.nfse_invoices where id = p_invoice_id for update;
  if v_invoice.id is null or v_invoice.provider <> 'asaas'
     or not ((select auth.role()) = 'service_role' or app.can_edit_finance(v_invoice.clinic_id)) then
    raise exception 'Nota não encontrada.' using errcode = '42501';
  end if;
  if v_invoice.status <> 'issuing' then
    return v_invoice.status;
  end if;
  if p_outcome = 'issued' then
    update public.nfse_invoices
       set status = 'issued', asaas_invoice_id = coalesce(p_asaas_invoice_id, asaas_invoice_id), asaas_status = p_asaas_status,
           nfse_number = p_number, validation_code = left(p_validation_code, 200), issued_at = now(), checked_at = now(),
           error_code = null, error_message = null
     where id = p_invoice_id;
    insert into public.fiscal_audit_log (clinic_id, issuer_id, event, details)
    values (v_invoice.clinic_id, v_invoice.issuer_id, 'nfse_issued', jsonb_build_object('invoice_id', p_invoice_id, 'nfse_number', p_number));
    return 'issued';
  elsif p_outcome = 'rejected' then
    update public.nfse_invoices
       set status = 'rejected', asaas_invoice_id = coalesce(p_asaas_invoice_id, asaas_invoice_id), asaas_status = p_asaas_status,
           error_code = left(coalesce(p_asaas_status, 'ASAAS'), 50), error_message = left(p_message, 2000), checked_at = now()
     where id = p_invoice_id;
    insert into public.fiscal_audit_log (clinic_id, issuer_id, event, details)
    values (v_invoice.clinic_id, v_invoice.issuer_id, 'nfse_rejected', jsonb_build_object('invoice_id', p_invoice_id, 'error_code', p_asaas_status));
    return 'rejected';
  elsif p_outcome = 'pending' then
    update public.nfse_invoices
       set asaas_invoice_id = coalesce(p_asaas_invoice_id, asaas_invoice_id), asaas_status = coalesce(p_asaas_status, asaas_status),
           error_message = left(p_message, 2000), checked_at = now()
     where id = p_invoice_id;
    return 'issuing';
  end if;
  raise exception 'Resultado desconhecido.' using errcode = 'P0001';
end
$$;

-- ---------------------------------------------------------------------------
-- Cancelar (regra 4)
-- ---------------------------------------------------------------------------
create function public.begin_asaas_cancel(p_invoice_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.nfse_invoices%rowtype;
  v_issuer public.fiscal_issuers%rowtype;
begin
  select * into v_invoice from public.nfse_invoices where id = p_invoice_id for update;
  if v_invoice.id is null or v_invoice.provider <> 'asaas' or not app.can_cancel_invoice_of(v_invoice.clinic_id, v_invoice.issuer_id) then
    raise exception 'Só o Administrador da clínica ou o profissional dono do emissor cancela a nota.' using errcode = '42501';
  end if;
  perform app.require_feature(v_invoice.clinic_id, 'finance');
  if v_invoice.status <> 'issued' then
    raise exception 'Só nota emitida pode ser cancelada.' using errcode = 'P0001', hint = 'nfse_state';
  end if;
  if length(trim(coalesce(p_reason, ''))) not between 15 and 255 then
    raise exception 'Explique o motivo com 15 a 255 caracteres.' using errcode = 'P0001', hint = 'nfse_cancel_reason';
  end if;
  select * into v_issuer from public.fiscal_issuers where id = v_invoice.issuer_id;
  if coalesce((v_issuer.municipal_options ->> 'supportsCancellation')::boolean, true) = false then
    raise exception 'O município não cancela pelo sistema: cancele no portal da prefeitura.' using errcode = 'P0001', hint = 'nfse_cancel_unsupported';
  end if;
  update public.nfse_invoices
     set status = 'canceling', cancel_reason = trim(p_reason), cancel_requested_by = (select auth.uid()), error_code = null, error_message = null
   where id = p_invoice_id;
  insert into public.fiscal_audit_log (clinic_id, issuer_id, event, actor_id, details)
  values (v_invoice.clinic_id, v_invoice.issuer_id, 'nfse_cancel_requested', (select auth.uid()),
    jsonb_build_object('invoice_id', p_invoice_id, 'nfse_number', v_invoice.nfse_number));
  return jsonb_build_object('invoice_id', p_invoice_id, 'issuer_id', v_invoice.issuer_id, 'asaas_invoice_id', v_invoice.asaas_invoice_id);
end
$$;

-- Resultado do cancelamento: canceled, denied (volta para emitida, com o
-- motivo) ou pending. Repetido não muda nada.
create function public.finish_asaas_cancel(p_invoice_id uuid, p_outcome text, p_asaas_status text, p_message text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.nfse_invoices%rowtype;
begin
  select * into v_invoice from public.nfse_invoices where id = p_invoice_id for update;
  if v_invoice.id is null or v_invoice.provider <> 'asaas'
     or not ((select auth.role()) = 'service_role' or app.can_cancel_invoice_of(v_invoice.clinic_id, v_invoice.issuer_id)) then
    raise exception 'Nota não encontrada.' using errcode = '42501';
  end if;
  if v_invoice.status <> 'canceling' then
    return v_invoice.status;
  end if;
  if p_outcome = 'canceled' then
    update public.nfse_invoices set status = 'canceled', asaas_status = p_asaas_status, canceled_at = now(), checked_at = now() where id = p_invoice_id;
    insert into public.fiscal_audit_log (clinic_id, issuer_id, event, details)
    values (v_invoice.clinic_id, v_invoice.issuer_id, 'nfse_canceled', jsonb_build_object('invoice_id', p_invoice_id, 'nfse_number', v_invoice.nfse_number));
    return 'canceled';
  elsif p_outcome = 'denied' then
    update public.nfse_invoices
       set status = 'issued', asaas_status = p_asaas_status, error_code = 'CANCELAMENTO-NEGADO', error_message = left(p_message, 2000), checked_at = now()
     where id = p_invoice_id;
    insert into public.fiscal_audit_log (clinic_id, issuer_id, event, details)
    values (v_invoice.clinic_id, v_invoice.issuer_id, 'nfse_cancel_rejected', jsonb_build_object('invoice_id', p_invoice_id));
    return 'issued';
  elsif p_outcome = 'pending' then
    update public.nfse_invoices set asaas_status = coalesce(p_asaas_status, asaas_status), error_message = left(p_message, 2000), checked_at = now() where id = p_invoice_id;
    return 'canceling';
  end if;
  raise exception 'Resultado desconhecido.' using errcode = 'P0001';
end
$$;

-- ---------------------------------------------------------------------------
-- Servidor: notas pendentes e eventos
-- ---------------------------------------------------------------------------
create function public.list_pending_asaas_invoices(p_before timestamptz)
returns table (invoice_id uuid, clinic_id uuid, issuer_id uuid, status text, asaas_invoice_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select id, clinic_id, issuer_id, status, asaas_invoice_id
    from public.nfse_invoices
   where provider = 'asaas' and status in ('issuing', 'canceling') and coalesce(checked_at, requested_at) < p_before
   order by requested_at
   limit 200
$$;

create function public.find_asaas_invoice(p_issuer_id uuid, p_asaas_invoice_id text)
returns table (invoice_id uuid, clinic_id uuid, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select id, clinic_id, status from public.nfse_invoices where issuer_id = p_issuer_id and asaas_invoice_id = p_asaas_invoice_id
$$;

-- Grava o evento uma vez; devolve false se já tinha chegado.
create function public.record_nfse_provider_event(p_id text, p_clinic_id uuid, p_issuer_id uuid, p_event text, p_asaas_invoice_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.nfse_provider_events (id, clinic_id, issuer_id, event, asaas_invoice_id)
  values (p_id, p_clinic_id, p_issuer_id, left(p_event, 80), p_asaas_invoice_id)
  on conflict (id) do nothing;
  return found;
end
$$;

create function public.finish_nfse_provider_event(p_id text, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.nfse_provider_events set processed_at = now(), error = left(p_error, 1000) where id = p_id
$$;

-- Reposição do saldo da subconta (decisão de 30/out): só a trilha.
create function public.record_issuer_top_up(p_issuer_id uuid, p_value_cents integer, p_transfer_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.fiscal_audit_log (clinic_id, issuer_id, event, details)
  select clinic_id, id, 'balance_topped_up', jsonb_build_object('value_cents', p_value_cents, 'transfer_id', p_transfer_id)
    from public.fiscal_issuers where id = p_issuer_id
$$;

revoke execute on function app.can_cancel_invoice_of(uuid, uuid) from public, anon, clinic_service;
grant execute on function app.can_cancel_invoice_of(uuid, uuid) to authenticated;
revoke execute on function public.begin_asaas_invoice(uuid) from public, anon, clinic_service;
revoke execute on function public.finish_asaas_invoice(uuid, text, text, text, text, text, text) from public, anon, clinic_service;
revoke execute on function public.begin_asaas_cancel(uuid, text) from public, anon, clinic_service;
revoke execute on function public.finish_asaas_cancel(uuid, text, text, text) from public, anon, clinic_service;
grant execute on function public.begin_asaas_invoice(uuid) to authenticated;
grant execute on function public.finish_asaas_invoice(uuid, text, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.begin_asaas_cancel(uuid, text) to authenticated;
grant execute on function public.finish_asaas_cancel(uuid, text, text, text) to authenticated, service_role;
revoke execute on function public.list_pending_asaas_invoices(timestamptz) from public, anon, authenticated, clinic_service;
revoke execute on function public.find_asaas_invoice(uuid, text) from public, anon, authenticated, clinic_service;
revoke execute on function public.record_nfse_provider_event(text, uuid, uuid, text, text) from public, anon, authenticated, clinic_service;
revoke execute on function public.finish_nfse_provider_event(text, text) from public, anon, authenticated, clinic_service;
revoke execute on function public.record_issuer_top_up(uuid, integer, text) from public, anon, authenticated, clinic_service;
grant execute on function public.list_pending_asaas_invoices(timestamptz) to service_role;
grant execute on function public.find_asaas_invoice(uuid, text) to service_role;
grant execute on function public.record_nfse_provider_event(text, uuid, uuid, text, text) to service_role;
grant execute on function public.finish_nfse_provider_event(text, text) to service_role;
grant execute on function public.record_issuer_top_up(uuid, integer, text) to service_role;

-- Rotina das notas: a cada 10 minutos (o Asaas confirma em segundos; a
-- conciliação pega o que o webhook perdeu).
select cron.schedule('notas-fiscais', '*/10 * * * *', $$ select app.call_system_route('/api/cron/notas-fiscais') $$);

-- Para a tela do pagamento (quem lê o Financeiro): o emissor que emitiria a
-- nota do atendimento e se já pode emitir (sem dados fiscais).
create function public.fiscal_issuer_for_appointment(p_appointment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_professional uuid;
  v_issuer public.fiscal_issuers%rowtype;
  v_issuer_id uuid;
begin
  select a.clinic_id, ag.professional_id into v_clinic, v_professional
    from public.appointments a join public.agendas ag on ag.id = a.agenda_id
   where a.id = p_appointment_id;
  if v_clinic is null or not app.can_read_finance(v_clinic) then
    return null;
  end if;
  v_issuer_id := case
    when v_professional is null then (select id from public.fiscal_issuers where clinic_id = v_clinic and kind = 'clinic')
    else app.fiscal_issuer_for_professional(v_clinic, v_professional)
  end;
  if v_issuer_id is null then
    return jsonb_build_object('issuer_id', null,
      'route_none', v_professional is not null and exists (select 1 from public.professional_fiscal_routes where professional_id = v_professional and mode = 'none'));
  end if;
  select * into v_issuer from public.fiscal_issuers where id = v_issuer_id;
  return jsonb_build_object(
    'issuer_id', v_issuer.id,
    'kind', v_issuer.kind,
    'legal_name', v_issuer.legal_name,
    'environment', v_issuer.environment,
    'issuing_enabled', v_issuer.issuing_enabled,
    'suspended', v_issuer.suspended_at is not null,
    'supports_cancellation', coalesce((v_issuer.municipal_options ->> 'supportsCancellation')::boolean, true),
    'contract_ok', v_issuer.payer = 'professional' or app.billing_invoicing_signed(v_clinic),
    'route_none', false
  );
end
$$;

revoke execute on function public.fiscal_issuer_for_appointment(uuid) from public, anon, clinic_service;
grant execute on function public.fiscal_issuer_for_appointment(uuid) to authenticated;
