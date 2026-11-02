-- Migrar de agenda por serviço (cliente, 02/nov/2026): a agenda antiga pode ter horários e atendimentos de serviços
-- que a nova não atende (ex.: Consulta e Retorno da Dra. na migração para a agenda Exames). A pessoa escolhe os
-- serviços que migram; o resto fica. `p_services` null = todos (e todo horário, inclusive o de "todos os serviços");
-- lista = só o horário e o atendimento desses serviços (o horário sem serviço e o histórico ficam); lista vazia =
-- nada migra e a resposta só traz os serviços (para a tela montar as caixas).
drop function public.migrate_agenda(uuid, uuid, boolean);

create function public.migrate_agenda(p_from uuid, p_to uuid, p_apply boolean default false, p_services uuid[] default null)
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
  v_actor uuid := case when (select auth.role()) = 'authenticated' then (select auth.uid()) end;
  v_windows integer := 0;
  v_series integer := 0;
  v_moved integer := 0;
  v_conflicts jsonb := '[]'::jsonb;
  v_services jsonb;
  v_missing text[];
  r record;
begin
  select clinic_id, name into v_clinic, v_from_name from public.agendas where id = p_from;
  select clinic_id, name into v_to_clinic, v_to_name from public.agendas where id = p_to and is_active;
  if v_clinic is null or v_clinic is distinct from v_to_clinic or p_from = p_to
     or not app.has_clinic_role(v_clinic, array['admin']::public.clinic_role[]) then
    raise exception 'Sem acesso a estas agendas.' using errcode = '42501';
  end if;

  -- Os serviços da agenda antiga com horário, atendimento futuro ou série, e se a nova os atende.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name,
           'windows', (select count(*) from public.availability_windows w where w.agenda_id = p_from and w.service_id = s.id),
           'appointments', (select count(*) from public.appointments a
                              where a.agenda_id = p_from and a.service_id = s.id and a.scheduled_at >= now() and a.status in ('scheduled', 'confirmed')),
           'series', (select count(*) from public.appointment_series t where t.agenda_id = p_from and t.service_id = s.id and t.ended_at is null),
           'target_attends', exists (select 1 from public.service_agendas sa where sa.service_id = s.id and sa.agenda_id = p_to)
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

  -- Todo serviço que vai migrar precisa ser atendido na nova agenda.
  select array_agg(distinct s.name order by s.name) into v_missing
    from public.services s
    where (p_services is null or s.id = any (p_services))
      and s.id in (select (e->>'id')::uuid from jsonb_array_elements(v_services) e)
      and not exists (select 1 from public.service_agendas sa where sa.service_id = s.id and sa.agenda_id = p_to);
  if v_missing is not null then
    raise exception 'service_not_in_agenda: %', array_to_string(v_missing, ', ') using errcode = 'P0001';
  end if;

  select count(*) into v_windows from public.availability_windows
    where agenda_id = p_from and (p_services is null or service_id = any (p_services));
  select count(*) into v_series from public.appointment_series
    where agenda_id = p_from and ended_at is null and (p_services is null or service_id = any (p_services));

  for r in
    select a.id, a.scheduled_at, a.is_exam, a.duration_minutes, p.full_name as patient_name
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
            trail_context = jsonb_build_object(
              'channel', 'admin', 'event', 'changed', 'actor', v_actor,
              'details', jsonb_build_object('changes', jsonb_build_array(jsonb_build_object('label', 'Agenda', 'from', v_from_name, 'to', v_to_name)))
            )
        where id = r.id;
    end if;
  end loop;

  if p_apply then
    update public.availability_windows set agenda_id = p_to
      where agenda_id = p_from and (p_services is null or service_id = any (p_services));
    update public.appointment_series set agenda_id = p_to
      where agenda_id = p_from and ended_at is null and (p_services is null or service_id = any (p_services));
  end if;

  return jsonb_build_object(
    'windows', v_windows, 'series', v_series, 'appointments', v_moved, 'conflicts', v_conflicts,
    'services', v_services, 'applied', p_apply
  );
end
$$;

revoke execute on function public.migrate_agenda(uuid, uuid, boolean, uuid[]) from public, anon;
grant execute on function public.migrate_agenda(uuid, uuid, boolean, uuid[]) to authenticated;
