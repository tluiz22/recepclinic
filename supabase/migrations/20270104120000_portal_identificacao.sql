-- F2b da recepção digital (08/nov/2026): identificação pelo celular e segurança do portal de agendamento.
--   1. Sessão do portal (cookie opaco; o banco guarda só o hash) com o celular comprovado.
--   2. Código de 6 dígitos pelo WhatsApp (guardado só o hash; 10 min, 5 tentativas).
--   3. Limites de uso com bloqueio progressivo (15 min → 1 h → 24 h; nunca permanente; a equipe libera).
--   4. Reserva do horário (5 min, prazo da clínica) com trava por agenda: dois pacientes não reservam o mesmo horário.
--   5. Modelo do código no WhatsApp (template de autenticação da Meta).
-- Tudo pela credencial limitada à clínica (clinic_service); a equipe da clínica só lê.
--
-- Reversão: drop das funções e das tabelas novas; a restrição de `template_key` sem 'portal_code' (apagar antes as
-- linhas desse modelo).

-- ---------------------------------------------------------------------------
-- 1. Sessão
create table public.portal_sessions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  token_hash text not null unique,
  -- Celular comprovado pelo código (E.164); null = ainda não.
  phone text check (phone ~ '^\+\d{10,15}$'),
  phone_verified_at timestamptz,
  -- IP truncado (IPv4 /24, IPv6 /48): limites e auditoria sem guardar o IP inteiro (proposta, 7.5).
  ip_prefix text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index portal_sessions_clinic_idx on public.portal_sessions (clinic_id, created_at);

-- ---------------------------------------------------------------------------
-- 2. Código
create table public.portal_codes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  session_id uuid not null references public.portal_sessions (id) on delete cascade,
  phone text not null check (phone ~ '^\+\d{10,15}$'),
  code_hash text not null,
  attempts smallint not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index portal_codes_session_idx on public.portal_codes (session_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Limites de uso
create table public.portal_rate_hits (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  key text not null,
  action text not null,
  at timestamptz not null default now()
);
create index portal_rate_hits_key_idx on public.portal_rate_hits (clinic_id, key, action, at);

create table public.portal_blocks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  -- "phone:+5584…", "ip:200.1.2", "session:<id>"
  key text not null,
  action text not null,
  level smallint not null check (level between 1 and 3),
  blocked_until timestamptz not null,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  released_by uuid references auth.users (id) on delete set null
);
create index portal_blocks_key_idx on public.portal_blocks (clinic_id, key, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Reserva do horário
create table public.slot_holds (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  agenda_id uuid not null references public.agendas (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  session_id uuid not null references public.portal_sessions (id) on delete cascade,
  phone text not null,
  expires_at timestamptz not null,
  released_at timestamptz,
  created_at timestamptz not null default now()
);
create index slot_holds_agenda_idx on public.slot_holds (agenda_id, starts_at);
create index slot_holds_session_idx on public.slot_holds (session_id);

-- ---------------------------------------------------------------------------
-- Acesso: a credencial da clínica lê as dela e grava sessão e código; limites e reservas só pelas funções abaixo.
-- A equipe da clínica lê (reservas na Agenda e bloqueios para liberar, nas próximas etapas).
alter table public.portal_sessions enable row level security;
alter table public.portal_codes enable row level security;
alter table public.portal_rate_hits enable row level security;
alter table public.portal_blocks enable row level security;
alter table public.slot_holds enable row level security;

create policy portal_sessions_service on public.portal_sessions for all to clinic_service
  using (clinic_id = app.service_clinic_id()) with check (clinic_id = app.service_clinic_id());
create policy portal_codes_service on public.portal_codes for all to clinic_service
  using (clinic_id = app.service_clinic_id()) with check (clinic_id = app.service_clinic_id());
create policy portal_blocks_service on public.portal_blocks for select to clinic_service using (clinic_id = app.service_clinic_id());
create policy slot_holds_service on public.slot_holds for select to clinic_service using (clinic_id = app.service_clinic_id());
create policy portal_blocks_member on public.portal_blocks for select to authenticated using (app.is_clinic_member(clinic_id));
create policy slot_holds_member on public.slot_holds for select to authenticated using (app.is_clinic_member(clinic_id));

-- Sessões, códigos e contagens: só o Suporte lê (investigação de abuso); a equipe da clínica não precisa.
create policy portal_sessions_staff on public.portal_sessions for select to authenticated using (app.is_platform_staff());
create policy portal_codes_staff on public.portal_codes for select to authenticated using (app.is_platform_staff());
create policy portal_rate_hits_staff on public.portal_rate_hits for select to authenticated using (app.is_platform_staff());

revoke all on public.portal_sessions, public.portal_codes, public.portal_rate_hits, public.portal_blocks, public.slot_holds from anon;
revoke insert, update, delete, truncate on public.portal_sessions, public.portal_codes, public.portal_rate_hits, public.portal_blocks, public.slot_holds from authenticated;
grant select, insert, update on public.portal_sessions, public.portal_codes to clinic_service;
grant select on public.portal_blocks, public.slot_holds to clinic_service;
grant select on public.portal_sessions, public.portal_codes, public.portal_rate_hits, public.portal_blocks, public.slot_holds to authenticated;

-- Alterações feitas pelo Suporte ficam no registro, como em toda tabela da clínica.
create trigger portal_sessions_audit_platform_staff after insert or update or delete on public.portal_sessions
  for each row execute function app.audit_platform_staff_write();
create trigger portal_codes_audit_platform_staff after insert or update or delete on public.portal_codes
  for each row execute function app.audit_platform_staff_write();
create trigger portal_rate_hits_audit_platform_staff after insert or update or delete on public.portal_rate_hits
  for each row execute function app.audit_platform_staff_write();
create trigger portal_blocks_audit_platform_staff after insert or update or delete on public.portal_blocks
  for each row execute function app.audit_platform_staff_write();
create trigger slot_holds_audit_platform_staff after insert or update or delete on public.slot_holds
  for each row execute function app.audit_platform_staff_write();

-- Clínica suspensa: nada é gravado (o portal já mostra "Agendamento indisponível").
create trigger portal_sessions_guard_suspended before insert or update or delete on public.portal_sessions
  for each row execute function app.guard_suspended_clinic_write();
create trigger portal_codes_guard_suspended before insert or update or delete on public.portal_codes
  for each row execute function app.guard_suspended_clinic_write();
create trigger portal_rate_hits_guard_suspended before insert or update or delete on public.portal_rate_hits
  for each row execute function app.guard_suspended_clinic_write();
create trigger portal_blocks_guard_suspended before insert or update or delete on public.portal_blocks
  for each row execute function app.guard_suspended_clinic_write();
create trigger slot_holds_guard_suspended before insert or update or delete on public.slot_holds
  for each row execute function app.guard_suspended_clinic_write();

-- ---------------------------------------------------------------------------
-- Conta um uso e diz se a chave pode seguir. null = pode; senão, até quando está bloqueada. Quem passa do limite na
-- janela fica bloqueado: 15 min; de novo em 24 h, 1 h; outra vez, 24 h (nunca permanente).
create function public.portal_rate_hit(p_clinic_id uuid, p_key text, p_action text, p_limit integer, p_window_seconds integer)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_until timestamptz;
  v_count integer;
  v_level integer;
begin
  if p_clinic_id is distinct from app.service_clinic_id() then
    raise exception 'Clínica diferente da credencial.' using errcode = '42501';
  end if;
  if p_limit < 1 or p_window_seconds < 1 or length(p_key) > 200 or length(p_action) > 40 then
    raise exception 'Limite inválido.' using errcode = '22023';
  end if;
  select max(blocked_until) into v_until from public.portal_blocks
  where clinic_id = p_clinic_id and key = p_key and action = p_action and released_at is null and blocked_until > now();
  if v_until is not null then
    return v_until;
  end if;
  insert into public.portal_rate_hits (clinic_id, key, action) values (p_clinic_id, p_key, p_action);
  select count(*) into v_count from public.portal_rate_hits
  where clinic_id = p_clinic_id and key = p_key and action = p_action and at > now() - make_interval(secs => p_window_seconds);
  if v_count <= p_limit then
    return null;
  end if;
  select least(count(*) + 1, 3) into v_level from public.portal_blocks
  where clinic_id = p_clinic_id and key = p_key and created_at > now() - interval '24 hours';
  v_until := now() + case v_level when 1 then interval '15 minutes' when 2 then interval '1 hour' else interval '24 hours' end;
  insert into public.portal_blocks (clinic_id, key, action, level, blocked_until) values (p_clinic_id, p_key, p_action, v_level, v_until);
  return v_until;
end
$$;

revoke execute on function public.portal_rate_hit(uuid, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.portal_rate_hit(uuid, text, text, integer, integer) to clinic_service;

-- A equipe da clínica (Recepção, Administrador) libera um bloqueio.
create function public.portal_release_block(p_block_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
begin
  select clinic_id into v_clinic from public.portal_blocks where id = p_block_id;
  if v_clinic is null or not app.has_clinic_role(v_clinic, array['admin', 'reception']::public.clinic_role[]) then
    raise exception 'Sem permissão para liberar.' using errcode = '42501';
  end if;
  update public.portal_blocks set released_at = now(), released_by = (select auth.uid())
  where id = p_block_id and released_at is null;
end
$$;

revoke execute on function public.portal_release_block(uuid) from public, anon, clinic_service;
grant execute on function public.portal_release_block(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reserva do horário (proposta, 7.3 e 7.4). Só para a sessão com o celular comprovado; uma reserva ativa por sessão e
-- por celular (a nova solta as anteriores); no máximo `p_max_per_day` reservas por celular em 24 h. Com a trava da
-- agenda, confere atendimentos ativos e reservas não vencidas de outras sessões no mesmo período.
-- outcome: ok, taken (ocupado ou reservado por outra pessoa), limit (reservas demais no dia), session (sessão
-- vencida ou sem celular comprovado).
create function public.portal_hold_slot(
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

  perform pg_advisory_xact_lock(hashtextextended('agenda:' || p_agenda_id::text, 0));

  update public.slot_holds set released_at = now()
  where clinic_id = p_clinic_id and released_at is null and expires_at > now() and (session_id = p_session_id or phone = v_phone);

  if (select count(*) from public.slot_holds where clinic_id = p_clinic_id and phone = v_phone and created_at > now() - interval '24 hours') >= p_max_per_day then
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
  ) then
    return query select 'taken'::text, null::uuid, null::timestamptz;
    return;
  end if;

  select portal_hold_minutes into v_minutes from public.clinic_settings where clinic_id = p_clinic_id;
  v_until := now() + make_interval(mins => coalesce(v_minutes, 5));
  insert into public.slot_holds (clinic_id, agenda_id, service_id, location_id, starts_at, ends_at, session_id, phone, expires_at)
  values (p_clinic_id, p_agenda_id, p_service_id, p_location_id, p_starts_at, p_ends_at, p_session_id, v_phone, v_until)
  returning id into v_id;
  return query select 'ok'::text, v_id, v_until;
end
$$;

revoke execute on function public.portal_hold_slot(uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.portal_hold_slot(uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, integer) to clinic_service;

-- O paciente voltou ou trocou de horário: solta a reserva da sessão.
create function public.portal_release_hold(p_clinic_id uuid, p_session_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.slot_holds set released_at = now()
  where clinic_id = p_clinic_id and p_clinic_id = app.service_clinic_id() and session_id = p_session_id and released_at is null;
$$;

revoke execute on function public.portal_release_hold(uuid, uuid) from public, anon, authenticated;
grant execute on function public.portal_release_hold(uuid, uuid) to clinic_service;

-- ---------------------------------------------------------------------------
-- 5. Modelo do código (template de autenticação, botão "Copiar código").
alter table public.whatsapp_templates drop constraint whatsapp_templates_template_key_check;
alter table public.whatsapp_templates add constraint whatsapp_templates_template_key_check check (template_key in (
  'confirmation', 'confirmation_return', 'reschedule', 'cancellation', 'clinic_cancellation', 'reminder',
  'exam_preparation', 'exam_preparation_file', 'consultation_guidance', 'waitlist_offer',
  'daily_summary_consultations', 'daily_summary_exams', 'daily_summary_consultations_today', 'daily_summary_exams_today',
  'nfse_document', 'connection_test', 'conversation_resume', 'portal_code'
));
