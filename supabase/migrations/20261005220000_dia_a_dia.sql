-- F4.8 — Dia a dia: nome de cada pessoa da equipe, quem fez cada ação e
-- "Desistiu" na aba Aguardando remarcação (cliente, 05/out/2026).

-- ---------------------------------------------------------------------------
-- Nome na equipe (cliente, 05/out: a trilha mostra o nome de quem fez)
-- ---------------------------------------------------------------------------
alter table public.clinic_members
  add column display_name text check (display_name is null or length(trim(display_name)) > 0);

-- Quem fez: nome na clínica (ou o e-mail, sem nome), os papéis, ou o Suporte
-- RecepClinic com o nome dele. Toda a equipe da clínica vê (os nomes dos
-- colegas aparecem na trilha); quem saiu da equipe aparece pelo e-mail.
create function public.clinic_actor_labels(p_clinic_id uuid, p_user_ids uuid[])
returns table (user_id uuid, name text, roles public.clinic_role[], is_support boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    u.id,
    coalesce(m.display_name, case when m.user_id is null then ps.display_name end, u.email::text),
    m.roles,
    m.user_id is null and ps.user_id is not null
  from unnest(p_user_ids) as ids (id)
  join auth.users u on u.id = ids.id
  left join public.clinic_members m on m.clinic_id = p_clinic_id and m.user_id = u.id
  left join public.platform_staff ps on ps.user_id = u.id
  where app.is_clinic_member(p_clinic_id)
$$;

revoke execute on function public.clinic_actor_labels(uuid, uuid[]) from public, anon, clinic_service;
grant execute on function public.clinic_actor_labels(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Trilha: "Desistiu" na aba Aguardando remarcação
-- ---------------------------------------------------------------------------
alter table public.appointment_events drop constraint appointment_events_event_type_check;
alter table public.appointment_events add constraint appointment_events_event_type_check check (event_type in (
  'created',
  'rescheduled',           -- details: { from, to }
  'canceled',
  'presence_confirmed',
  'presence_unconfirmed',
  'attendance_recorded',   -- details: { status: 'completed' | 'no_show' }
  'attendance_corrected',  -- details: { from, to }
  'message_not_sent',      -- details: { kind, reason }
  'reminder_resent',
  'preparation_resent',
  'waitlist_joined',
  'waitlist_left',         -- details: { reason }
  'waitlist_advanced',     -- details: { from, to }
  'rebooking_dismissed'    -- a equipe parou de acompanhar a remarcação
));
