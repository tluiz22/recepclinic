-- F4.4b — Configurações II: hora do lembrete e equipe (cliente, 05/out/2026).

-- ---------------------------------------------------------------------------
-- Hora do lembrete da véspera: horas cheias das 7h às 20h, como no piloto
-- (cliente, 05/out). Evita mensagem ao paciente de madrugada ou tarde da noite.
-- ---------------------------------------------------------------------------
update public.clinic_settings set reminder_hour = least(greatest(reminder_hour, 7), 20)
  where reminder_hour not between 7 and 20;

alter table public.clinic_settings drop constraint clinic_settings_reminder_hour_check;
alter table public.clinic_settings
  add constraint clinic_settings_reminder_hour_check check (reminder_hour between 7 and 20);

-- ---------------------------------------------------------------------------
-- Equipe: e-mail de cada membro
-- ---------------------------------------------------------------------------
-- A equipe não lê auth.users, e quem entrou antes dos convites (F4.4a) não
-- tem convite com o e-mail. Só o Administrador da clínica (e o Suporte) vê.
create function public.list_clinic_member_emails(p_clinic_id uuid)
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, u.email::text
  from public.clinic_members m
  join auth.users u on u.id = m.user_id
  where m.clinic_id = p_clinic_id
    and app.has_clinic_role(p_clinic_id, array['admin']::public.clinic_role[])
$$;

revoke execute on function public.list_clinic_member_emails(uuid) from public, anon, clinic_service;
grant execute on function public.list_clinic_member_emails(uuid) to authenticated;
