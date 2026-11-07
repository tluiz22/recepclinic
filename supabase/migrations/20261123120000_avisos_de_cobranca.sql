-- F12.7 — Faturamento do SaaS: avisos por e-mail de atraso e de pagamento
-- reconhecido.
--
-- Plano em docs/planejamento-faturamento-saas.md (fluxo 6; decisões 11.11 e
-- 11.13; itens 20 e 22 da seção 11):
--   1. atraso: e-mail no 3º, 7º e 14º dia (overdue_d3, overdue_d7,
--      overdue_d14), dias corridos, às 9h de Brasília; cada aviso diz a data a
--      partir da qual a clínica pode ser suspensa (15º dia); só cobranças do
--      Asaas (no manual, nunca);
--   2. um aviso por (cobrança, tipo); aviso que ficou para trás não sai
--      atrasado: só o mais recente que cabe, e os anteriores não enviados são
--      cancelados;
--   3. na hora de enviar, confere de novo: cobrança paga ou cancelada cancela o
--      aviso de atraso;
--   4. a cobrança que passa a paga gera o aviso de pagamento reconhecido e
--      cancela os de atraso pendentes;
--   5. o e-mail vai ao financeiro da conta; falha é tentada de novo (até 5);
--      WhatsApp entra na F12.9.

create table public.billing_notifications (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  charge_id uuid not null references public.billing_charges (id) on delete cascade,
  kind text not null check (kind in ('overdue_d3', 'overdue_d7', 'overdue_d14', 'payment_confirmed')),
  scheduled_for date not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'canceled', 'failed')),
  attempts integer not null default 0,
  sent_at timestamptz,
  sent_to text,
  last_error text check (last_error is null or length(last_error) <= 1000),
  created_at timestamptz not null default now(),
  unique (charge_id, kind)
);

create index billing_notifications_open_idx on public.billing_notifications (scheduled_for) where status in ('pending', 'failed');

alter table public.billing_audit_log drop constraint billing_audit_log_action_check;
alter table public.billing_audit_log add constraint billing_audit_log_action_check check (action in (
  'account_created', 'account_updated', 'contacts_updated', 'whatsapp_opt_in', 'whatsapp_opt_out',
  'contract_draft_saved', 'contract_draft_discarded', 'contract_activated', 'contract_ended',
  'contract_accepted', 'contract_notice_sent', 'contract_notice_failed',
  'clinic_suspended', 'suspension_released',
  'asaas_customer_linked', 'asaas_subscription_created', 'charge_created', 'charge_updated', 'asaas_sync_failed',
  'notice_sent', 'notice_failed'
));

-- Regra 4: pagou (ou foi cancelada/estornada), cancela os avisos de atraso pendentes; pagou, avisa.
create function app.billing_charge_notices()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and new.status in ('paid', 'canceled', 'refunded') then
    update public.billing_notifications
       set status = 'canceled'
     where charge_id = new.id and kind like 'overdue_%' and status in ('pending', 'failed');
  end if;
  if new.origin = 'asaas' and new.status = 'paid' and old.status is distinct from 'paid' then
    insert into public.billing_notifications (clinic_id, charge_id, kind, scheduled_for)
    values (new.clinic_id, new.id, 'payment_confirmed', app.billing_today())
    on conflict (charge_id, kind) do nothing;
  end if;
  return new;
end
$$;

create trigger billing_charges_notices
  after update of status on public.billing_charges
  for each row execute function app.billing_charge_notices();

-- Regras 1 e 2: cria o aviso de atraso mais recente que cabe a cada cobrança em aberto.
create function public.billing_schedule_overdue_notices()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := app.billing_today();
  v_count integer := 0;
  r record;
  v_kind text;
begin
  for r in
    select c.id, c.clinic_id, v_today - c.due_date as late
      from public.billing_charges c
     where c.origin = 'asaas' and c.status in ('pending', 'overdue') and c.due_date + 3 <= v_today
  loop
    v_kind := case when r.late >= 14 then 'overdue_d14' when r.late >= 7 then 'overdue_d7' else 'overdue_d3' end;
    insert into public.billing_notifications (clinic_id, charge_id, kind, scheduled_for)
    values (r.clinic_id, r.id, v_kind, v_today)
    on conflict (charge_id, kind) do nothing;
    if found then
      v_count := v_count + 1;
    end if;
    -- Os anteriores que não saíram ficam para trás (não saem atrasados).
    update public.billing_notifications
       set status = 'canceled'
     where charge_id = r.id and kind like 'overdue_%' and status in ('pending', 'failed')
       and substring(kind from 10)::integer < substring(v_kind from 10)::integer;
  end loop;
  return v_count;
end
$$;

-- Avisos a enviar, com o necessário para o e-mail (regras 3 e 5).
create function public.billing_open_notices(p_limit integer)
returns table (
  id uuid, kind text, clinic_id uuid, clinic_name text, finance_email text,
  charge_kind text, charge_status text, due_date date, value_cents integer, invoice_url text, paid_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.kind, n.clinic_id, cl.name, a.finance_email,
         c.kind, c.status, c.due_date, c.value_cents, c.invoice_url, c.paid_at
    from public.billing_notifications n
    join public.billing_charges c on c.id = n.charge_id
    join public.clinics cl on cl.id = n.clinic_id
    left join public.billing_accounts a on a.clinic_id = n.clinic_id
   where (n.status = 'pending' or (n.status = 'failed' and n.attempts < 5)) and n.scheduled_for <= app.billing_today()
   order by n.created_at
   limit greatest(1, least(coalesce(p_limit, 100), 500))
$$;

create function public.billing_finish_notice(p_id uuid, p_status text, p_sent_to text, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.billing_notifications%rowtype;
begin
  if p_status not in ('sent', 'canceled', 'failed') then
    raise exception 'Situação inválida.' using errcode = 'P0001';
  end if;
  update public.billing_notifications
     set status = p_status, attempts = attempts + case when p_status = 'canceled' then 0 else 1 end,
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         sent_to = coalesce(nullif(p_sent_to, ''), sent_to),
         last_error = left(nullif(trim(coalesce(p_error, '')), ''), 1000)
   where id = p_id
   returning * into v_row;
  if v_row.id is not null and p_status in ('sent', 'failed') then
    perform app.log_billing(v_row.clinic_id, case p_status when 'sent' then 'notice_sent' else 'notice_failed' end, null,
      jsonb_build_object('kind', v_row.kind, 'charge_id', v_row.charge_id, 'sent_to', v_row.sent_to), v_row.last_error);
  end if;
end
$$;

alter table public.billing_notifications enable row level security;
create policy billing_notifications_select on public.billing_notifications
  for select to authenticated using (
    app.is_platform_staff() or app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[])
  );
revoke insert, update, delete, truncate on public.billing_notifications from authenticated;
revoke all on public.billing_notifications from anon, clinic_service;

create trigger billing_notifications_audit_platform_staff
  after insert or update or delete on public.billing_notifications
  for each row execute function app.audit_platform_staff_write();

revoke execute on function public.billing_schedule_overdue_notices() from public, anon, authenticated, clinic_service;
revoke execute on function public.billing_open_notices(integer) from public, anon, authenticated, clinic_service;
revoke execute on function public.billing_finish_notice(uuid, text, text, text) from public, anon, authenticated, clinic_service;
grant execute on function public.billing_schedule_overdue_notices() to service_role;
grant execute on function public.billing_open_notices(integer) to service_role;
grant execute on function public.billing_finish_notice(uuid, text, text, text) to service_role;

-- Bloqueio da suspensão (F12.3b): avisos são do servidor, fora do bloqueio.
create or replace function app.suspension_free_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'billing_accounts', 'billing_audit_log', 'billing_contracts', 'billing_charges', 'billing_notifications', 'clinic_suspensions',
    'platform_access_log', 'platform_audit_log', 'system_errors', 'job_runs', 'clinic_usage_monthly',
    'push_subscriptions'
  ]
$$;

-- 9h de Brasília (12h UTC), também em fim de semana e feriado (decisão 11.13).
select cron.schedule('avisos-cobranca', '0 12 * * *', $$ select app.call_system_route('/api/cron/avisos-cobranca') $$);
