-- F3e da recepção digital (cliente, 10/nov/2026, revisão de código): na agenda de Exames, a reserva do portal só
-- segura o horário do mesmo exame. Exames diferentes no mesmo horário não se bloqueiam (como os exames marcados, que
-- já não ocupam a agenda de Exames: `not is_exam`); a reserva da turma (portal_hold_group_slot, 20270108130000) conta
-- só como vaga da turma e não esconde exame individual. Fora dos exames (consulta, retorno), como antes: qualquer
-- reserva da agenda no horário ocupa.
-- O resto é igual a 20270107130000 (limite só com as reservas que viraram consulta).
-- Reversão: recriar a função como em 20270107130000.
create or replace function public.portal_hold_slot(
  p_clinic_id uuid,
  p_session_id uuid,
  p_agenda_id uuid,
  p_service_id uuid,
  p_location_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_max_per_day integer
)
returns table (outcome text, hold_id uuid, hold_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_minutes integer;
  v_id uuid;
  v_until timestamptz;
  v_exam boolean;
begin
  if p_clinic_id is distinct from app.service_clinic_id() then
    raise exception 'Clínica diferente da credencial.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.agendas where id = p_agenda_id and clinic_id = p_clinic_id) then
    raise exception 'Agenda de outra clínica.' using errcode = '42501';
  end if;
  select phone into v_phone from public.portal_sessions
  where id = p_session_id and clinic_id = p_clinic_id and expires_at > now() and phone_verified_at is not null;
  if v_phone is null then
    return query select 'session'::text, null::uuid, null::timestamptz;
    return;
  end if;

  select category = 'exam' into v_exam from public.services where id = p_service_id and clinic_id = p_clinic_id;
  if v_exam is null then
    raise exception 'Serviço de outra clínica.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agenda:' || p_agenda_id::text, 0));

  -- O mesmo horário já reservado nesta sessão (recarregou a página, voltou e seguiu): a mesma reserva.
  select id, expires_at into v_id, v_until from public.slot_holds
  where clinic_id = p_clinic_id and session_id = p_session_id and agenda_id = p_agenda_id and service_id = p_service_id
    and location_id = p_location_id and starts_at = p_starts_at and released_at is null and expires_at > now();
  if v_id is not null then
    return query select 'ok'::text, v_id, v_until;
    return;
  end if;

  if (select count(*) from public.slot_holds where clinic_id = p_clinic_id and phone = v_phone and appointment_id is not null
    and created_at > now() - interval '24 hours') >= p_max_per_day then
    return query select 'limit'::text, null::uuid, null::timestamptz;
    return;
  end if;

  if exists (
    select 1 from public.appointments
    where agenda_id = p_agenda_id and status in ('scheduled', 'confirmed') and not is_group_session and not is_exam
      and app.appointment_period(scheduled_at, duration_minutes) && tstzrange(p_starts_at, p_ends_at)
  ) or exists (
    select 1 from public.slot_holds
    where agenda_id = p_agenda_id and released_at is null and expires_at > now() and session_id <> p_session_id
      and tstzrange(starts_at, ends_at) && tstzrange(p_starts_at, p_ends_at)
      -- Exame: só a reserva do mesmo exame ocupa.
      and (not v_exam or service_id = p_service_id)
  ) then
    return query select 'taken'::text, null::uuid, null::timestamptz;
    return;
  end if;

  -- Só agora (o novo horário deu certo) a reserva anterior da sessão ou do celular é solta.
  update public.slot_holds set released_at = now()
  where clinic_id = p_clinic_id and released_at is null and expires_at > now() and (session_id = p_session_id or phone = v_phone);

  select portal_hold_minutes into v_minutes from public.clinic_settings where clinic_id = p_clinic_id;
  v_until := now() + make_interval(mins => coalesce(v_minutes, 5));
  insert into public.slot_holds (clinic_id, agenda_id, service_id, location_id, starts_at, ends_at, session_id, phone, expires_at)
  values (p_clinic_id, p_agenda_id, p_service_id, p_location_id, p_starts_at, p_ends_at, p_session_id, v_phone, v_until)
  returning id into v_id;
  return query select 'ok'::text, v_id, v_until;
end
$$;
