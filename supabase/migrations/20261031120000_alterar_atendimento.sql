-- C4 Alterar atendimento (cliente, 28/out/2026): a equipe corrige serviço,
-- agenda, local, convênio, endereço, data e hora de um atendimento já marcado.
--   1. evento novo da trilha, "changed", com o que mudou (de → para);
--   2. a trilha grava o "changed" quando a aplicação manda esse evento (antes
--      do "rescheduled": a mudança de horário vai junto, no mesmo evento);
--   3. turma: a troca confere a vaga com a janela travada, como o remarcar.

-- 1. Evento novo.
alter table public.appointment_events drop constraint appointment_events_event_type_check;
alter table public.appointment_events add constraint appointment_events_event_type_check check (event_type in (
  'created', 'rescheduled', 'canceled', 'presence_confirmed', 'presence_unconfirmed',
  'attendance_recorded', 'attendance_corrected', 'message_not_sent', 'reminder_resent',
  'preparation_resent', 'guidance_resent', 'waitlist_joined', 'waitlist_left',
  'waitlist_advanced', 'rebooking_dismissed', 'changed'
));

-- 2. Trilha: mesmo corpo de 20261022120000_metricas_trilha, com o "changed".
create or replace function app.record_appointment_trail()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx jsonb := nullif(current_setting('recepclinic.trail_' || replace(new.id::text, '-', ''), true), '')::jsonb;
  v_channel text := v_ctx->>'channel';
  v_event text := v_ctx->>'event';
  v_actor uuid := nullif(v_ctx->>'actor', '')::uuid;
  v_details jsonb := coalesce(v_ctx->'details', '{}'::jsonb);
  v_login uuid := case when (select auth.role()) = 'authenticated' then (select auth.uid()) end;
begin
  if tg_op = 'INSERT' then
    insert into public.appointment_events (clinic_id, appointment_id, event_type, actor_id, channel, details)
    values (
      new.clinic_id, new.id, 'created', coalesce(v_actor, new.created_by, v_login),
      coalesce(v_channel, new.booking_channel::text),
      v_details || case when new.agenda_import_id is not null then '{"imported": true}'::jsonb else '{}'::jsonb end
    );
    return null;
  end if;

  if new.status = 'canceled' and old.status <> 'canceled' then
    insert into public.appointment_events (clinic_id, appointment_id, event_type, actor_id, channel, details)
    values (
      new.clinic_id, new.id, 'canceled', coalesce(v_actor, new.canceled_by),
      coalesce(v_channel, new.canceled_via::text, 'admin'), v_details
    );
  elsif new.status in ('completed', 'no_show') and new.status is distinct from old.status then
    insert into public.appointment_events (clinic_id, appointment_id, event_type, actor_id, channel, details)
    values (
      new.clinic_id, new.id,
      case when old.status in ('completed', 'no_show') then 'attendance_corrected' else 'attendance_recorded' end,
      coalesce(v_actor, v_login), coalesce(v_channel, 'admin'),
      v_details || case when old.status in ('completed', 'no_show')
        then jsonb_build_object('from', old.status, 'to', new.status)
        else jsonb_build_object('status', new.status) end
    );
  elsif v_event = 'changed' then
    insert into public.appointment_events (clinic_id, appointment_id, event_type, actor_id, channel, details)
    values (new.clinic_id, new.id, 'changed', coalesce(v_actor, v_login), coalesce(v_channel, 'admin'), v_details);
  elsif new.scheduled_at is distinct from old.scheduled_at and new.status <> 'canceled' then
    insert into public.appointment_events (clinic_id, appointment_id, event_type, actor_id, channel, details)
    values (
      new.clinic_id, new.id,
      case when v_event = 'waitlist_advanced' then 'waitlist_advanced' else 'rescheduled' end,
      coalesce(v_actor, new.rescheduled_by),
      coalesce(v_channel, new.rescheduled_via::text, 'admin'),
      v_details || jsonb_build_object('from', app.trail_instant(old.scheduled_at), 'to', app.trail_instant(new.scheduled_at))
    );
  end if;
  return null;
end
$$;

revoke execute on function app.record_appointment_trail() from public, anon, authenticated, clinic_service;

-- 3. Turma: troca de serviço, agenda, local ou horário com a vaga conferida
-- (a janela fica travada até o fim da transação, como em book_group_session).
-- O próprio atendimento não conta como ocupando a vaga.
create function public.change_group_session(
  p_appointment_id uuid,
  p_service_id uuid,
  p_agenda_id uuid,
  p_scheduled_at timestamptz,
  p_trail jsonb default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments%rowtype;
  v_duration integer;
  v_local timestamp;
  v_capacity integer;
  v_location_id uuid;
  v_booked integer;
begin
  select * into v_appointment from public.appointments where id = p_appointment_id for update;
  if v_appointment.id is null
     or not app.can_access_agenda(v_appointment.agenda_id)
     or not app.can_access_agenda(p_agenda_id)
     or not app.has_clinic_role(v_appointment.clinic_id, array['admin', 'professional', 'reception']::public.clinic_role[])
     or not exists (select 1 from public.agendas where id = p_agenda_id and clinic_id = v_appointment.clinic_id) then
    raise exception 'Sem acesso a esta agenda.' using errcode = '42501';
  end if;
  if v_appointment.status not in ('scheduled', 'confirmed') then
    raise exception 'not_active' using errcode = 'P0001';
  end if;

  select duration_minutes into v_duration
    from public.services
    where id = p_service_id and clinic_id = v_appointment.clinic_id and scheduling_mode = 'group';
  if v_duration is null then
    raise exception 'no_window' using errcode = 'P0001';
  end if;

  v_local := p_scheduled_at at time zone (select timezone from public.clinic_settings where clinic_id = v_appointment.clinic_id);

  select capacity, location_id into v_capacity, v_location_id
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
      and status in ('scheduled', 'confirmed')
      and id <> p_appointment_id;
  if v_booked >= v_capacity then
    raise exception 'slot_full' using errcode = 'P0001';
  end if;

  update public.appointments
    set service_id = p_service_id,
        agenda_id = p_agenda_id,
        location_id = v_location_id,
        scheduled_at = p_scheduled_at,
        duration_minutes = v_duration,
        trail_context = p_trail
    where id = p_appointment_id;
end
$$;

revoke execute on function public.change_group_session(uuid, uuid, uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.change_group_session(uuid, uuid, uuid, timestamptz, jsonb) to authenticated;
