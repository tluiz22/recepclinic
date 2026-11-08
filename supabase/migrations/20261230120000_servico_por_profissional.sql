-- ---------------------------------------------------------------------------
-- Serviços por profissional (MS, etapa S2; cliente, 07/nov/2026)
-- ---------------------------------------------------------------------------
-- O serviço passa a ter UM dono: um profissional (professional_id) ou a equipe
-- (is_team, exames da agenda da equipe). Duração, valor, locais, retorno e
-- preparo valem só para ele. Como cada profissional tem uma agenda só (e a
-- equipe, no máximo uma), o dono decide a agenda: service_agendas continua
-- existindo para quem lê, mas o banco o mantém igual ao dono.
--
-- Dados de hoje (decisões S2 e de 07/nov):
--   * serviço em várias agendas: fica com a agenda de mais atendimentos e ganha
--     uma cópia (mesmas características, locais e códigos fiscais) para cada
--     outra; atendimentos, séries, horários próprios, links e vagas da lista de
--     espera daquela agenda passam para a cópia. Sem gatilhos: não é mudança do
--     atendimento (nem updated_at nem trilha);
--   * serviço sem nenhuma agenda: com um profissional ativo só na clínica, vai
--     para ele; com vários, é desativado sem dono (o Administrador reativa
--     escolhendo o dono).
-- O dono não muda depois de escolhido.
--
-- Reversão: drop dos gatilhos e funções criados aqui; alter table
-- public.services drop column professional_id, drop column is_team. As cópias
-- ficam (são serviços normais).

alter table public.services
  add column professional_id uuid,
  add column is_team boolean not null default false,
  add constraint services_professional_fk foreign key (clinic_id, professional_id)
    references public.professionals (clinic_id, id),
  add constraint services_one_owner check (not (is_team and professional_id is not null));

create index services_professional_idx on public.services (clinic_id, professional_id);

comment on column public.services.professional_id is 'Dono do serviço (MS, 07/nov/2026). Com is_team = false e sem profissional: serviço sem dono, fora de qualquer agenda.';
comment on column public.services.is_team is 'Serviço da equipe (MS, 07/nov/2026): exame da agenda da equipe, sem profissional.';

-- ---------------------------------------------------------------------------
-- Dados de hoje
-- ---------------------------------------------------------------------------
alter table public.services disable trigger user;
alter table public.service_agendas disable trigger user;
alter table public.service_locations disable trigger user;
alter table public.service_fiscal_codes disable trigger user;
alter table public.appointments disable trigger user;
alter table public.appointment_series disable trigger user;
alter table public.availability_windows disable trigger user;
alter table public.booking_links disable trigger user;
alter table public.waitlist_openings disable trigger user;

do $$
declare
  v_service record;
  v_link record;
  v_first boolean;
  v_copy uuid;
  v_only_professional uuid;
begin
  for v_service in select * from public.services order by clinic_id, name loop
    v_first := true;
    -- A agenda que fica com o serviço original: a de mais atendimentos.
    for v_link in
      select sa.agenda_id, a.kind, a.professional_id
        from public.service_agendas sa
        join public.agendas a on a.id = sa.agenda_id
       where sa.service_id = v_service.id
       order by (select count(*) from public.appointments ap
                  where ap.service_id = v_service.id and ap.agenda_id = sa.agenda_id) desc,
                a.created_at, a.id
    loop
      if v_first then
        update public.services
           set professional_id = v_link.professional_id, is_team = (v_link.kind = 'resource')
         where id = v_service.id;
        v_first := false;
        continue;
      end if;

      insert into public.services (
        clinic_id, name, category, duration_minutes, price_cents, return_deadline_days,
        preparation_instructions, scheduling_mode, is_active,
        preparation_file_path, preparation_file_name, preparation_file_type, preparation_file_size,
        professional_id, is_team, created_at, updated_at)
      values (
        v_service.clinic_id, v_service.name, v_service.category, v_service.duration_minutes,
        v_service.price_cents, v_service.return_deadline_days, v_service.preparation_instructions,
        v_service.scheduling_mode, v_service.is_active,
        v_service.preparation_file_path, v_service.preparation_file_name,
        v_service.preparation_file_type, v_service.preparation_file_size,
        v_link.professional_id, v_link.kind = 'resource', v_service.created_at, now())
      returning id into v_copy;

      insert into public.service_locations (clinic_id, service_id, location_id, price_cents)
        select clinic_id, v_copy, location_id, price_cents
          from public.service_locations where service_id = v_service.id;
      insert into public.service_fiscal_codes
        select (jsonb_populate_record(null::public.service_fiscal_codes,
                 to_jsonb(f) || jsonb_build_object('service_id', v_copy))).*
          from public.service_fiscal_codes f where f.service_id = v_service.id;

      delete from public.service_agendas where service_id = v_service.id and agenda_id = v_link.agenda_id;
      insert into public.service_agendas (clinic_id, service_id, agenda_id)
        values (v_service.clinic_id, v_copy, v_link.agenda_id);

      update public.appointments set service_id = v_copy
       where service_id = v_service.id and agenda_id = v_link.agenda_id;
      update public.appointment_series set service_id = v_copy
       where service_id = v_service.id and agenda_id = v_link.agenda_id;
      update public.availability_windows set service_id = v_copy
       where service_id = v_service.id and agenda_id = v_link.agenda_id;
      update public.booking_links set service_id = v_copy
       where service_id = v_service.id and agenda_id = v_link.agenda_id;
      update public.waitlist_openings set service_id = v_copy
       where service_id = v_service.id and agenda_id = v_link.agenda_id;
    end loop;

    if v_first then
      -- Sem nenhuma agenda.
      select case when count(*) = 1 then (array_agg(id))[1] end into v_only_professional
        from public.professionals
       where clinic_id = v_service.clinic_id and is_active;
      if v_only_professional is not null then
        update public.services set professional_id = v_only_professional where id = v_service.id;
        insert into public.service_agendas (clinic_id, service_id, agenda_id)
          select v_service.clinic_id, v_service.id, a.id
            from public.agendas a
           where a.clinic_id = v_service.clinic_id and a.professional_id = v_only_professional;
      else
        update public.services set is_active = false where id = v_service.id;
      end if;
    end if;
  end loop;
end
$$;

alter table public.services enable trigger user;
alter table public.service_agendas enable trigger user;
alter table public.service_locations enable trigger user;
alter table public.service_fiscal_codes enable trigger user;
alter table public.appointments enable trigger user;
alter table public.appointment_series enable trigger user;
alter table public.availability_windows enable trigger user;
alter table public.booking_links enable trigger user;
alter table public.waitlist_openings enable trigger user;

-- ---------------------------------------------------------------------------
-- Regras daqui em diante
-- ---------------------------------------------------------------------------

-- Dono fixo: só o serviço sem dono ganha um (uma vez).
create function app.guard_service_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (old.professional_id is not null or old.is_team)
     and (new.professional_id is distinct from old.professional_id or new.is_team is distinct from old.is_team) then
    raise exception 'O profissional do serviço não muda depois de escolhido. Para outro profissional, cadastre um serviço novo.'
      using errcode = 'P0001', hint = 'service_owner_fixed';
  end if;
  if new.is_active and new.professional_id is null and not new.is_team then
    raise exception 'Escolha o profissional do serviço antes de ativá-lo.'
      using errcode = 'P0001', hint = 'service_owner_required';
  end if;
  return new;
end
$$;

create trigger services_guard_owner
  before update of professional_id, is_team, is_active on public.services
  for each row execute function app.guard_service_owner();

-- Serviço novo da equipe só do tipo exame (a agenda da equipe só atende exame).
alter table public.services add constraint services_team_exam_only check (not is_team or category = 'exam');

-- O serviço só é atendido na agenda do dono. Serviço sem dono ganha o dono da
-- agenda (compatível com quem ainda grava o serviço e depois a agenda).
create function app.check_service_agenda_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agenda record;
  v_service record;
begin
  select clinic_id, kind, professional_id into v_agenda from public.agendas where id = new.agenda_id;
  select clinic_id, professional_id, is_team into v_service from public.services where id = new.service_id;
  -- Outra clínica (ou registro inexistente): a chave composta recusa.
  if v_agenda.clinic_id is distinct from new.clinic_id or v_service.clinic_id is distinct from new.clinic_id then
    return new;
  end if;
  if v_service.professional_id is null and not v_service.is_team then
    if exists (select 1 from public.service_agendas where service_id = new.service_id) then
      raise exception 'O serviço é de um profissional só.' using errcode = 'P0001', hint = 'service_one_owner';
    end if;
    update public.services
       set professional_id = v_agenda.professional_id, is_team = (v_agenda.kind = 'resource')
     where id = new.service_id;
  elsif v_service.is_team is distinct from (v_agenda.kind = 'resource')
     or v_service.professional_id is distinct from v_agenda.professional_id then
    raise exception 'O serviço só é atendido na agenda do profissional dele.'
      using errcode = 'P0001', hint = 'service_agenda_owner';
  end if;
  return new;
end
$$;

create trigger service_agendas_check_owner
  before insert or update on public.service_agendas
  for each row execute function app.check_service_agenda_owner();

-- Serviço com dono entra na agenda do dono; agenda nova recebe os serviços do dono.
create function app.link_service_to_owner_agenda()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Dentro do gatilho da service_agendas (o vínculo que deu o dono já está sendo gravado).
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if new.professional_id is null and not new.is_team then
    return new;
  end if;
  if tg_op = 'UPDATE' and (old.professional_id is not null or old.is_team) then
    return new;
  end if;
  insert into public.service_agendas (clinic_id, service_id, agenda_id)
    select new.clinic_id, new.id, a.id
      from public.agendas a
     where a.clinic_id = new.clinic_id
       and ((new.is_team and a.kind = 'resource') or (not new.is_team and a.professional_id = new.professional_id))
       and not exists (select 1 from public.service_agendas sa where sa.service_id = new.id and sa.agenda_id = a.id);
  return new;
end
$$;

create trigger services_link_owner_agenda
  after insert or update of professional_id, is_team on public.services
  for each row execute function app.link_service_to_owner_agenda();

create function app.link_owner_services_to_agenda()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.service_agendas (clinic_id, service_id, agenda_id)
    select new.clinic_id, s.id, new.id
      from public.services s
     where s.clinic_id = new.clinic_id
       and ((new.kind = 'resource' and s.is_team) or (new.kind = 'professional' and s.professional_id = new.professional_id))
       and not exists (select 1 from public.service_agendas sa where sa.service_id = s.id and sa.agenda_id = new.id);
  return new;
end
$$;

create trigger agendas_link_owner_services
  after insert on public.agendas
  for each row execute function app.link_owner_services_to_agenda();

-- ---------------------------------------------------------------------------
-- Migrar agenda com serviços por profissional (cliente, 07/nov/2026)
-- ---------------------------------------------------------------------------
-- O serviço da agenda antiga passa para o serviço do dono da nova com o mesmo
-- nome e tipo; sem ele, a migração cria a cópia (mesmas características,
-- locais e códigos fiscais), como no S2. A agenda da equipe só recebe exames.
-- Na resposta, por serviço: target_attends (pode migrar), target_service (o
-- nome do serviço que recebe) e creates_copy (a cópia será criada).

create function app.owner_service_match(p_service uuid, p_agenda uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id
    from public.services s
    join public.agendas a on a.id = p_agenda
    join public.services t on t.clinic_id = s.clinic_id
     and t.category = s.category
     and ((a.kind = 'resource' and t.is_team) or (a.kind = 'professional' and t.professional_id = a.professional_id))
   where s.id = p_service
     and (t.id = s.id or app.normalize_search_text(t.name) = app.normalize_search_text(s.name))
   order by (t.id = s.id) desc, t.is_active desc, t.created_at
   limit 1
$$;

create or replace function public.migrate_agenda(p_from uuid, p_to uuid, p_apply boolean default false, p_services uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_to_clinic uuid;
  v_from_name text;
  v_to_name text;
  v_to_kind public.agenda_kind;
  v_to_professional uuid;
  v_actor uuid := case when (select auth.role()) = 'authenticated' then (select auth.uid()) end;
  v_windows integer := 0;
  v_series integer := 0;
  v_moved integer := 0;
  v_conflicts jsonb := '[]'::jsonb;
  v_services jsonb;
  v_missing text[];
  v_map jsonb := '{}'::jsonb;
  v_target uuid;
  v_source record;
  r record;
begin
  select clinic_id, name into v_clinic, v_from_name from public.agendas where id = p_from;
  select clinic_id, name, kind, professional_id into v_to_clinic, v_to_name, v_to_kind, v_to_professional
    from public.agendas where id = p_to and is_active;
  if v_clinic is null or v_clinic is distinct from v_to_clinic or p_from = p_to
     or not app.has_clinic_role(v_clinic, array['admin']::public.clinic_role[]) then
    raise exception 'Sem acesso a estas agendas.' using errcode = '42501';
  end if;

  -- Os serviços da agenda antiga com horário, atendimento futuro ou série, e o que recebe cada um na nova.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name,
           'windows', (select count(*) from public.availability_windows w where w.agenda_id = p_from and w.service_id = s.id),
           'appointments', (select count(*) from public.appointments a
                              where a.agenda_id = p_from and a.service_id = s.id and a.scheduled_at >= now() and a.status in ('scheduled', 'confirmed')),
           'series', (select count(*) from public.appointment_series t where t.agenda_id = p_from and t.service_id = s.id and t.ended_at is null),
           'target_attends', v_to_kind = 'professional' or s.category = 'exam',
           'target_service', (select t.name from public.services t where t.id = app.owner_service_match(s.id, p_to)),
           'creates_copy', (v_to_kind = 'professional' or s.category = 'exam') and app.owner_service_match(s.id, p_to) is null
         ) order by s.name), '[]'::jsonb)
    into v_services
    from public.services s
    where s.id in (
      select service_id from public.availability_windows where agenda_id = p_from and service_id is not null
      union
      select service_id from public.appointments where agenda_id = p_from and scheduled_at >= now() and status in ('scheduled', 'confirmed')
      union
      select service_id from public.appointment_series where agenda_id = p_from and ended_at is null
    );

  -- A agenda da equipe só atende exames.
  select array_agg(distinct s.name order by s.name) into v_missing
    from public.services s
    where (p_services is null or s.id = any (p_services))
      and s.id in (select (e->>'id')::uuid from jsonb_array_elements(v_services) e)
      and v_to_kind = 'resource' and s.category <> 'exam';
  if v_missing is not null then
    raise exception 'service_not_in_agenda: %', array_to_string(v_missing, ', ') using errcode = 'P0001';
  end if;

  select count(*) into v_windows from public.availability_windows
    where agenda_id = p_from and (p_services is null or service_id = any (p_services));
  select count(*) into v_series from public.appointment_series
    where agenda_id = p_from and ended_at is null and (p_services is null or service_id = any (p_services));

  -- Serviço de destino de cada um (cria a cópia que faltar).
  if p_apply then
    for v_source in
      select s.* from public.services s
       where s.id in (select (e->>'id')::uuid from jsonb_array_elements(v_services) e)
         and (p_services is null or s.id = any (p_services))
    loop
      v_target := app.owner_service_match(v_source.id, p_to);
      if v_target is null then
        insert into public.services (
          clinic_id, name, category, duration_minutes, price_cents, return_deadline_days,
          preparation_instructions, scheduling_mode, is_active,
          preparation_file_path, preparation_file_name, preparation_file_type, preparation_file_size,
          professional_id, is_team)
        values (
          v_source.clinic_id, v_source.name, v_source.category, v_source.duration_minutes,
          v_source.price_cents, v_source.return_deadline_days, v_source.preparation_instructions,
          v_source.scheduling_mode, true,
          v_source.preparation_file_path, v_source.preparation_file_name,
          v_source.preparation_file_type, v_source.preparation_file_size,
          v_to_professional, v_to_kind = 'resource')
        returning id into v_target;
        insert into public.service_locations (clinic_id, service_id, location_id, price_cents)
          select clinic_id, v_target, location_id, price_cents
            from public.service_locations where service_id = v_source.id;
        insert into public.service_fiscal_codes
          select (jsonb_populate_record(null::public.service_fiscal_codes,
                   to_jsonb(f) || jsonb_build_object('service_id', v_target))).*
            from public.service_fiscal_codes f where f.service_id = v_source.id;
      end if;
      v_map := v_map || jsonb_build_object(v_source.id::text, v_target);
    end loop;
  end if;

  for r in
    select a.id, a.service_id, a.scheduled_at, a.is_exam, a.duration_minutes, p.full_name as patient_name
      from public.appointments a
      join public.patients p on p.id = a.patient_id
      where a.agenda_id = p_from and a.scheduled_at >= now() and a.status in ('scheduled', 'confirmed')
        and (p_services is null or a.service_id = any (p_services))
      order by a.scheduled_at
      for update of a
  loop
    if not r.is_exam and exists (
      select 1 from public.appointments o
        where o.agenda_id = p_to and not o.is_exam and o.status in ('scheduled', 'confirmed')
          and app.appointment_period(o.scheduled_at, o.duration_minutes) && app.appointment_period(r.scheduled_at, r.duration_minutes)
    ) then
      v_conflicts := v_conflicts || jsonb_build_object('id', r.id, 'scheduled_at', r.scheduled_at, 'patient', r.patient_name);
      continue;
    end if;
    v_moved := v_moved + 1;
    if p_apply then
      -- A trilha ("Alterado: Agenda: antiga → nova") vai pela coluna trail_context, que o gatilho de antes do
      -- update lê e zera (20261022120000_metricas_trilha.sql).
      update public.appointments
        set agenda_id = p_to,
            service_id = (v_map->>r.service_id::text)::uuid,
            trail_context = jsonb_build_object(
              'channel', 'admin', 'event', 'changed', 'actor', v_actor,
              'details', jsonb_build_object('changes', jsonb_build_array(jsonb_build_object('label', 'Agenda', 'from', v_from_name, 'to', v_to_name)))
            )
        where id = r.id;
    end if;
  end loop;

  if p_apply then
    update public.availability_windows
       set agenda_id = p_to, service_id = case when service_id is null then null else (v_map->>service_id::text)::uuid end
      where agenda_id = p_from and (p_services is null or service_id = any (p_services));
    update public.appointment_series
       set agenda_id = p_to, service_id = (v_map->>service_id::text)::uuid
      where agenda_id = p_from and ended_at is null and (p_services is null or service_id = any (p_services));
  end if;

  return jsonb_build_object(
    'windows', v_windows, 'series', v_series, 'appointments', v_moved, 'conflicts', v_conflicts,
    'services', v_services, 'applied', p_apply
  );
end
$$;
