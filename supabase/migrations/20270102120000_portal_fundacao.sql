-- F1 da recepção digital integrada (docs/implementacao-recepcao-digital.md, cliente, 08/nov/2026):
-- a base do portal de agendamento, sem tela pública.
--
--   1. Matriz: item "Portal de agendamento" (decide só se a clínica tem os links do portal); o bot passa
--      a depender dele (seção 1.1) e toda clínica que já tem o bot ganha o Portal ligado (I6);
--   2. apelidos do endereço do portal: o da clínica (o Suporte escolhe, RD1) e o do profissional
--      (automático pelo nome, fixo, "-2" se repetido na clínica; cliente, 08/nov);
--   3. "Mostrar no portal" e "Atende particular" (só convênio) no profissional;
--   4. observação por convênio na ligação profissional × convênio (autorização, carteirinha…);
--   5. canal "portal" do atendimento e a entrada/lugar de onde veio (Métricas, R5);
--   6. prazos do portal por clínica: reserva (3 a 10 min, padrão 5; RD4) e antecedência para
--      cancelar/remarcar pelo portal (padrão 24 h; RD10).

-- ---------------------------------------------------------------------------
-- 1. Matriz
-- ---------------------------------------------------------------------------
insert into public.features (key, area, label, depends_on, sort_order)
  values ('portal', 'agenda', 'Portal de agendamento', '{}', 45);

update public.features set depends_on = '{portal}' where key = 'whatsapp_bot';

insert into public.clinic_features (clinic_id, feature_key, enabled_by)
  select clinic_id, 'portal', null from public.clinic_features where feature_key = 'whatsapp_bot'
  on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Apelidos
-- ---------------------------------------------------------------------------
-- "Dra. Ana Lima" → "dra-ana-lima" (sem acento, só letras, números e hífen, até 60).
create function app.portal_slug_of(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    -- Corta em 60 antes de tirar os hífens das pontas (o corte pode cair num separador).
    nullif(trim(both '-' from left(regexp_replace(lower(extensions.unaccent(coalesce(p_text, ''))), '[^a-z0-9]+', '-', 'g'), 60)), ''),
    'profissional')
$$;

revoke execute on function app.portal_slug_of(text) from public, anon;
grant execute on function app.portal_slug_of(text) to authenticated, clinic_service;

alter table public.clinics
  add column portal_slug text unique
    check (portal_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(portal_slug) between 3 and 60);

alter table public.professionals
  add column portal_slug text,
  add column show_in_portal boolean not null default true,
  add column accepts_private boolean not null default true;

-- Os de hoje, na ordem do cadastro, pela mesma regra dos novos: o primeiro nome repetido fica sem número e o
-- número pula o apelido que já existe (ex.: "Ana", "Ana 2" e "Ana" → ana, ana-2, ana-3).
do $$
declare
  v_row record;
  v_base text;
  v_slug text;
  v_n integer;
begin
  for v_row in select id, clinic_id, display_name from public.professionals order by clinic_id, created_at, id loop
    v_base := app.portal_slug_of(v_row.display_name);
    v_slug := v_base;
    v_n := 1;
    -- Os ainda não preenchidos estão nulos: só conta o que já foi dado.
    while exists (select 1 from public.professionals where clinic_id = v_row.clinic_id and portal_slug = v_slug) loop
      v_n := v_n + 1;
      v_slug := rtrim(left(v_base, 56), '-') || '-' || v_n;
    end loop;
    update public.professionals set portal_slug = v_slug where id = v_row.id;
  end loop;
end
$$;

-- O padrão vazio só deixa o cadastro sem informar o apelido: o gatilho abaixo sempre o preenche antes da checagem.
alter table public.professionals
  alter column portal_slug set default '',
  alter column portal_slug set not null,
  add constraint professionals_portal_slug_format check (portal_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  add constraint professionals_clinic_portal_slug_key unique (clinic_id, portal_slug);

-- Novo: apelido pelo nome; repetido ganha -2, -3… Depois, ninguém muda (o link nunca quebra).
create function app.professional_portal_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_slug text;
  v_n integer := 1;
begin
  if tg_op = 'UPDATE' then
    if new.portal_slug is distinct from old.portal_slug then
      raise exception 'O endereço do profissional no portal não muda depois de criado.' using errcode = '42501';
    end if;
    return new;
  end if;
  v_base := app.portal_slug_of(new.display_name);
  v_slug := v_base;
  while exists (select 1 from public.professionals where clinic_id = new.clinic_id and portal_slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := rtrim(left(v_base, 56), '-') || '-' || v_n;
  end loop;
  -- Dois cadastros ao mesmo tempo com o mesmo nome: a chave única recusa o segundo, que tenta de novo.
  new.portal_slug := v_slug;
  return new;
end
$$;

revoke execute on function app.professional_portal_slug() from public, anon, authenticated, clinic_service;

create trigger professionals_portal_slug
  before insert or update of portal_slug on public.professionals
  for each row execute function app.professional_portal_slug();

-- O apelido da clínica: só o Suporte (RD1); vazio tira a clínica do endereço.
create function public.set_clinic_portal_slug(p_clinic_id uuid, p_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text := nullif(btrim(lower(coalesce(p_slug, ''))), '');
begin
  if not (app.is_platform_staff() or (select auth.role()) = 'service_role') then
    raise exception 'Só o Administrador do sistema muda o endereço da clínica no portal.' using errcode = '42501';
  end if;
  if v_slug is not null and not (v_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(v_slug) between 3 and 60) then
    raise exception 'Endereço inválido: use de 3 a 60 letras minúsculas, números e hífen.' using errcode = '22023';
  end if;
  if v_slug is not null and exists (select 1 from public.clinics where portal_slug = v_slug and id <> p_clinic_id) then
    raise exception 'Esse endereço já é de outra clínica.' using errcode = '23505', hint = 'portal_slug_taken';
  end if;
  update public.clinics set portal_slug = v_slug, updated_at = now() where id = p_clinic_id;
  if not found then
    raise exception 'Clínica não encontrada.' using errcode = 'P0002';
  end if;
end
$$;

revoke execute on function public.set_clinic_portal_slug(uuid, text) from public, anon, clinic_service;
grant execute on function public.set_clinic_portal_slug(uuid, text) to authenticated, service_role;

-- "Atende particular" anda com os convênios: quem mantém os convênios (Administrador, quem ele autoriza em Equipe)
-- e o próprio profissional mudam, sem precisar mexer no resto do cadastro.
create function public.set_professional_accepts_private(p_clinic_id uuid, p_professional_id uuid, p_accepts boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- coalesce: quem não é profissional tem own_professional_id nulo, e "not (false or null)" deixaria passar.
  if not coalesce(app.can_manage_insurance(p_clinic_id) or p_professional_id = app.own_professional_id(p_clinic_id), false) then
    raise exception 'Sem permissão para mudar os convênios do profissional.' using errcode = '42501';
  end if;
  update public.professionals set accepts_private = coalesce(p_accepts, true), updated_at = now()
   where clinic_id = p_clinic_id and id = p_professional_id;
  if not found then
    raise exception 'Profissional não encontrado.' using errcode = 'P0002';
  end if;
end
$$;

revoke execute on function public.set_professional_accepts_private(uuid, uuid, boolean) from public, anon, clinic_service;
grant execute on function public.set_professional_accepts_private(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Observação por convênio
-- ---------------------------------------------------------------------------
alter table public.professional_insurance_plans
  add column note text check (note is null or (length(btrim(note)) between 1 and 300));

grant update (note) on public.professional_insurance_plans to authenticated;

create policy professional_insurance_plans_update on public.professional_insurance_plans for update to authenticated
  using (app.can_manage_insurance(clinic_id)) with check (app.can_manage_insurance(clinic_id));
create policy professional_insurance_plans_update_own on public.professional_insurance_plans for update to authenticated
  using (professional_id = app.own_professional_id(clinic_id)) with check (professional_id = app.own_professional_id(clinic_id));

alter table public.insurance_change_log drop constraint insurance_change_log_action_check;
alter table public.insurance_change_log add constraint insurance_change_log_action_check
  check (action in ('plan_created', 'plan_updated', 'plan_deleted', 'linked', 'unlinked', 'note_updated'));

create or replace function app.log_insurance_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record := case when tg_op = 'DELETE' then old else new end;
begin
  -- Clínica apagada (a cascata leva tudo junto): não registra.
  if not exists (select 1 from public.clinics where id = v_row.clinic_id) then return null; end if;
  if tg_table_name = 'insurance_plans' then
    insert into public.insurance_change_log (clinic_id, actor_user_id, action, insurance_plan_id)
      values (v_row.clinic_id, (select auth.uid()),
              case tg_op when 'INSERT' then 'plan_created' when 'UPDATE' then 'plan_updated' else 'plan_deleted' end, v_row.id);
  else
    insert into public.insurance_change_log (clinic_id, actor_user_id, action, insurance_plan_id, professional_id)
      values (v_row.clinic_id, (select auth.uid()),
              case tg_op when 'INSERT' then 'linked' when 'UPDATE' then 'note_updated' else 'unlinked' end,
              v_row.insurance_plan_id, v_row.professional_id);
  end if;
  return null;
end
$$;

create trigger professional_insurance_plans_note_log after update of note on public.professional_insurance_plans
  for each row when (new.note is distinct from old.note) execute function app.log_insurance_change();

-- ---------------------------------------------------------------------------
-- 5. Canal e origem
-- ---------------------------------------------------------------------------
alter type public.action_channel add value if not exists 'portal';

-- A trilha do atendimento também aceita o canal do portal.
alter table public.appointment_events drop constraint appointment_events_channel_check;
alter table public.appointment_events add constraint appointment_events_channel_check check (channel in (
  'admin', 'whatsapp_bot', 'booking_link', 'cron', 'mass_cancel', 'schedule_block', 'portal'
));

-- Entrada (R5, filtro "Entrada"): link do bot na conversa, link da clínica ou de profissional.
-- Lugar (R7, "?de="): onde o link foi posto; sem marca = não informado.
alter table public.appointments
  add column portal_entry text check (portal_entry in ('whatsapp', 'clinic_link', 'professional_link')),
  add column portal_place text check (portal_place in ('instagram', 'site', 'google', 'message', 'poster', 'other'));

-- ---------------------------------------------------------------------------
-- 6. Prazos do portal
-- ---------------------------------------------------------------------------
alter table public.clinic_settings
  add column portal_hold_minutes smallint not null default 5 check (portal_hold_minutes between 3 and 10),
  add column portal_cancel_lead_hours smallint not null default 24 check (portal_cancel_lead_hours between 0 and 168);

-- ---------------------------------------------------------------------------
-- 7. Prazo do retorno sem os dias bloqueados inteiros também nas Métricas (I11, cliente, 08/nov/2026)
-- ---------------------------------------------------------------------------
-- A mesma regra de src/lib/data/agenda/blockedDays.ts e returnLastDate: dia bloqueado inteiro = os bloqueios da
-- agenda cobrem todo o horário de atendimento dela naquele dia (dia sem horário nunca conta; feriados não entram).
-- Os dias bloqueados só são procurados até o prazo + 366 dias, como no código.
create function app.is_whole_blocked_day(p_clinic_id uuid, p_agenda_id uuid, p_date date, p_timezone text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with windows as (
    select tstzrange((p_date + w.start_time) at time zone p_timezone, (p_date + w.end_time) at time zone p_timezone) as r
      from public.availability_windows w
     where w.clinic_id = p_clinic_id and w.agenda_id = p_agenda_id and w.is_active
       and w.weekday = extract(dow from p_date)
  ), blocks as (
    select range_agg(tstzrange(b.starts_at, b.ends_at)) as m
      from public.schedule_blocks b
     where b.clinic_id = p_clinic_id and b.agenda_id = p_agenda_id and b.removed_at is null
       and b.starts_at < (p_date + 1)::timestamp at time zone p_timezone
       and b.ends_at > p_date::timestamp at time zone p_timezone
  )
  select exists (select 1 from windows)
     and coalesce((select bool_and(blocks.m @> windows.r) from windows, blocks), false)
$$;

create function app.return_last_date(p_clinic_id uuid, p_agenda_id uuid, p_origin date, p_days integer, p_timezone text)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_date date := p_origin;
  v_counted integer := 0;
  v_limit date := p_origin + p_days + 366;
begin
  if p_days is null then return null; end if;
  -- Sem bloqueio no período, o prazo corrido (o caso comum, sem olhar dia a dia).
  if not exists (
    select 1 from public.schedule_blocks b
     where b.clinic_id = p_clinic_id and b.agenda_id = p_agenda_id and b.removed_at is null
       and b.starts_at < (v_limit + 1)::timestamp at time zone p_timezone
       and b.ends_at > (p_origin + 1)::timestamp at time zone p_timezone
  ) then
    return p_origin + p_days;
  end if;
  while v_counted < p_days loop
    v_date := v_date + 1;
    if v_date > v_limit or not app.is_whole_blocked_day(p_clinic_id, p_agenda_id, v_date, p_timezone) then
      v_counted := v_counted + 1;
    end if;
  end loop;
  return v_date;
end
$$;

revoke execute on function app.is_whole_blocked_day(uuid, uuid, date, text) from public, anon;
revoke execute on function app.return_last_date(uuid, uuid, date, integer, text) from public, anon;
grant execute on function app.is_whole_blocked_day(uuid, uuid, date, text) to authenticated, clinic_service;
grant execute on function app.return_last_date(uuid, uuid, date, integer, text) to authenticated, clinic_service;

create or replace function public.metrics_return_rights(
  p_clinic_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_agenda_ids uuid[],
  p_location_ids uuid[] default null,
  p_now timestamptz default now()
) returns table (
  appointment_id uuid,
  patient_id uuid,
  agenda_id uuid,
  scheduled_at timestamptz,
  last_date date,
  has_return boolean,
  has_upcoming boolean,
  status text
)
language sql
stable
security definer
set search_path = ''
as $$
  with tz as (
    select timezone from public.clinic_settings where clinic_id = p_clinic_id
  ), deadlines as (
    select sa.agenda_id, max(s.return_deadline_days) as days, bool_or(s.return_deadline_days is null) as unlimited
      from public.services s
      join public.service_agendas sa on sa.service_id = s.id
     where s.clinic_id = p_clinic_id and s.category = 'return_visit' and s.is_active
     group by sa.agenda_id
  ), consults as (
    select a.id, a.patient_id, a.agenda_id, a.scheduled_at,
           app.return_last_date(p_clinic_id, a.agenda_id, (a.scheduled_at at time zone tz.timezone)::date, d.days, tz.timezone) as last_date
      from public.appointments a
      join public.services s on s.id = a.service_id and s.category = 'consultation'
      join public.locations l on l.id = a.location_id and l.type <> 'home_visit'
      join deadlines d on d.agenda_id = a.agenda_id and not d.unlimited and d.days is not null
      cross join tz
     where a.clinic_id = p_clinic_id
       and a.status = 'completed'
       and a.agenda_id = any ((select app.metrics_agendas(p_clinic_id, p_agenda_ids))::uuid[])
       and (p_location_ids is null or a.location_id = any (p_location_ids))
       -- Prazo terminando a partir do início do período (os de antes não interessam). Corte largo aqui (os dias
       -- bloqueados esticam o prazo em até um ano); o exato fica no filtro de baixo.
       and (a.scheduled_at at time zone tz.timezone)::date + d.days + 366 >= (p_start at time zone tz.timezone)::date
       and a.scheduled_at < p_end
  )
  select c.id, c.patient_id, c.agenda_id, c.scheduled_at, c.last_date,
         exists (
           select 1 from public.appointments r
            where r.clinic_id = p_clinic_id and r.origin_appointment_id = c.id and r.status <> 'canceled'
              and r.agenda_id = any ((select app.metrics_agendas(p_clinic_id, p_agenda_ids))::uuid[])
         ),
         exists (
           select 1 from public.appointments f
             join public.services fs on fs.id = f.service_id and fs.category in ('consultation', 'return_visit')
            where f.clinic_id = p_clinic_id and f.patient_id = c.patient_id and f.agenda_id = c.agenda_id
              and f.status in ('scheduled', 'confirmed') and f.scheduled_at > p_now
         ),
         case
           when c.last_date < (p_now at time zone tz.timezone)::date
                and c.last_date >= (p_start at time zone tz.timezone)::date
                and c.last_date < (p_end at time zone tz.timezone)::date then 'due'
           when c.last_date >= (p_now at time zone tz.timezone)::date then 'open'
           else 'other'
         end
    from consults c
    cross join tz
   where c.last_date >= (p_start at time zone tz.timezone)::date
     and not exists (
     -- A última Consulta do paciente na agenda (realizada ou ainda pendente).
     select 1 from public.appointments later
       join public.services ls on ls.id = later.service_id and ls.category = 'consultation'
      where later.clinic_id = p_clinic_id and later.patient_id = c.patient_id and later.agenda_id = c.agenda_id
        and later.status in ('completed', 'scheduled', 'confirmed')
        and later.scheduled_at > c.scheduled_at and later.scheduled_at <= p_now
   )
$$;

