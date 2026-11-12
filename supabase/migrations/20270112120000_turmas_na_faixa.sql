-- Turmas na faixa (cliente, 11/nov/2026): o horário de um exame em turma abre uma turma a cada duração do exame,
-- do início ao fim (08:00–12:00 com 60 min: 08:00, 09:00, 10:00 e 11:00), cada uma com as vagas da faixa. Antes,
-- uma turma só, no início (D5). A primeira turma vale sempre (faixa mais curta que o exame, como antes).

create or replace function app.group_starts_at(p_start time, p_end time, p_at time, p_duration integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_at = p_start
    or (
      p_duration > 0
      and p_at > p_start
      and mod(extract(epoch from (p_at - p_start))::integer, p_duration * 60) = 0
      and extract(epoch from (p_end - p_at)) >= p_duration * 60
    )
$$;

-- book_group_session: a turma pode começar em qualquer passo da faixa.
CREATE OR REPLACE FUNCTION public.book_group_session(p_service_id uuid, p_agenda_id uuid, p_location_id uuid, p_patient_id uuid, p_scheduled_at timestamp with time zone, p_booking_channel action_channel, p_trail jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      and app.group_starts_at(start_time, end_time, v_local::time, v_duration)
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
    scheduled_at, duration_minutes, booking_channel, created_by, trail_context
  ) values (
    v_clinic_id, p_patient_id, p_service_id, p_agenda_id, p_location_id,
    p_scheduled_at, v_duration, p_booking_channel, (select auth.uid()), p_trail
  )
  returning id into v_appointment_id;

  return v_appointment_id;
end
$function$;

-- reschedule_group_session: a turma pode começar em qualquer passo da faixa.
CREATE OR REPLACE FUNCTION public.reschedule_group_session(p_appointment_id uuid, p_scheduled_at timestamp with time zone, p_channel action_channel, p_trail jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      and app.group_starts_at(start_time, end_time, v_local::time, (select duration_minutes from public.services where id = v_appointment.service_id))
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
        rescheduled_by = (select auth.uid()),
        trail_context = p_trail
    where id = p_appointment_id;
end
$function$;

-- change_group_session: a turma pode começar em qualquer passo da faixa.
CREATE OR REPLACE FUNCTION public.change_group_session(p_appointment_id uuid, p_service_id uuid, p_agenda_id uuid, p_scheduled_at timestamp with time zone, p_trail jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if v_appointment.status = 'canceled' then
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
      and app.group_starts_at(start_time, end_time, v_local::time, v_duration)
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
$function$;
