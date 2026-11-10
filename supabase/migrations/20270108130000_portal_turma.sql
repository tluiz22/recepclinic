-- F3e-2 da recepção digital (10/nov/2026): exame em turma pelo portal (D5, seção 15.5 do plano).
--   A reserva da turma segura uma vaga (não o horário inteiro, como na consulta): vale enquanto os marcados da sessão
--   mais as reservas ativas de outras sessões não chegam à capacidade da turma. A capacidade vem do servidor (a mesma
--   leitura dos horários da turma, `getGroupSessions`); a marcação confere de novo no banco (`book_group_session`).
--   Mesmas regras da reserva da consulta (portal_hold_slot): sessão comprovada, a mesma reserva ao recarregar, limite
--   de reservas por celular em 24 h e a reserva anterior da sessão ou do celular solta só quando a nova dá certo.
-- Tudo pela credencial limitada à clínica (clinic_service).
--
-- Reversão: `drop function public.portal_hold_group_slot(uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, integer, integer);`

create or replace function public.portal_hold_group_slot(
  p_clinic_id uuid,
  p_session_id uuid,
  p_agenda_id uuid,
  p_service_id uuid,
  p_location_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_capacity integer,
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
begin
  if p_clinic_id is distinct from app.service_clinic_id() then
    raise exception 'Clínica diferente da credencial.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.agendas where id = p_agenda_id and clinic_id = p_clinic_id) then
    raise exception 'Agenda de outra clínica.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.services where id = p_service_id and clinic_id = p_clinic_id and scheduling_mode = 'group') then
    raise exception 'Turma de outra clínica.' using errcode = '42501';
  end if;
  select phone into v_phone from public.portal_sessions
  where id = p_session_id and clinic_id = p_clinic_id and expires_at > now() and phone_verified_at is not null;
  if v_phone is null then
    return query select 'session'::text, null::uuid, null::timestamptz;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agenda:' || p_agenda_id::text, 0));

  -- A mesma turma já reservada nesta sessão (recarregou a página, voltou e seguiu): a mesma reserva.
  select id, expires_at into v_id, v_until from public.slot_holds
  where clinic_id = p_clinic_id and session_id = p_session_id and agenda_id = p_agenda_id and service_id = p_service_id
    and location_id = p_location_id and starts_at = p_starts_at and released_at is null and expires_at > now();
  if v_id is not null then
    return query select 'ok'::text, v_id, v_until;
    return;
  end if;

  -- Contam só as reservas que viraram consulta marcada (como portal_hold_slot, migração 20270107130000).
  if (select count(*) from public.slot_holds where clinic_id = p_clinic_id and phone = v_phone and appointment_id is not null
    and created_at > now() - interval '24 hours') >= p_max_per_day then
    return query select 'limit'::text, null::uuid, null::timestamptz;
    return;
  end if;

  if coalesce(p_capacity, 0) < 1 or (
    (select count(*) from public.appointments
      where clinic_id = p_clinic_id and agenda_id = p_agenda_id and service_id = p_service_id and scheduled_at = p_starts_at
        and status in ('scheduled', 'confirmed'))
    + (select count(*) from public.slot_holds
      where clinic_id = p_clinic_id and agenda_id = p_agenda_id and service_id = p_service_id and starts_at = p_starts_at
        and released_at is null and expires_at > now() and session_id <> p_session_id)
  ) >= p_capacity then
    return query select 'taken'::text, null::uuid, null::timestamptz;
    return;
  end if;

  -- Só agora (a nova reserva deu certo) a reserva anterior da sessão ou do celular é solta.
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

revoke execute on function public.portal_hold_group_slot(uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.portal_hold_group_slot(uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, integer, integer) to clinic_service;
