-- Desbloqueio do portal pela recepção, na ficha do paciente (validação da F3, cliente, 10/nov/2026; seção 15.3.2 do
-- plano). O bloqueio do portal é do celular e vale para todos os pacientes dele. Dois tipos, os dois liberados pelo
-- "Liberar agora" da faixa no alto da ficha (decisão do cliente):
--   - bloqueio por excesso (`portal_blocks`, chave "phone:<celular>"): código pedido demais (15 min → 1 h → 24 h);
--   - limite do dia: 5 consultas marcadas pelo portal por celular em 24 h (contagem, sem linha de bloqueio).
-- 1. portal_limit_resets: cada liberação (quem e quando); a contagem do limite do dia recomeça nela.
-- 2. portal_hold_slot e portal_hold_group_slot: contam só as marcadas depois da última liberação (o resto igual às
--    versões de 20270108140000 e 20270108130000).
-- 3. portal_phone_status (a faixa) e portal_release_phone (o botão): Administrador e Recepção.
-- 4. Limpeza diária: liberações com mais de 30 dias saem junto.
-- Reversão: recriar as duas funções de reserva como nas migrações citadas; apagar as funções novas e a tabela.

-- ---------------------------------------------------------------------------
-- 1. Liberações
create table public.portal_limit_resets (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  phone text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
create index portal_limit_resets_phone_idx on public.portal_limit_resets (clinic_id, phone, created_at desc);
alter table public.portal_limit_resets enable row level security;
create policy portal_limit_resets_member on public.portal_limit_resets for select to authenticated using (app.is_clinic_member(clinic_id));
create policy portal_limit_resets_service on public.portal_limit_resets for select to clinic_service using (clinic_id = app.service_clinic_id());
revoke all on public.portal_limit_resets from anon;
revoke insert, update, delete, truncate on public.portal_limit_resets from authenticated;
grant select on public.portal_limit_resets to authenticated, clinic_service;
-- Alterações feitas pelo Suporte ficam no registro; clínica suspensa não grava (como as outras tabelas do portal).
create trigger portal_limit_resets_audit_platform_staff after insert or update or delete on public.portal_limit_resets
  for each row execute function app.audit_platform_staff_write();
create trigger portal_limit_resets_guard_suspended before insert or update or delete on public.portal_limit_resets
  for each row execute function app.guard_suspended_clinic_write();

-- ---------------------------------------------------------------------------
-- 2. Reservas: a contagem do limite do dia recomeça na última liberação
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
    and created_at > now() - interval '24 hours'
    and created_at > coalesce((select max(r.created_at) from public.portal_limit_resets r where r.clinic_id = p_clinic_id and r.phone = v_phone), '-infinity')) >= p_max_per_day then
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
    and created_at > now() - interval '24 hours'
    and created_at > coalesce((select max(r.created_at) from public.portal_limit_resets r where r.clinic_id = p_clinic_id and r.phone = v_phone), '-infinity')) >= p_max_per_day then
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

-- ---------------------------------------------------------------------------
-- 3. Situação do celular no portal e liberação
-- blocked_until: o fim do bloqueio por excesso ativo (null = sem); marked: as consultas marcadas que contam no limite;
-- limit_until: quando o limite do dia acaba sozinho (null = não chegou ao limite).
create function public.portal_phone_status(p_clinic_id uuid, p_phone text, p_max_per_day integer)
returns table (blocked_until timestamptz, marked integer, limit_until timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz;
  v_marked integer;
begin
  if not app.has_clinic_role(p_clinic_id, array['admin', 'reception']::public.clinic_role[]) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  v_since := greatest(now() - interval '24 hours',
    coalesce((select max(created_at) from public.portal_limit_resets where clinic_id = p_clinic_id and phone = p_phone), '-infinity'));
  select count(*) into v_marked from public.slot_holds
  where clinic_id = p_clinic_id and phone = p_phone and appointment_id is not null and created_at > v_since;
  return query select
    (select max(b.blocked_until) from public.portal_blocks b
      where b.clinic_id = p_clinic_id and b.key = 'phone:' || p_phone and b.released_at is null and b.blocked_until > now()),
    v_marked,
    case when v_marked >= p_max_per_day then
      (select h.created_at + interval '24 hours' from public.slot_holds h
        where h.clinic_id = p_clinic_id and h.phone = p_phone and h.appointment_id is not null and h.created_at > v_since
        order by h.created_at desc offset greatest(p_max_per_day - 1, 0) limit 1)
    end;
end
$$;
revoke execute on function public.portal_phone_status(uuid, text, integer) from public, anon, clinic_service;
grant execute on function public.portal_phone_status(uuid, text, integer) to authenticated;

-- Libera o celular: solta os bloqueios por excesso ativos e recomeça a contagem do limite do dia.
create function public.portal_release_phone(p_clinic_id uuid, p_phone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_clinic_role(p_clinic_id, array['admin', 'reception']::public.clinic_role[]) then
    raise exception 'Sem permissão para liberar.' using errcode = '42501';
  end if;
  if p_phone is null or p_phone !~ '^\+[0-9]{8,15}$' then
    raise exception 'Celular inválido.' using errcode = '22023';
  end if;
  update public.portal_blocks set released_at = now(), released_by = (select auth.uid())
  where clinic_id = p_clinic_id and key = 'phone:' || p_phone and released_at is null and blocked_until > now();
  insert into public.portal_limit_resets (clinic_id, phone, created_by) values (p_clinic_id, p_phone, (select auth.uid()));
end
$$;
revoke execute on function public.portal_release_phone(uuid, text) from public, anon, clinic_service;
grant execute on function public.portal_release_phone(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Limpeza diária (a mesma rotina de 20270107120000, com as liberações)
select cron.schedule('limpar-portal', '25 3 * * *', $cron$
  delete from public.portal_rate_hits where at < now() - interval '2 days';
  delete from public.portal_blocks where blocked_until < now() - interval '30 days';
  delete from public.portal_sessions where created_at < now() - interval '30 days';
  delete from public.portal_links where created_at < now() - interval '30 days';
  delete from public.portal_limit_resets where created_at < now() - interval '30 days';
$cron$);
