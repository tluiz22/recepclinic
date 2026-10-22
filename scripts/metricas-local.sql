-- Dados fictícios para ver as Métricas no ambiente LOCAL (redesign de
-- 22/out/2026). Nunca rodar no staging nem na produção: só no banco do
-- `supabase start`, depois do `npm run db:reset`.
--
--   docker exec -i supabase_db_recepclinic psql -U postgres -v ON_ERROR_STOP=1 < scripts/metricas-local.sql
--
-- Na Clínica Exemplo Saúde: 60 dias para trás e 20 para frente, 6 horários
-- por dia útil nas agendas individuais, com comparecimento, faltas,
-- cancelamentos, remarcações, lembretes com e sem resposta e 160 tentativas do
-- bot em todos os desfechos. Os números são aleatórios, mas com proporções
-- parecidas com as de uma clínica de verdade.
do $$
declare
  c_id constant uuid := '0a000000-0000-4000-8000-000000000001';
  v_tz text;
  v_agenda record;
  v_day date;
  v_slot int;
  v_at timestamptz;
  v_id uuid;
  v_patient uuid;
  v_service record;
  v_location uuid;
  v_r float;
  v_status public.appointment_status;
  v_channel public.action_channel;
  v_created timestamptz;
  v_patients uuid[];
  v_phone text;
  v_session uuid;
  v_flow text;
  v_t timestamptz;
  v_i int;
begin
  if (select count(*) from public.clinics where id = c_id) = 0 then
    raise exception 'Clínica Exemplo Saúde não encontrada (rode o npm run db:reset antes).';
  end if;
  select timezone into v_tz from public.clinic_settings where clinic_id = c_id;
  select array_agg(id) into v_patients from public.patients where clinic_id = c_id;

  for v_agenda in select a.id from public.agendas a where a.clinic_id = c_id and a.kind = 'professional' loop
    select l.id into v_location
      from public.locations l
      join public.availability_windows w on w.location_id = l.id and w.agenda_id = v_agenda.id
     where l.clinic_id = c_id limit 1;
    if v_location is null then
      select id into v_location from public.locations where clinic_id = c_id and type <> 'home_visit' limit 1;
    end if;

    for v_day in select generate_series((now() at time zone v_tz)::date - 60, (now() at time zone v_tz)::date + 20, interval '1 day')::date loop
      continue when extract(isodow from v_day) > 5;
      for v_slot in 0..5 loop
        v_at := ((v_day + time '13:00') + make_interval(mins => v_slot * 60)) at time zone v_tz;
        select s.id, s.duration_minutes, s.category into v_service
          from public.services s join public.service_agendas sa on sa.service_id = s.id
         where sa.agenda_id = v_agenda.id and s.is_active and s.scheduling_mode = 'individual'
         order by random() limit 1;
        v_patient := v_patients[1 + floor(random() * array_length(v_patients, 1))::int];
        v_channel := case when random() < 0.32 then 'whatsapp_bot' else 'admin' end;
        v_created := least(v_at - make_interval(days => 1 + floor(random() * 20)::int, hours => floor(random() * 8)::int), now() - interval '1 hour');
        v_r := random();
        v_status := case
          when v_at < now() - interval '1 hour' then
            case when v_r < 0.78 then 'completed' when v_r < 0.89 then 'no_show' when v_r < 0.96 then 'canceled' else 'scheduled' end
          else case when v_r < 0.06 then 'canceled' else 'scheduled' end
        end;
        v_id := gen_random_uuid();
        insert into public.appointments (id, clinic_id, patient_id, service_id, agenda_id, location_id, scheduled_at, duration_minutes, booking_channel, created_at)
        values (v_id, c_id, v_patient, v_service.id, v_agenda.id, v_location, v_at, v_service.duration_minutes, v_channel, v_created)
        on conflict do nothing;
        -- Horário já ocupado (atendimento da seed): pula.
        continue when not exists (select 1 from public.appointments where id = v_id);
        update public.appointment_events set occurred_at = v_created where appointment_id = v_id and event_type = 'created';

        -- Lembrete na véspera, às 10h, quase sempre; a resposta depois dele.
        if random() < 0.88 and ((v_day - 1) + time '10:00') at time zone v_tz < now() then
          v_t := ((v_day - 1) + time '10:00') at time zone v_tz;
          insert into public.whatsapp_messages (clinic_id, appointment_id, direction, message_type, status, created_at)
          values (c_id, v_id, 'outbound', 'appointment_reminder', case when random() < 0.04 then 'failed' else 'read' end, v_t);
          v_r := random();
          if v_r < 0.66 then
            insert into public.whatsapp_messages (clinic_id, appointment_id, direction, message_type, created_at) values (c_id, v_id, 'inbound', 'reminder_confirm', v_t + interval '40 minutes');
          elsif v_r < 0.70 then
            insert into public.whatsapp_messages (clinic_id, appointment_id, direction, message_type, created_at) values (c_id, v_id, 'inbound', 'reminder_reschedule', v_t + interval '50 minutes');
          elsif v_r < 0.74 then
            insert into public.whatsapp_messages (clinic_id, appointment_id, direction, message_type, created_at) values (c_id, v_id, 'inbound', 'reminder_cancel', v_t + interval '55 minutes');
          end if;
        end if;

        -- Situação final (o gatilho grava a trilha; as datas vão para o passado).
        if v_status = 'canceled' then
          update public.appointments
             set status = 'canceled', canceled_at = least(v_at - interval '1 day', now() - interval '30 minutes'),
                 canceled_via = case when random() < 0.6 then 'whatsapp_bot' else 'admin' end::public.action_channel,
                 mass_canceled = random() < 0.15
           where id = v_id;
        elsif v_status in ('completed', 'no_show') then
          update public.appointments set status = v_status where id = v_id;
        end if;

        -- Algumas remarcações (pela trilha, sem mexer na data: só para a contagem).
        if random() < 0.09 then
          insert into public.appointment_events (clinic_id, appointment_id, event_type, channel, details, occurred_at)
          values (c_id, v_id, 'rescheduled', case when random() < 0.6 then 'whatsapp_bot' else 'admin' end, '{}'::jsonb, least(v_created + interval '2 days', now() - interval '2 hours'));
        end if;
      end loop;
    end loop;
  end loop;

  -- Retornos ligados a parte das consultas realizadas da pediatra.
  insert into public.appointments (clinic_id, patient_id, service_id, agenda_id, location_id, scheduled_at, duration_minutes, booking_channel, origin_appointment_id, created_at)
  select a.clinic_id, a.patient_id, r.id, a.agenda_id, a.location_id, a.scheduled_at + interval '14 days 30 minutes', r.duration_minutes,
         case when random() < 0.3 then 'whatsapp_bot' else 'admin' end::public.action_channel, a.id, a.scheduled_at + interval '1 day'
    from public.appointments a
    join public.services s on s.id = a.service_id and s.category = 'consultation'
    join public.service_agendas sa on sa.agenda_id = a.agenda_id
    join public.services r on r.id = sa.service_id and r.category = 'return_visit'
   where a.clinic_id = c_id and a.status = 'completed' and random() < 0.45
     and a.scheduled_at + interval '1 day' < now()
  on conflict do nothing;

  -- Tentativas do bot (160), em todos os desfechos.
  for v_i in 1..160 loop
    v_session := gen_random_uuid();
    v_phone := '+5584990' || lpad((100000 + v_i)::text, 6, '0');
    v_t := now() - make_interval(days => floor(random() * 58)::int, hours => floor(random() * 10)::int);
    v_r := random();
    v_flow := case when v_r < 0.55 then 'booking' when v_r < 0.70 then 'return_booking' when v_r < 0.80 then 'exam' when v_r < 0.90 then 'reschedule' else 'cancel' end;
    insert into public.bot_funnel_events (clinic_id, session_id, flow, step, contact_phone, metadata, occurred_at)
    values (c_id, v_session, v_flow, 'started', v_phone, case when v_flow in ('reschedule', 'cancel') and random() < 0.5 then '{"source": "reminder"}' else '{}' end::jsonb, v_t);
    v_r := random();
    if v_flow in ('booking', 'return_booking', 'exam') then
      if v_r < 0.08 then
        insert into public.bot_funnel_events (clinic_id, session_id, flow, step, contact_phone, metadata, occurred_at) values
          (c_id, v_session, v_flow, 'blocked', v_phone, jsonb_build_object('reason', (array['already_scheduled', 'return_no_recent_consultation', 'consultation_age_limit', 'return_deadline_passed'])[1 + floor(random() * 4)::int]), v_t + interval '2 minutes');
        continue;
      end if;
      insert into public.bot_funnel_events (clinic_id, session_id, flow, step, contact_phone, occurred_at) values
        (c_id, v_session, v_flow, case when v_flow = 'return_booking' then 'RETURN_SELECT' else 'BOOK_AGENDA' end, v_phone, v_t + interval '1 minute');
      if v_r < 0.16 then continue; end if;
      insert into public.bot_funnel_events (clinic_id, session_id, flow, step, contact_phone, occurred_at) values
        (c_id, v_session, v_flow, 'patient_identified', v_phone, v_t + interval '3 minutes');
      if v_r < 0.24 then continue; end if;
      if v_r < 0.27 then
        insert into public.bot_funnel_events (clinic_id, session_id, flow, step, contact_phone, metadata, occurred_at) values
          (c_id, v_session, v_flow, 'error', v_phone, '{"reason": "link_error"}', v_t + interval '4 minutes');
        continue;
      end if;
      insert into public.bot_funnel_events (clinic_id, session_id, flow, step, contact_phone, occurred_at) values
        (c_id, v_session, v_flow, 'link_sent', v_phone, v_t + interval '4 minutes');
      if v_r < 0.45 then continue; end if;
      insert into public.bot_funnel_events (clinic_id, session_id, flow, step, source, contact_phone, occurred_at) values
        (c_id, v_session, v_flow, 'page_opened', 'web', v_phone, v_t + interval '6 minutes');
      if v_r < 0.52 then
        insert into public.bot_funnel_events (clinic_id, session_id, flow, step, source, contact_phone, metadata, occurred_at) values
          (c_id, v_session, v_flow, 'confirm_failed', 'web', v_phone, '{"reason": "slot_taken"}', v_t + interval '8 minutes');
        continue;
      end if;
      select id into v_id from public.appointments where clinic_id = c_id and booking_channel = 'whatsapp_bot' order by random() limit 1;
      insert into public.bot_funnel_events (clinic_id, session_id, flow, step, source, contact_phone, metadata, appointment_id, occurred_at) values
        (c_id, v_session, v_flow, 'confirmed', 'web', v_phone, jsonb_build_object('appointment_id', v_id), v_id, v_t + interval '9 minutes');
    elsif v_flow = 'reschedule' then
      if v_r < 0.2 then continue; end if;
      insert into public.bot_funnel_events (clinic_id, session_id, flow, step, contact_phone, occurred_at) values
        (c_id, v_session, v_flow, 'link_sent', v_phone, v_t + interval '2 minutes');
      if v_r < 0.4 then continue; end if;
      insert into public.bot_funnel_events (clinic_id, session_id, flow, step, source, contact_phone, occurred_at) values
        (c_id, v_session, v_flow, 'page_opened', 'web', v_phone, v_t + interval '4 minutes'),
        (c_id, v_session, v_flow, 'confirmed', 'web', v_phone, v_t + interval '6 minutes');
    else
      if v_r < 0.1 then
        insert into public.bot_funnel_events (clinic_id, session_id, flow, step, contact_phone, occurred_at) values
          (c_id, v_session, v_flow, 'declined', v_phone, v_t + interval '2 minutes');
        continue;
      end if;
      insert into public.bot_funnel_events (clinic_id, session_id, flow, step, contact_phone, occurred_at) values
        (c_id, v_session, v_flow, 'CANCEL_CONFIRM', v_phone, v_t + interval '1 minute'),
        (c_id, v_session, v_flow, 'canceled', v_phone, v_t + interval '2 minutes');
    end if;
  end loop;

  -- Recepção no WhatsApp: pedidos pelo menu e a recepção que assumiu.
  for v_i in 1..24 loop
    v_t := now() - make_interval(days => floor(random() * 58)::int);
    v_flow := case when random() < 0.45 then 'requested' else 'agent_took_over' end;
    insert into public.bot_funnel_events (clinic_id, session_id, flow, step, contact_phone, metadata, occurred_at)
    values (c_id, gen_random_uuid(), 'handoff', v_flow, '+5584990' || lpad((100000 + v_i)::text, 6, '0'),
            jsonb_build_object('mid_journey', random() < 0.4, 'journey_flow', 'booking', 'journey_state', (array['BOOK_AGENDA', 'BOOK_PATIENT_NEW', 'WELCOME'])[1 + floor(random() * 3)::int]), v_t);
  end loop;
end
$$;
