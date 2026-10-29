-- C4.3 Alterar atendimento que já passou (cliente, 28/out/2026): qualquer um,
-- menos o cancelado. A turma passa a aceitar o atendimento com o comparecimento
-- registrado (compareceu ou faltou). Mesmo corpo de 20261031120000, só a
-- condição da situação muda.
create or replace function public.change_group_session(
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

