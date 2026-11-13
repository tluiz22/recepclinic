-- Aba Usabilidade (U2), ajustes da revisão: a carga da agenda (agenda_import_id) fica fora da base, como em
-- `metrics_portal`; cancelamento em massa não conta; no portal só conta o cancelamento que não foi da recepção.
-- Reservas vencidas misturam desistência e falha de gravação da marcação: é pista, não prova (dito na tela).
create or replace function public.metrics_usability(p_clinic_id uuid, p_start timestamptz, p_end timestamptz)
returns table (signal text, affected bigint, base bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with allowed as (select app.is_platform_staff() as ok),
  appts as (
    select a.booking_channel, a.created_at, a.canceled_at, a.canceled_via, a.mass_canceled, a.rescheduled_at, a.status
      from public.appointments a, allowed
     where allowed.ok and a.clinic_id = p_clinic_id and a.created_at >= p_start and a.created_at < p_end
       and a.agenda_import_id is null
  ),
  codes as (
    select c.attempts from public.portal_codes c, allowed
     where allowed.ok and c.clinic_id = p_clinic_id and c.created_at >= p_start and c.created_at < p_end
  ),
  holds as (
    select h.appointment_id, h.released_at, h.expires_at from public.slot_holds h, allowed
     where allowed.ok and h.clinic_id = p_clinic_id and h.created_at >= p_start and h.created_at < p_end
  )
  select 'portal_cancel_1h', count(*) filter (where status = 'canceled' and not mass_canceled and canceled_via is distinct from 'admin' and canceled_at - created_at < interval '1 hour'), count(*)
    from appts where booking_channel = 'portal'
  union all
  select 'admin_cancel_5min', count(*) filter (where status = 'canceled' and not mass_canceled and canceled_at - created_at < interval '5 minutes'), count(*)
    from appts where booking_channel = 'admin'
  union all
  select 'resched_1h', count(*) filter (where rescheduled_at is not null and rescheduled_at - created_at < interval '1 hour'), count(*)
    from appts
  union all
  select 'code_wrong', count(*) filter (where attempts > 0), count(*) from codes
  union all
  select 'hold_expired', count(*) filter (where appointment_id is null and released_at is null and expires_at < now()), count(*) from holds
$$;
