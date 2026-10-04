-- F2.4 — Atendimentos, séries recorrentes, bloqueios, links e trilha
-- (D1, D2 revista, D6 revista, D9, D10).

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type public.appointment_status as enum ('scheduled', 'confirmed', 'completed', 'canceled', 'no_show');
create type public.action_channel as enum ('admin', 'whatsapp_bot');
create type public.booking_link_mode as enum ('create', 'reschedule');
create type public.series_skip_reason as enum ('holiday', 'block', 'conflict');

-- ---------------------------------------------------------------------------
-- Acesso pela agenda
-- ---------------------------------------------------------------------------
-- Para tabelas com `agenda_id`: depois de app.enable_clinic_data_rls, troca as
-- políticas da equipe para também exigir acesso à agenda (D6 revista). O bot
-- continua com acesso a todas as agendas da própria clínica.
create function app.restrict_clinic_data_to_agenda(p_table regclass)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_name text := (select relname from pg_class where oid = p_table);
  v_rule text := 'app.has_clinic_role(clinic_id, array[''admin'', ''professional'', ''reception'']::public.clinic_role[]) and app.can_access_agenda(agenda_id)';
begin
  execute format('drop policy %I on %s', v_name || '_select', p_table);
  execute format('drop policy %I on %s', v_name || '_insert', p_table);
  execute format('drop policy %I on %s', v_name || '_update', p_table);
  execute format(
    'create policy %I on %s for select to authenticated using (app.can_access_agenda(agenda_id))',
    v_name || '_select', p_table);
  execute format(
    'create policy %I on %s for insert to authenticated with check (%s)',
    v_name || '_insert', p_table, v_rule);
  execute format(
    'create policy %I on %s for update to authenticated using (%s) with check (%s)',
    v_name || '_update', p_table, v_rule, v_rule);
end
$$;

create function app.appointment_period(p_scheduled_at timestamptz, p_duration_minutes integer)
returns tstzrange
language sql
immutable
parallel safe
set search_path = ''
as $$
  select tstzrange(p_scheduled_at, p_scheduled_at + make_interval(mins => p_duration_minutes), '[)')
$$;

-- ---------------------------------------------------------------------------
-- Séries recorrentes (D9)
-- ---------------------------------------------------------------------------
-- Gerar as sessões, pular conflitos e alterar "esta e as próximas" fica na
-- aplicação (F4), com o cálculo de feriados e horários já testado na F1.
create table public.appointment_series (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null,
  service_id uuid not null,
  agenda_id uuid not null,
  location_id uuid not null,
  -- 1 = semanal, 2 = quinzenal, N = a cada N semanas.
  interval_weeks smallint not null default 1 check (interval_weeks between 1 and 12),
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  duration_minutes integer not null check (duration_minutes > 0),
  starts_on date not null,
  -- Fim por data OU por número de sessões; os dois nulos = sem fim.
  ends_on date,
  max_sessions integer check (max_sessions > 0),
  home_visit_address text,
  insurance_plan_id uuid,
  ended_at timestamptz,
  ended_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, patient_id) references public.patients (clinic_id, id),
  foreign key (clinic_id, service_id) references public.services (clinic_id, id),
  foreign key (clinic_id, agenda_id) references public.agendas (clinic_id, id),
  foreign key (clinic_id, location_id) references public.locations (clinic_id, id),
  foreign key (clinic_id, insurance_plan_id) references public.insurance_plans (clinic_id, id),
  check (ends_on is null or max_sessions is null),
  check (ends_on is null or ends_on >= starts_on),
  check (extract(dow from starts_on) = weekday)
);

-- Datas que a geração pulou e por quê, para a tela avisar a recepção (D9).
create table public.appointment_series_skips (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  series_id uuid not null,
  skipped_on date not null,
  reason public.series_skip_reason not null,
  created_at timestamptz not null default now(),
  unique (series_id, skipped_on),
  foreign key (clinic_id, series_id) references public.appointment_series (clinic_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Atendimentos
-- ---------------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null,
  service_id uuid not null,
  agenda_id uuid not null,
  location_id uuid not null,
  series_id uuid,
  -- Retorno: a consulta de origem (prazo pela regra do serviço).
  origin_appointment_id uuid,
  scheduled_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes > 0),
  status public.appointment_status not null default 'scheduled',
  booking_channel public.action_channel not null,
  -- Turma de exame (pelo serviço): fica fora da trava de horário.
  is_group_session boolean not null default false,
  -- Preço do serviço (ou do local) no momento da marcação.
  price_cents integer check (price_cents >= 0),
  -- D10: nulo = particular. Copiado do paciente na marcação; editável.
  insurance_plan_id uuid,
  home_visit_address text,
  reminder_sent_at timestamptz,
  confirmed_at timestamptz,
  patient_confirmed_at timestamptz,
  patient_confirmed_by uuid references auth.users (id) on delete set null,
  canceled_at timestamptz,
  canceled_via public.action_channel,
  canceled_by uuid references auth.users (id) on delete set null,
  mass_canceled boolean not null default false,
  rescheduled_at timestamptz,
  rescheduled_via public.action_channel,
  rescheduled_by uuid references auth.users (id) on delete set null,
  rebooking_dismissed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, patient_id) references public.patients (clinic_id, id),
  foreign key (clinic_id, service_id) references public.services (clinic_id, id),
  foreign key (clinic_id, agenda_id) references public.agendas (clinic_id, id),
  foreign key (clinic_id, location_id) references public.locations (clinic_id, id),
  foreign key (clinic_id, series_id) references public.appointment_series (clinic_id, id),
  foreign key (clinic_id, origin_appointment_id) references public.appointments (clinic_id, id),
  foreign key (clinic_id, insurance_plan_id) references public.insurance_plans (clinic_id, id),
  -- Trava de horário por agenda (D2): dois atendimentos ativos não se
  -- sobrepõem na mesma agenda; agendas diferentes, sim.
  constraint appointments_no_overlap exclude using gist (
    agenda_id with =,
    app.appointment_period(scheduled_at, duration_minutes) with &&
  ) where (status in ('scheduled', 'confirmed') and not is_group_session)
);

create index appointments_agenda_time_idx on public.appointments (agenda_id, scheduled_at);
create index appointments_clinic_time_idx on public.appointments (clinic_id, scheduled_at);
create index appointments_patient_idx on public.appointments (patient_id);
create index appointments_series_idx on public.appointments (series_id) where series_id is not null;

-- Preço de tabela: o do local, se o serviço tiver preço próprio nele; senão o do serviço.
create function app.service_price(p_service_id uuid, p_location_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select price_cents from public.service_locations where service_id = p_service_id and location_id = p_location_id),
    (select price_cents from public.services where id = p_service_id)
  )
$$;

-- Turma, preço, convênio e coerência serviço × agenda (portado do piloto:
-- set_appointment_is_group_session e set_appointment_price).
create function app.appointment_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.service_id is distinct from old.service_id or new.agenda_id is distinct from old.agenda_id then
    if not exists (
      select 1 from public.service_agendas where service_id = new.service_id and agenda_id = new.agenda_id
    ) then
      raise exception 'Este serviço não é atendido nesta agenda.' using errcode = 'P0001', hint = 'service_not_in_agenda';
    end if;
  end if;

  if tg_op = 'INSERT' or new.service_id is distinct from old.service_id then
    new.is_group_session := exists (
      select 1 from public.services where id = new.service_id and scheduling_mode = 'group'
    );
  end if;

  if tg_op = 'INSERT' then
    if new.price_cents is null then
      new.price_cents := app.service_price(new.service_id, new.location_id);
    end if;
    if new.insurance_plan_id is null then
      new.insurance_plan_id := (select insurance_plan_id from public.patients where id = new.patient_id);
    end if;
  elsif new.service_id is distinct from old.service_id or new.location_id is distinct from old.location_id then
    new.price_cents := app.service_price(new.service_id, new.location_id);
  end if;

  return new;
end
$$;

create trigger appointments_defaults
  before insert or update of service_id, agenda_id, location_id on public.appointments
  for each row execute function app.appointment_defaults();

-- ---------------------------------------------------------------------------
-- Turmas de exame (portado de book/reschedule_group_exam_session do piloto,
-- agora por agenda e no fuso da clínica)
-- ---------------------------------------------------------------------------
-- Trava a janela, confere as vagas e marca. Quem chama precisa ter acesso à
-- agenda (membro da clínica com acesso a ela, Suporte ou bot da clínica).
create function public.book_group_session(
  p_service_id uuid,
  p_agenda_id uuid,
  p_location_id uuid,
  p_patient_id uuid,
  p_scheduled_at timestamptz,
  p_booking_channel public.action_channel
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
  v_duration integer;
  v_local timestamp;
  v_capacity integer;
  v_booked integer;
  v_appointment_id uuid;
begin
  select clinic_id, duration_minutes into v_clinic_id, v_duration
    from public.services where id = p_service_id and scheduling_mode = 'group';
  if v_clinic_id is null or not app.can_access_agenda(p_agenda_id)
     or not exists (select 1 from public.agendas where id = p_agenda_id and clinic_id = v_clinic_id) then
    raise exception 'Sem acesso a esta agenda.' using errcode = '42501';
  end if;

  v_local := p_scheduled_at at time zone (select timezone from public.clinic_settings where clinic_id = v_clinic_id);

  select capacity into v_capacity
    from public.availability_windows
    where agenda_id = p_agenda_id
      and service_id = p_service_id
      and weekday = extract(dow from v_local)
      and start_time = v_local::time
      and is_active
    for update;
  if v_capacity is null then
    raise exception 'no_window' using errcode = 'P0001';
  end if;

  select count(*) into v_booked
    from public.appointments
    where agenda_id = p_agenda_id
      and service_id = p_service_id
      and scheduled_at = p_scheduled_at
      and status in ('scheduled', 'confirmed');
  if v_booked >= v_capacity then
    raise exception 'slot_full' using errcode = 'P0001';
  end if;

  insert into public.appointments (
    clinic_id, patient_id, service_id, agenda_id, location_id,
    scheduled_at, duration_minutes, booking_channel, created_by
  ) values (
    v_clinic_id, p_patient_id, p_service_id, p_agenda_id, p_location_id,
    p_scheduled_at, v_duration, p_booking_channel, (select auth.uid())
  )
  returning id into v_appointment_id;

  return v_appointment_id;
end
$$;

create function public.reschedule_group_session(
  p_appointment_id uuid,
  p_scheduled_at timestamptz,
  p_channel public.action_channel
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments%rowtype;
  v_local timestamp;
  v_capacity integer;
  v_booked integer;
begin
  select * into v_appointment from public.appointments where id = p_appointment_id;
  if v_appointment.id is null or not app.can_access_agenda(v_appointment.agenda_id) then
    raise exception 'Sem acesso a esta agenda.' using errcode = '42501';
  end if;

  v_local := p_scheduled_at at time zone (select timezone from public.clinic_settings where clinic_id = v_appointment.clinic_id);

  select capacity into v_capacity
    from public.availability_windows
    where agenda_id = v_appointment.agenda_id
      and service_id = v_appointment.service_id
      and weekday = extract(dow from v_local)
      and start_time = v_local::time
      and is_active
    for update;
  if v_capacity is null then
    raise exception 'no_window' using errcode = 'P0001';
  end if;

  select count(*) into v_booked
    from public.appointments
    where agenda_id = v_appointment.agenda_id
      and service_id = v_appointment.service_id
      and scheduled_at = p_scheduled_at
      and status in ('scheduled', 'confirmed')
      and id <> p_appointment_id;
  if v_booked >= v_capacity then
    raise exception 'slot_full' using errcode = 'P0001';
  end if;

  update public.appointments
    set scheduled_at = p_scheduled_at,
        rescheduled_at = now(),
        rescheduled_via = p_channel,
        rescheduled_by = (select auth.uid())
    where id = p_appointment_id;
end
$$;

revoke execute on function public.book_group_session(uuid, uuid, uuid, uuid, timestamptz, public.action_channel) from public, anon;
revoke execute on function public.reschedule_group_session(uuid, timestamptz, public.action_channel) from public, anon;
grant execute on function public.book_group_session(uuid, uuid, uuid, uuid, timestamptz, public.action_channel) to authenticated, clinic_service;
grant execute on function public.reschedule_group_session(uuid, timestamptz, public.action_channel) to authenticated, clinic_service;

-- ---------------------------------------------------------------------------
-- Bloqueios por agenda
-- ---------------------------------------------------------------------------
create table public.schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  agenda_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz,
  updated_by uuid references auth.users (id) on delete set null,
  -- Remover não apaga a linha (histórico para a trilha): só bloqueios com
  -- `removed_at` nulo ocupam a agenda.
  removed_at timestamptz,
  removed_by uuid references auth.users (id) on delete set null,
  foreign key (clinic_id, agenda_id) references public.agendas (clinic_id, id),
  check (ends_at > starts_at)
);

create index schedule_blocks_active_idx on public.schedule_blocks (agenda_id, starts_at, ends_at) where removed_at is null;

-- ---------------------------------------------------------------------------
-- Links de agendar/remarcar (página pública /agendar/[token])
-- ---------------------------------------------------------------------------
create table public.booking_links (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  contact_id uuid not null,
  patient_id uuid not null,
  service_id uuid not null,
  -- Nulo = "primeiro horário disponível" entre as agendas do serviço (D2 revista).
  agenda_id uuid,
  location_id uuid,
  location_category public.location_type,
  mode public.booking_link_mode not null,
  appointment_id uuid,
  origin_appointment_id uuid,
  return_deadline_waived boolean not null default false,
  contact_phone text not null,
  home_visit_address text,
  join_waitlist boolean not null default false,
  funnel_session_id uuid,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (clinic_id, contact_id) references public.contacts (clinic_id, id),
  foreign key (clinic_id, patient_id) references public.patients (clinic_id, id),
  foreign key (clinic_id, service_id) references public.services (clinic_id, id),
  foreign key (clinic_id, agenda_id) references public.agendas (clinic_id, id),
  foreign key (clinic_id, location_id) references public.locations (clinic_id, id),
  foreign key (clinic_id, appointment_id) references public.appointments (clinic_id, id),
  foreign key (clinic_id, origin_appointment_id) references public.appointments (clinic_id, id),
  check (mode = 'create' or appointment_id is not null)
);

-- ---------------------------------------------------------------------------
-- Trilha do atendimento (só acrescenta)
-- ---------------------------------------------------------------------------
create table public.appointment_events (
  id bigint generated always as identity primary key,
  clinic_id uuid not null,
  appointment_id uuid not null,
  event_type text not null check (event_type in (
    'created',
    'rescheduled',           -- details: { from, to }
    'canceled',
    'presence_confirmed',
    'presence_unconfirmed',
    'attendance_recorded',   -- details: { status: 'completed' | 'no_show' }
    'attendance_corrected',  -- details: { from, to }
    'message_not_sent',      -- details: { kind, reason }
    'reminder_resent',
    'preparation_resent'
  )),
  -- Login de quem fez pela tela; nulo = WhatsApp ou o próprio sistema.
  actor_id uuid references auth.users (id) on delete set null,
  channel text not null check (channel in (
    'admin', 'whatsapp_bot', 'booking_link', 'cron', 'mass_cancel', 'schedule_block'
  )),
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  foreign key (clinic_id, appointment_id) references public.appointments (clinic_id, id) on delete cascade
);

create index appointment_events_appointment_idx on public.appointment_events (appointment_id, occurred_at);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create trigger appointment_series_set_updated_at before update on public.appointment_series
  for each row execute function app.set_updated_at();
create trigger appointments_set_updated_at before update on public.appointments
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
select app.enable_clinic_data_rls('public.appointments');
select app.restrict_clinic_data_to_agenda('public.appointments');
select app.enable_clinic_data_rls('public.appointment_series');
select app.restrict_clinic_data_to_agenda('public.appointment_series');
select app.enable_clinic_data_rls('public.schedule_blocks');
select app.restrict_clinic_data_to_agenda('public.schedule_blocks');
select app.enable_clinic_data_rls('public.booking_links');

-- Datas puladas e trilha seguem o acesso ao registro de origem (as subconsultas
-- abaixo já passam pelo RLS da série/do atendimento).
alter table public.appointment_series_skips enable row level security;

create policy appointment_series_skips_select on public.appointment_series_skips
  for select to authenticated
  using (exists (select 1 from public.appointment_series s where s.id = series_id));

create policy appointment_series_skips_insert on public.appointment_series_skips
  for insert to authenticated
  with check (
    app.has_clinic_role(clinic_id, array['admin', 'professional', 'reception']::public.clinic_role[])
    and exists (select 1 from public.appointment_series s where s.id = series_id)
  );

create policy appointment_series_skips_delete on public.appointment_series_skips
  for delete to authenticated
  using (
    app.has_clinic_role(clinic_id, array['admin', 'professional', 'reception']::public.clinic_role[])
    and exists (select 1 from public.appointment_series s where s.id = series_id)
  );

create policy appointment_series_skips_select_service on public.appointment_series_skips
  for select to clinic_service
  using (clinic_id = app.service_clinic_id());

create trigger appointment_series_skips_audit_platform_staff
  after insert or update or delete on public.appointment_series_skips
  for each row execute function app.audit_platform_staff_write();

alter table public.appointment_events enable row level security;

create policy appointment_events_select on public.appointment_events
  for select to authenticated
  using (exists (select 1 from public.appointments a where a.id = appointment_id));

create policy appointment_events_insert on public.appointment_events
  for insert to authenticated
  with check (
    app.has_clinic_role(clinic_id, array['admin', 'professional', 'reception']::public.clinic_role[])
    and exists (select 1 from public.appointments a where a.id = appointment_id)
  );

create policy appointment_events_select_service on public.appointment_events
  for select to clinic_service
  using (clinic_id = app.service_clinic_id());

create policy appointment_events_insert_service on public.appointment_events
  for insert to clinic_service
  with check (clinic_id = app.service_clinic_id());

create trigger appointment_events_audit_platform_staff
  after insert or update or delete on public.appointment_events
  for each row execute function app.audit_platform_staff_write();

-- O bot nunca apaga; a trilha nunca é alterada nem apagada pela API.
revoke delete on public.appointments, public.appointment_series, public.schedule_blocks,
  public.booking_links, public.appointment_series_skips from clinic_service;
revoke update, delete on public.appointment_events from anon, authenticated, clinic_service;
revoke insert, update on public.appointment_series_skips from clinic_service;
