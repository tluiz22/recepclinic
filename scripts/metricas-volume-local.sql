-- Volume para medir o tempo das Métricas no ambiente LOCAL (meta do redesign:
-- menos de 1,5 s com um ano de 50 mil atendimentos). Nunca rodar no staging
-- nem na produção: só no banco do `supabase start`, depois do `npm run db:reset`.
--
--   docker exec -i supabase_db_recepclinic psql -U postgres -v ON_ERROR_STOP=1 < scripts/metricas-volume-local.sql
--
-- Na Clínica Exemplo Saúde: 6 mil pacientes; um ano para trás e 30 dias para
-- frente, de segunda a sábado, horários de 10 minutos das 7h às 18h nas 3
-- agendas individuais (cerca de 52 mil atendimentos no ano), com as mesmas
-- proporções do metricas-local.sql: comparecimento, faltas, cancelamentos,
-- remarcações, lembretes com e sem resposta, retornos e mil tentativas do bot.
-- Tudo em blocos (os gatilhos da trilha rodam como numa clínica de verdade).
set statement_timeout = 0;

do $$
declare
  c_id constant uuid := '0a000000-0000-4000-8000-000000000001';
  v_tz text;
begin
  if (select count(*) from public.clinics where id = c_id) = 0 then
    raise exception 'Clínica Exemplo Saúde não encontrada (rode o npm run db:reset antes).';
  end if;
  select timezone into v_tz from public.clinic_settings where clinic_id = c_id;

  -- Pacientes (cada um com o próprio contato).
  create temp table vol_contacts on commit drop as
    select gen_random_uuid() as id, i from generate_series(1, 6000) i;
  insert into public.contacts (id, clinic_id, full_name, phone)
  select id, c_id, 'Contato Volume ' || i, '+55849' || lpad((80000000 + i)::text, 8, '0') from vol_contacts;
  insert into public.patients (clinic_id, contact_id, full_name, birthdate)
  select c_id, id, 'Paciente Volume ' || i, date '1950-01-01' + (i * 7 % 25000) from vol_contacts;

  create temp table vol_patients on commit drop as
    select row_number() over (order by id) as n, id from public.patients where clinic_id = c_id;
  create index on vol_patients (n);
  raise notice '% pacientes', clock_timestamp();

  -- Agendas individuais com os serviços individuais de cada uma (sem retorno) e um local.
  create temp table vol_agendas on commit drop as
    select a.id as agenda_id,
           array_agg(s.id order by s.id) filter (where s.category <> 'return_visit') as services,
           (select l.id from public.locations l
             where l.clinic_id = c_id and l.type <> 'home_visit'
               and exists (select 1 from public.availability_windows w where w.location_id = l.id and w.agenda_id = a.id)
             limit 1) as location_id
      from public.agendas a
      join public.service_agendas sa on sa.agenda_id = a.id
      join public.services s on s.id = sa.service_id and s.is_active and s.scheduling_mode = 'individual'
     where a.clinic_id = c_id and a.kind = 'professional'
     group by a.id;
  update vol_agendas set location_id = (select id from public.locations where clinic_id = c_id and type <> 'home_visit' limit 1)
   where location_id is null;

  -- Atendimentos: entram marcados; a situação final vem depois (o gatilho grava a trilha).
  create temp table vol_appts on commit drop as
    select gen_random_uuid() as id, g.agenda_id, g.location_id,
           g.services[1 + (slot + extract(doy from day)::int) % array_length(g.services, 1)] as service_id,
           ((day + time '07:00') + make_interval(mins => slot * 10)) at time zone v_tz as at,
           random() as r, random() as r2
      from vol_agendas g,
           generate_series((now() at time zone v_tz)::date - 365, (now() at time zone v_tz)::date + 30, interval '1 day') day,
           generate_series(0, 65) slot
     where extract(isodow from day) < 7;
  create index on vol_appts (id);
  alter table vol_appts add column patient_id uuid, add column created timestamptz, add column channel public.action_channel;
  update vol_appts v set
    patient_id = (select id from vol_patients where n = 1 + floor(v.r2 * 5999)::int),
    channel = case when v.r2 < 0.32 then 'whatsapp_bot' else 'admin' end::public.action_channel,
    created = least(v.at - make_interval(days => 1 + floor(v.r * 20)::int, hours => floor(v.r2 * 8)::int), now() - interval '1 hour');

  raise notice '% atendimentos: inserir', clock_timestamp();
  insert into public.appointments (id, clinic_id, patient_id, service_id, agenda_id, location_id, scheduled_at, duration_minutes, booking_channel, created_at)
  select v.id, c_id, v.patient_id, v.service_id, v.agenda_id, v.location_id, v.at, 10, v.channel, v.created
    from vol_appts v
  on conflict do nothing;
  delete from vol_appts v where not exists (select 1 from public.appointments a where a.id = v.id);
  update public.appointment_events e set occurred_at = v.created
    from vol_appts v where e.appointment_id = v.id and e.event_type = 'created';

  raise notice '% lembretes', clock_timestamp();
  -- Lembrete na véspera às 10h (88%) e a resposta.
  insert into public.whatsapp_messages (clinic_id, appointment_id, direction, message_type, status, created_at)
  select c_id, v.id, 'outbound', 'appointment_reminder', case when v.r2 < 0.04 then 'failed' else 'read' end,
         ((v.at at time zone v_tz)::date - 1 + time '10:00') at time zone v_tz
    from vol_appts v
   where v.r < 0.88 and ((v.at at time zone v_tz)::date - 1 + time '10:00') at time zone v_tz < now();
  insert into public.whatsapp_messages (clinic_id, appointment_id, direction, message_type, created_at)
  select c_id, m.appointment_id, 'inbound',
         case when x.r < 0.66 then 'reminder_confirm' when x.r < 0.70 then 'reminder_reschedule' else 'reminder_cancel' end,
         m.created_at + interval '40 minutes'
    from public.whatsapp_messages m, lateral (select random() as r) x
   where m.clinic_id = c_id and m.message_type = 'appointment_reminder'
     and m.appointment_id in (select id from vol_appts) and x.r < 0.74;

  raise notice '% situação final', clock_timestamp();
  -- Situação final.
  update public.appointments a
     set status = 'canceled', canceled_at = least(v.at - interval '1 day', now() - interval '30 minutes'),
         canceled_via = case when v.r2 < 0.6 then 'whatsapp_bot' else 'admin' end::public.action_channel,
         mass_canceled = v.r2 < 0.09
    from vol_appts v
   where a.id = v.id and ((v.at < now() - interval '1 hour' and v.r >= 0.89 and v.r < 0.96) or (v.at >= now() - interval '1 hour' and v.r < 0.06));
  update public.appointments a set status = case when v.r < 0.78 then 'completed' else 'no_show' end::public.appointment_status
    from vol_appts v
   where a.id = v.id and v.at < now() - interval '1 hour' and v.r < 0.89;

  raise notice '% remarcações', clock_timestamp();
  -- Remarcações (pela trilha, só para a contagem).
  insert into public.appointment_events (clinic_id, appointment_id, event_type, channel, details, occurred_at)
  select c_id, v.id, 'rescheduled', case when v.r2 < 0.6 then 'whatsapp_bot' else 'admin' end::public.action_channel, '{}'::jsonb,
         least(v.created + interval '2 days', now() - interval '2 hours')
    from vol_appts v where (v.r * 1000)::int % 11 = 0;

  raise notice '% retornos', clock_timestamp();
  -- Retornos ligados a parte das consultas realizadas (15 dias depois, no fim do dia).
  insert into public.appointments (clinic_id, patient_id, service_id, agenda_id, location_id, scheduled_at, duration_minutes, booking_channel, origin_appointment_id, created_at)
  select a.clinic_id, a.patient_id, r.id, a.agenda_id, a.location_id,
         ((a.scheduled_at at time zone v_tz)::date + 15 + time '18:00' + make_interval(mins => (row_number() over (partition by a.agenda_id, a.scheduled_at::date order by a.id))::int % 20 * 10)) at time zone v_tz,
         10, case when random() < 0.3 then 'whatsapp_bot' else 'admin' end::public.action_channel, a.id, a.scheduled_at + interval '1 day'
    from public.appointments a
    join public.services s on s.id = a.service_id and s.category = 'consultation'
    join public.service_agendas sa on sa.agenda_id = a.agenda_id
    join public.services r on r.id = sa.service_id and r.category = 'return_visit' and r.is_active
   where a.clinic_id = c_id and a.id in (select id from vol_appts) and a.status = 'completed' and random() < 0.3
     and a.scheduled_at + interval '1 day' < now()
  on conflict do nothing;

  raise notice '% bot', clock_timestamp();
  -- Tentativas do bot (mil no ano), do início ao fim ou paradas no meio.
  insert into public.bot_funnel_events (clinic_id, session_id, flow, step, contact_phone, occurred_at)
  select c_id, s.session_id, s.flow, st.step, s.phone, s.t + make_interval(mins => st.k)
    from (select gen_random_uuid() as session_id,
                 (array['booking', 'booking', 'return_booking', 'exam', 'reschedule', 'cancel'])[1 + floor(random() * 6)::int] as flow,
                 '+5584991' || lpad(i::text, 6, '0') as phone,
                 now() - make_interval(days => floor(random() * 364)::int, hours => floor(random() * 10)::int) as t,
                 random() as r
            from generate_series(1, 1000) i) s
    cross join lateral (values ('started', 0, 0.0), ('link_sent', 4, 0.2), ('page_opened', 6, 0.45), ('confirmed', 9, 0.55)) st(step, k, cut)
   where s.r >= st.cut;
end
$$;

analyze public.appointments;
analyze public.appointment_events;
analyze public.whatsapp_messages;
analyze public.bot_funnel_events;

select count(*) filter (where scheduled_at >= now() - interval '1 year' and scheduled_at < now()) as atendimentos_no_ano,
       count(*) as atendimentos_total
  from public.appointments where clinic_id = '0a000000-0000-4000-8000-000000000001';
