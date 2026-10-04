-- F2.6 — WhatsApp por clínica, conversas, mensagens, funil, rotinas e
-- contadores de uso (D3a, D3b, L23, L33, L49).

-- ---------------------------------------------------------------------------
-- Conexão do WhatsApp por clínica (D3a)
-- ---------------------------------------------------------------------------
-- O token da Meta não fica na tabela: vai para o Vault (criptografado) e só o
-- bot da própria clínica o lê, por get_whatsapp_access_token(). Nesta fase a
-- conexão é cadastrada pelo Suporte (F6); pelo Administrador, via Embedded
-- Signup, na F8.
create table public.whatsapp_connections (
  clinic_id uuid primary key references public.clinics (id) on delete cascade,
  -- Por ele o webhook descobre a clínica de cada evento.
  phone_number_id text not null unique,
  waba_id text not null,
  display_phone text,
  status text not null default 'pending' check (status in ('pending', 'connected', 'disconnected')),
  access_token_secret_id uuid,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Templates padrão do RecepClinic na conta de cada clínica (D3b): nome e
-- idioma guardados por clínica, situação da aprovação na Meta.
create table public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  template_key text not null check (template_key in (
    'confirmation',
    'confirmation_return',
    'reschedule',
    'cancellation',
    'reminder',
    'exam_preparation',
    'waitlist_offer',
    'daily_summary_consultations',
    'daily_summary_exams',
    'daily_summary_consultations_today',
    'daily_summary_exams_today'
  )),
  name text not null check (length(trim(name)) > 0),
  language text not null default 'pt_BR',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'disabled')),
  meta_template_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, template_key)
);

-- ---------------------------------------------------------------------------
-- Conversas, mensagens e funil
-- ---------------------------------------------------------------------------
create table public.conversation_state (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  contact_phone text not null check (contact_phone ~ '^\+\d{10,15}$'),
  contact_id uuid,
  -- Estados do bot sem lista fixa: o fluxo muda na F6 (ex.: "com quem?").
  state text not null default 'WELCOME' check (length(state) > 0),
  context jsonb not null default '{}'::jsonb,
  -- Pausa da recepção: a conversa está com uma pessoa, o bot não responde.
  human_handoff boolean not null default false,
  funnel_session_id uuid,
  funnel_flow text,
  updated_at timestamptz not null default now(),
  unique (clinic_id, contact_phone),
  foreign key (clinic_id, contact_id) references public.contacts (clinic_id, id) on delete set null (contact_id)
);

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  appointment_id uuid,
  contact_id uuid,
  direction text not null check (direction in ('inbound', 'outbound')),
  message_type text not null,
  template_name text,
  body text,
  status text,
  wa_message_id text,
  created_at timestamptz not null default now(),
  foreign key (clinic_id, appointment_id) references public.appointments (clinic_id, id) on delete set null (appointment_id),
  foreign key (clinic_id, contact_id) references public.contacts (clinic_id, id) on delete set null (contact_id)
);

create index whatsapp_messages_contact_idx on public.whatsapp_messages (contact_id);
create index whatsapp_messages_appointment_idx on public.whatsapp_messages (appointment_id);
create index whatsapp_messages_wa_id_idx on public.whatsapp_messages (wa_message_id);
-- Eventos repetidos da Meta: a mesma mensagem recebida não entra duas vezes (L23).
create unique index whatsapp_messages_inbound_wa_id_idx
  on public.whatsapp_messages (clinic_id, wa_message_id)
  where direction = 'inbound' and wa_message_id is not null;

create table public.bot_funnel_events (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  session_id uuid not null,
  flow text not null check (flow in ('booking', 'return_booking', 'exam', 'cancel', 'reschedule')),
  step text not null,
  source text not null default 'bot' check (source in ('bot', 'web')),
  contact_phone text not null,
  contact_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  foreign key (clinic_id, contact_id) references public.contacts (clinic_id, id) on delete set null (contact_id)
);

create index bot_funnel_events_flow_idx on public.bot_funnel_events (clinic_id, flow, occurred_at);
create index bot_funnel_events_session_idx on public.bot_funnel_events (session_id);

-- ---------------------------------------------------------------------------
-- Rotinas automáticas (por clínica: a falha de uma fica registrada com ela, L33)
-- ---------------------------------------------------------------------------
create table public.job_runs (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  job text not null check (job in ('appointment_reminders', 'daily_summary', 'waitlist_offers')),
  variant text check (variant in ('preview', 'final')),
  trigger text check (trigger in ('scheduled', 'manual')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'error')),
  error_message text,
  totals jsonb not null default '{}'::jsonb
);

create index job_runs_clinic_job_idx on public.job_runs (clinic_id, job, started_at desc);

create table public.daily_summary_sends (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  summary_date date not null,
  kind text not null check (kind in ('consultas', 'exames')),
  first_scheduled_at timestamptz not null,
  sent_at timestamptz not null default now()
);

create index daily_summary_sends_clinic_idx on public.daily_summary_sends (clinic_id, summary_date, kind, sent_at desc);

-- ---------------------------------------------------------------------------
-- Contadores de uso por mês (L49: sem cobrança, só para medir)
-- ---------------------------------------------------------------------------
create table public.clinic_usage_monthly (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  messages_sent integer not null default 0,
  appointments_created integer not null default 0,
  primary key (clinic_id, month)
);

create function app.bump_usage(p_clinic_id uuid, p_messages integer, p_appointments integer)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.clinic_usage_monthly (clinic_id, month, messages_sent, appointments_created)
  values (p_clinic_id, date_trunc('month', app.clinic_today(p_clinic_id))::date, p_messages, p_appointments)
  on conflict (clinic_id, month) do update
    set messages_sent = public.clinic_usage_monthly.messages_sent + excluded.messages_sent,
        appointments_created = public.clinic_usage_monthly.appointments_created + excluded.appointments_created
$$;

create function app.count_outbound_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction = 'outbound' then
    perform app.bump_usage(new.clinic_id, 1, 0);
  end if;
  return null;
end
$$;

create function app.count_created_appointment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.bump_usage(new.clinic_id, 0, 1);
  return null;
end
$$;

create trigger whatsapp_messages_count_usage
  after insert on public.whatsapp_messages
  for each row execute function app.count_outbound_message();

create trigger appointments_count_usage
  after insert on public.appointments
  for each row execute function app.count_created_appointment();

-- ---------------------------------------------------------------------------
-- Token da Meta no Vault e descoberta da clínica pelo webhook
-- ---------------------------------------------------------------------------
-- Grava (ou troca) o token da clínica. Só o Suporte (ou a plataforma, pela
-- service role) chama.
create function public.set_whatsapp_access_token(p_clinic_id uuid, p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  if not (app.is_platform_staff() or (select auth.role()) = 'service_role') then
    raise exception 'Só o Suporte grava o token do WhatsApp.' using errcode = '42501';
  end if;

  select access_token_secret_id into v_secret_id
    from public.whatsapp_connections where clinic_id = p_clinic_id;
  if not found then
    raise exception 'Clínica sem conexão do WhatsApp cadastrada.' using errcode = 'P0002';
  end if;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(p_token, 'whatsapp_token_' || p_clinic_id::text, 'Token da Meta da clínica');
    update public.whatsapp_connections set access_token_secret_id = v_secret_id where clinic_id = p_clinic_id;
  else
    perform vault.update_secret(v_secret_id, p_token);
  end if;
end
$$;

-- Token da clínica do próprio bot (credencial clinic_service). Ninguém da
-- equipe lê o token.
create function public.get_whatsapp_access_token()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
  from public.whatsapp_connections c
  join vault.decrypted_secrets s on s.id = c.access_token_secret_id
  where c.clinic_id = app.service_clinic_id()
$$;

-- Webhook: qual clínica recebe o evento deste número. Só a plataforma
-- (service role) chama; depois o processamento segue com a credencial da
-- clínica (D1).
create function public.resolve_whatsapp_clinic(p_phone_number_id text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select clinic_id from public.whatsapp_connections
  where phone_number_id = p_phone_number_id and status <> 'disconnected'
$$;

revoke execute on function public.set_whatsapp_access_token(uuid, text) from public, anon, clinic_service;
revoke execute on function public.get_whatsapp_access_token() from public, anon, authenticated;
revoke execute on function public.resolve_whatsapp_clinic(text) from public, anon, authenticated, clinic_service;
grant execute on function public.set_whatsapp_access_token(uuid, text) to authenticated, service_role;
grant execute on function public.get_whatsapp_access_token() to clinic_service, service_role;
grant execute on function public.resolve_whatsapp_clinic(text) to service_role;

-- O segredo some junto com a conexão.
create function app.delete_whatsapp_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.access_token_secret_id is not null then
    delete from vault.secrets where id = old.access_token_secret_id;
  end if;
  return null;
end
$$;

create trigger whatsapp_connections_delete_secret
  after delete on public.whatsapp_connections
  for each row execute function app.delete_whatsapp_secret();

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create trigger whatsapp_connections_set_updated_at before update on public.whatsapp_connections
  for each row execute function app.set_updated_at();
create trigger whatsapp_templates_set_updated_at before update on public.whatsapp_templates
  for each row execute function app.set_updated_at();
create trigger conversation_state_set_updated_at before update on public.conversation_state
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Conversas e mensagens: padrão de dados do dia a dia (equipe lê e grava —
-- ex.: reenvio pela tela, pausa da conversa; bot grava; só o Administrador
-- apaga).
select app.enable_clinic_data_rls('public.conversation_state');
select app.enable_clinic_data_rls('public.whatsapp_messages');

-- Funil, rotinas e resumos: a equipe só lê; o bot/agendador grava.
create function app.enable_clinic_service_written_rls(p_table regclass)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_name text := (select relname from pg_class where oid = p_table);
begin
  execute format('alter table %s enable row level security', p_table);
  execute format(
    'create policy %I on %s for select to authenticated using (app.is_clinic_member(clinic_id))',
    v_name || '_select', p_table);
  execute format(
    'create policy %I on %s for all to clinic_service using (clinic_id = app.service_clinic_id()) with check (clinic_id = app.service_clinic_id())',
    v_name || '_service', p_table);
  execute format(
    'create trigger %I after insert or update or delete on %s for each row execute function app.audit_platform_staff_write()',
    v_name || '_audit_platform_staff', p_table);
  execute format('revoke insert, update, delete on %s from anon, authenticated', p_table);
  execute format('revoke delete on %s from clinic_service', p_table);
end
$$;

select app.enable_clinic_service_written_rls('public.bot_funnel_events');
select app.enable_clinic_service_written_rls('public.job_runs');
select app.enable_clinic_service_written_rls('public.daily_summary_sends');
select app.enable_clinic_service_written_rls('public.whatsapp_templates');

-- Templates: o Suporte também cadastra e corrige (nesta fase, sem Embedded Signup).
grant insert, update, delete on public.whatsapp_templates to authenticated;
create policy whatsapp_templates_staff on public.whatsapp_templates
  for all to authenticated
  using (app.is_platform_staff())
  with check (app.is_platform_staff());

-- Conexão: a equipe vê a situação (sem o token); só o Suporte grava; o bot lê
-- a da própria clínica.
alter table public.whatsapp_connections enable row level security;

create policy whatsapp_connections_select on public.whatsapp_connections
  for select to authenticated
  using (app.is_clinic_member(clinic_id));

create policy whatsapp_connections_staff on public.whatsapp_connections
  for all to authenticated
  using (app.is_platform_staff())
  with check (app.is_platform_staff());

create policy whatsapp_connections_select_service on public.whatsapp_connections
  for select to clinic_service
  using (clinic_id = app.service_clinic_id());

create trigger whatsapp_connections_audit_platform_staff
  after insert or update or delete on public.whatsapp_connections
  for each row execute function app.audit_platform_staff_write();

revoke insert, update, delete on public.whatsapp_connections from anon, clinic_service;
-- O id do segredo não interessa a ninguém fora das funções acima: a leitura
-- é liberada coluna a coluna, sem ele (revogar só a coluna não basta quando a
-- tabela inteira está liberada).
revoke select on public.whatsapp_connections from anon, authenticated, clinic_service;
grant select (clinic_id, phone_number_id, waba_id, display_phone, status, connected_at, created_at, updated_at)
  on public.whatsapp_connections to authenticated, clinic_service;

-- Contadores de uso: o Administrador e o Suporte leem; só os gatilhos gravam.
alter table public.clinic_usage_monthly enable row level security;

create policy clinic_usage_monthly_select on public.clinic_usage_monthly
  for select to authenticated
  using (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]));

revoke insert, update, delete on public.clinic_usage_monthly from anon, authenticated, clinic_service;
