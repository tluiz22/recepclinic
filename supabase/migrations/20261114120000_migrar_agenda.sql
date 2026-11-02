-- Migrar de agenda (cliente, 02/nov/2026): ao trocar a agenda de um serviço (ex.: a nova agenda de exames), os
-- horários de atendimento e os atendimentos futuros passam da agenda antiga para a nova. O histórico (atendimentos
-- que já passaram ou foram cancelados) fica na antiga. Só o Administrador.
--
-- p_apply = false só conta (prévia da confirmação); true migra. Exame não conflita com nada (exame em paralelo);
-- nos demais, o atendimento que cairia sobre outro já marcado na nova agenda NÃO migra (a trava de horário por
-- agenda não permite dois) e volta na lista de conflitos, para a recepção resolver.
-- Desfazer: migrar de volta (mesma função, agendas trocadas); o Histórico de cada atendimento guarda a troca.
create or replace function public.migrate_agenda(p_from uuid, p_to uuid, p_apply boolean default false)
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
  v_missing text[];
  r record;
begin
  select clinic_id, name into v_clinic, v_from_name from public.agendas where id = p_from;
  select clinic_id, name into v_to_clinic, v_to_name from public.agendas where id = p_to and is_active;
  if v_clinic is null or v_clinic is distinct from v_to_clinic or p_from = p_to
     or not app.has_clinic_role(v_clinic, array['admin']::public.clinic_role[]) then
    raise exception 'Sem acesso a estas agendas.' using errcode = '42501';
  end if;

  -- Todo serviço que tem horário ou atendimento futuro na antiga precisa ser atendido na nova.
  select array_agg(distinct s.name order by s.name) into v_missing
    from public.services s
    where s.id in (
        select service_id from public.availability_windows where agenda_id = p_from and service_id is not null
        union
        select service_id from public.appointments
          where agenda_id = p_from and scheduled_at >= now() and status in ('scheduled', 'confirmed')
        union
        select service_id from public.appointment_series where agenda_id = p_from and ended_at is null
      )
      and not exists (select 1 from public.service_agendas sa where sa.service_id = s.id and sa.agenda_id = p_to);
  if v_missing is not null then
    raise exception 'service_not_in_agenda: %', array_to_string(v_missing, ', ') using errcode = 'P0001';
  end if;

  select count(*) into v_windows from public.availability_windows where agenda_id = p_from;
  select count(*) into v_series from public.appointment_series where agenda_id = p_from and ended_at is null;

  for r in
    select a.id, a.scheduled_at, a.is_exam, a.duration_minutes, p.full_name as patient_name
      from public.appointments a
      join public.patients p on p.id = a.patient_id
      where a.agenda_id = p_from and a.scheduled_at >= now() and a.status in ('scheduled', 'confirmed')
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
    update public.availability_windows set agenda_id = p_to where agenda_id = p_from;
    update public.appointment_series set agenda_id = p_to where agenda_id = p_from and ended_at is null;
  end if;

  return jsonb_build_object('windows', v_windows, 'series', v_series, 'appointments', v_moved, 'conflicts', v_conflicts, 'applied', p_apply);
end
$$;

revoke execute on function public.migrate_agenda(uuid, uuid, boolean) from public, anon;
grant execute on function public.migrate_agenda(uuid, uuid, boolean) to authenticated;
