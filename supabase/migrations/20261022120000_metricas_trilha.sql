-- M1 do redesign das Métricas (cliente, 22/out/2026): trilha do atendimento
-- confiável e índices das contas.
--
-- Até aqui a trilha era gravada pela aplicação depois da mudança, em outra
-- operação: se a gravação falhasse, o evento se perdia (só ia para o log).
-- Agora marcar, remarcar, cancelar e registrar o comparecimento gravam o
-- evento no próprio banco, pelo gatilho da tabela, na mesma transação da
-- mudança: ou entram os dois, ou nenhum.
--
-- O canal fino (link de agendamento, rotina, cancelamento em massa,
-- bloqueio), o evento (antecipado pela lista de espera) e os detalhes vêm na
-- própria mudança, na coluna `trail_context`, que nunca fica gravada: o
-- gatilho "antes" guarda o contexto na transação e limpa a coluna; o gatilho
-- "depois" grava o evento. Quem fez vem das colunas que já existem
-- (created_by, rescheduled_by, canceled_by), do contexto ou do login.
--
-- Os outros eventos (presença, lista de espera, mensagens) continuam
-- gravados pela aplicação, como antes.

alter table public.appointments add column trail_context jsonb;

comment on column public.appointments.trail_context is
  'Contexto da trilha da mudança em curso ({channel, event, actor, details}); o gatilho limpa, nunca fica gravado.';

-- Antes: guarda o contexto desta linha na transação e limpa a coluna.
create function app.stash_appointment_trail()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('recepclinic.trail_' || replace(new.id::text, '-', ''), coalesce(new.trail_context::text, ''), true);
  new.trail_context := null;
  return new;
end
$$;

-- Instante como a aplicação sempre gravou na trilha ("2026-10-22T13:00:00.000Z").
create function app.trail_instant(p_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- Depois: grava o evento da mudança.
create function app.record_appointment_trail()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx jsonb := nullif(current_setting('recepclinic.trail_' || replace(new.id::text, '-', ''), true), '')::jsonb;
  v_channel text := v_ctx->>'channel';
  v_event text := v_ctx->>'event';
  v_actor uuid := nullif(v_ctx->>'actor', '')::uuid;
  v_details jsonb := coalesce(v_ctx->'details', '{}'::jsonb);
  v_login uuid := case when (select auth.role()) = 'authenticated' then (select auth.uid()) end;
begin
  if tg_op = 'INSERT' then
    insert into public.appointment_events (clinic_id, appointment_id, event_type, actor_id, channel, details)
    values (
      new.clinic_id, new.id, 'created', coalesce(v_actor, new.created_by, v_login),
      coalesce(v_channel, new.booking_channel::text),
      v_details || case when new.agenda_import_id is not null then '{"imported": true}'::jsonb else '{}'::jsonb end
    );
    return null;
  end if;

  if new.status = 'canceled' and old.status <> 'canceled' then
    insert into public.appointment_events (clinic_id, appointment_id, event_type, actor_id, channel, details)
    values (
      new.clinic_id, new.id, 'canceled', coalesce(v_actor, new.canceled_by),
      coalesce(v_channel, new.canceled_via::text, 'admin'), v_details
    );
  elsif new.status in ('completed', 'no_show') and new.status is distinct from old.status then
    insert into public.appointment_events (clinic_id, appointment_id, event_type, actor_id, channel, details)
    values (
      new.clinic_id, new.id,
      case when old.status in ('completed', 'no_show') then 'attendance_corrected' else 'attendance_recorded' end,
      coalesce(v_actor, v_login), coalesce(v_channel, 'admin'),
      v_details || case when old.status in ('completed', 'no_show')
        then jsonb_build_object('from', old.status, 'to', new.status)
        else jsonb_build_object('status', new.status) end
    );
  elsif new.scheduled_at is distinct from old.scheduled_at and new.status <> 'canceled' then
    insert into public.appointment_events (clinic_id, appointment_id, event_type, actor_id, channel, details)
    values (
      new.clinic_id, new.id,
      case when v_event = 'waitlist_advanced' then 'waitlist_advanced' else 'rescheduled' end,
      coalesce(v_actor, new.rescheduled_by),
      coalesce(v_channel, new.rescheduled_via::text, 'admin'),
      v_details || jsonb_build_object('from', app.trail_instant(old.scheduled_at), 'to', app.trail_instant(new.scheduled_at))
    );
  end if;
  return null;
end
$$;

revoke execute on function app.stash_appointment_trail() from public, anon, authenticated, clinic_service;
revoke execute on function app.record_appointment_trail() from public, anon, authenticated, clinic_service;

-- "zz_" no nome: os gatilhos rodam em ordem alfabética, e este vem por último
-- (depois das regras que podem barrar a mudança).
create trigger zz_appointments_stash_trail
  before insert or update on public.appointments
  for each row execute function app.stash_appointment_trail();

create trigger zz_appointments_record_trail
  after insert or update on public.appointments
  for each row execute function app.record_appointment_trail();

-- ---------------------------------------------------------------------------
-- Turmas: o contexto da trilha também chega pelas funções (link de
-- agendamento, antecipado pela lista de espera). Mesmo corpo, com o
-- parâmetro novo opcional.
-- ---------------------------------------------------------------------------
drop function public.book_group_session(uuid, uuid, uuid, uuid, timestamptz, public.action_channel);
drop function public.reschedule_group_session(uuid, timestamptz, public.action_channel);

create function public.book_group_session(
  p_service_id uuid,
  p_agenda_id uuid,
  p_location_id uuid,
  p_patient_id uuid,
  p_scheduled_at timestamptz,
  p_booking_channel public.action_channel,
  p_trail jsonb default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
  v_duration integer;
  v_local timestamp;
  v_capacity integer;
  v_booked integer;
  v_appointment_id uuid;
begin
  select clinic_id, duration_minutes into v_clinic_id, v_duration
    from public.services where id = p_service_id and scheduling_mode = 'group';
  if v_clinic_id is null or not app.can_access_agenda(p_agenda_id)
     or not exists (select 1 from public.agendas where id = p_agenda_id and clinic_id = v_clinic_id) then
    raise exception 'Sem acesso a esta agenda.' using errcode = '42501';
  end if;

  v_local := p_scheduled_at at time zone (select timezone from public.clinic_settings where clinic_id = v_clinic_id);

  select capacity into v_capacity
    from public.availability_windows
    where agenda_id = p_agenda_id
      and service_id = p_service_id
      and weekday = extract(dow from v_local)
      and start_time = v_local::time
      and is_active
    for update;
  if v_capacity is null then
    raise exception 'no_window' using errcode = 'P0001';
  end if;

  select count(*) into v_booked
    from public.appointments
    where agenda_id = p_agenda_id
      and service_id = p_service_id
      and scheduled_at = p_scheduled_at
      and status in ('scheduled', 'confirmed');
  if v_booked >= v_capacity then
    raise exception 'slot_full' using errcode = 'P0001';
  end if;

  insert into public.appointments (
    clinic_id, patient_id, service_id, agenda_id, location_id,
    scheduled_at, duration_minutes, booking_channel, created_by, trail_context
  ) values (
    v_clinic_id, p_patient_id, p_service_id, p_agenda_id, p_location_id,
    p_scheduled_at, v_duration, p_booking_channel, (select auth.uid()), p_trail
  )
  returning id into v_appointment_id;

  return v_appointment_id;
end
$$;

create function public.reschedule_group_session(
  p_appointment_id uuid,
  p_scheduled_at timestamptz,
  p_channel public.action_channel,
  p_trail jsonb default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments%rowtype;
  v_local timestamp;
  v_capacity integer;
  v_booked integer;
begin
  select * into v_appointment from public.appointments where id = p_appointment_id;
  if v_appointment.id is null or not app.can_access_agenda(v_appointment.agenda_id) then
    raise exception 'Sem acesso a esta agenda.' using errcode = '42501';
  end if;

  v_local := p_scheduled_at at time zone (select timezone from public.clinic_settings where clinic_id = v_appointment.clinic_id);

  select capacity into v_capacity
    from public.availability_windows
    where agenda_id = v_appointment.agenda_id
      and service_id = v_appointment.service_id
      and weekday = extract(dow from v_local)
      and start_time = v_local::time
      and is_active
    for update;
  if v_capacity is null then
    raise exception 'no_window' using errcode = 'P0001';
  end if;

  select count(*) into v_booked
    from public.appointments
    where agenda_id = v_appointment.agenda_id
      and service_id = v_appointment.service_id
      and scheduled_at = p_scheduled_at
      and status in ('scheduled', 'confirmed')
      and id <> p_appointment_id;
  if v_booked >= v_capacity then
    raise exception 'slot_full' using errcode = 'P0001';
  end if;

  update public.appointments
    set scheduled_at = p_scheduled_at,
        rescheduled_at = now(),
        rescheduled_via = p_channel,
        rescheduled_by = (select auth.uid()),
        trail_context = p_trail
    where id = p_appointment_id;
end
$$;

revoke execute on function public.book_group_session(uuid, uuid, uuid, uuid, timestamptz, public.action_channel, jsonb) from public, anon;
revoke execute on function public.reschedule_group_session(uuid, timestamptz, public.action_channel, jsonb) from public, anon;
grant execute on function public.book_group_session(uuid, uuid, uuid, uuid, timestamptz, public.action_channel, jsonb) to authenticated, clinic_service;
grant execute on function public.reschedule_group_session(uuid, timestamptz, public.action_channel, jsonb) to authenticated, clinic_service;

-- ---------------------------------------------------------------------------
-- Índices das contas das Métricas (por clínica e pela data de cada conta)
-- ---------------------------------------------------------------------------
create index appointments_clinic_created_idx on public.appointments (clinic_id, created_at);
create index appointments_clinic_canceled_idx on public.appointments (clinic_id, canceled_at) where canceled_at is not null;
create index appointment_events_clinic_type_idx on public.appointment_events (clinic_id, event_type, occurred_at);
create index whatsapp_messages_clinic_type_idx on public.whatsapp_messages (clinic_id, message_type, created_at);
create index bot_funnel_events_clinic_time_idx on public.bot_funnel_events (clinic_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Carga da agenda e anonimização: a trilha passa a sair do gatilho (sem
-- evento repetido). Mesmo corpo de antes, sem o insert próprio.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.load_agenda_import(p_request_id uuid, p_plan jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_request record;
  v_entry jsonb;
  v_appointment jsonb;
  v_contact_id uuid;
  v_patient_id uuid;
  v_appointment_id uuid;
  v_self boolean;
  v_contacts integer := 0;
  v_patients integer := 0;
  v_appointments integer := 0;
  v_reactivated integer := 0;
begin
  if not app.is_platform_staff() then
    raise exception 'Só o Suporte faz a carga da agenda atual.' using errcode = '42501';
  end if;
  select id, clinic_id, status into v_request
    from public.agenda_import_requests where id = p_request_id
    for update;
  if v_request.id is null then
    raise exception 'Agenda atual não encontrada.' using errcode = 'P0001', hint = 'agenda_import_not_found';
  end if;
  if v_request.status <> 'submitted' then
    raise exception 'A agenda atual não está para autorizar.' using errcode = 'P0001', hint = 'agenda_import_not_submitted';
  end if;
  if jsonb_typeof(p_plan) <> 'array' then
    raise exception 'Carga inválida.' using errcode = '22023';
  end if;

  for v_entry in select * from jsonb_array_elements(p_plan) loop
    -- Contato: o já cadastrado, o criado antes nesta carga (mesmo WhatsApp) ou um novo.
    v_contact_id := nullif(v_entry->>'contactId', '')::uuid;
    if v_contact_id is null then
      select id into v_contact_id from public.contacts
        where clinic_id = v_request.clinic_id and phone = v_entry->>'phone';
    end if;
    if v_contact_id is null then
      insert into public.contacts (clinic_id, full_name, phone, agenda_import_id)
        values (v_request.clinic_id, v_entry->>'contactName', v_entry->>'phone', v_request.id)
        returning id into v_contact_id;
      v_contacts := v_contacts + 1;
    end if;

    -- Paciente: o já cadastrado ou um novo no contato.
    v_patient_id := nullif(v_entry->>'patientId', '')::uuid;
    if v_patient_id is null then
      select id into v_patient_id from public.patients
        where clinic_id = v_request.clinic_id and contact_id = v_contact_id
          and lower(full_name) = lower(v_entry->>'name') and birthdate = (v_entry->>'birthdate')::date;
    end if;
    if v_patient_id is null then
      v_self := coalesce((v_entry->>'isContactSelf')::boolean, false)
        and not exists (select 1 from public.patients where contact_id = v_contact_id and is_contact_self);
      insert into public.patients (
        clinic_id, contact_id, full_name, birthdate, is_contact_self,
        insurance_plan_id, insurance_card_number, agenda_import_id
      ) values (
        v_request.clinic_id, v_contact_id, v_entry->>'name', (v_entry->>'birthdate')::date, v_self,
        nullif(v_entry->>'insurancePlanId', '')::uuid,
        case when nullif(v_entry->>'insurancePlanId', '') is null then null else nullif(v_entry->>'cardNumber', '') end,
        v_request.id
      )
      returning id into v_patient_id;
      v_patients := v_patients + 1;
    end if;

    if jsonb_array_length(coalesce(v_entry->'appointments', '[]'::jsonb)) > 0 then
      -- Com consulta: o contato e o paciente voltam a ficar ativos.
      update public.contacts set is_active = true
        where id = v_contact_id and not is_active and anonymized_at is null;
      if found then v_reactivated := v_reactivated + 1; end if;
      update public.patients set is_active = true
        where id = v_patient_id and not is_active and anonymized_at is null;
      if found then v_reactivated := v_reactivated + 1; end if;
    end if;

    for v_appointment in select * from jsonb_array_elements(coalesce(v_entry->'appointments', '[]'::jsonb)) loop
      insert into public.appointments (
        clinic_id, patient_id, service_id, agenda_id, location_id,
        scheduled_at, duration_minutes, booking_channel, home_visit_address,
        created_by, agenda_import_id
      ) values (
        v_request.clinic_id, v_patient_id,
        (v_appointment->>'serviceId')::uuid, (v_appointment->>'agendaId')::uuid, (v_appointment->>'locationId')::uuid,
        (v_appointment->>'scheduledAt')::timestamptz, (v_appointment->>'durationMinutes')::integer,
        'admin', nullif(v_appointment->>'homeAddress', ''),
        (select auth.uid()), v_request.id
      )
      returning id into v_appointment_id;
      -- A trilha ("Importado na implantação") sai do gatilho da tabela (M1).
      v_appointments := v_appointments + 1;
    end loop;
  end loop;

  update public.agenda_import_requests
    set status = 'loaded', loaded_by = (select auth.uid()), loaded_at = now()
    where id = v_request.id;

  return jsonb_build_object(
    'contacts', v_contacts,
    'patients', v_patients,
    'appointments', v_appointments,
    'reactivated', v_reactivated
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.anonymize_patient(p_clinic_id uuid, p_patient_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_patient public.patients%rowtype;
  v_contact public.contacts%rowtype;
  v_phone text;
  v_actor uuid := (select auth.uid());
  v_appointments uuid[];
  v_canceled integer;
  v_others integer;
begin
  if not (app.is_platform_staff() or app.has_clinic_role(p_clinic_id, array['admin']::public.clinic_role[])) then
    raise exception 'anonimizar paciente: sem permissão' using errcode = '42501';
  end if;

  select * into v_patient from public.patients where clinic_id = p_clinic_id and id = p_patient_id for update;
  if not found then
    raise exception 'anonimizar paciente: não encontrado' using errcode = 'P0002';
  end if;
  if v_patient.anonymized_at is not null then
    raise exception 'anonimizar paciente: já anonimizado' using errcode = 'P0001', hint = 'already_anonymized';
  end if;
  select * into v_contact from public.contacts where clinic_id = p_clinic_id and id = v_patient.contact_id for update;
  v_phone := v_contact.phone;

  select coalesce(array_agg(id), '{}') into v_appointments
    from public.appointments where clinic_id = p_clinic_id and patient_id = p_patient_id;

  -- 4. Futuros: cancelados pela clínica, sem aviso (a trilha registra; o
  -- gatilho da lista de espera abre as vagas e fecha as inscrições).
  -- A trilha sai do gatilho da tabela, com o motivo (M1).
  with canceled as (
    update public.appointments
       set status = 'canceled', canceled_at = now(), canceled_via = 'admin', canceled_by = v_actor, mass_canceled = false,
           trail_context = jsonb_build_object('details', jsonb_build_object('reason', 'anonymized'))
     where clinic_id = p_clinic_id and patient_id = p_patient_id
       and status in ('scheduled', 'confirmed') and scheduled_at > now()
    returning id
  )
  select count(*) into v_canceled from canceled;

  -- Inscrições na lista de espera que sobraram (atendimentos passados).
  update public.waitlist_entries
     set status = 'closed', ended_at = now(), ended_reason = 'anonymized', ended_by = v_actor
   where clinic_id = p_clinic_id and status = 'active' and appointment_id = any (v_appointments);

  -- Séries: param de gerar e perdem o endereço.
  update public.appointment_series
     set ended_at = coalesce(ended_at, now()), ended_by = coalesce(ended_by, v_actor), home_visit_address = null
   where clinic_id = p_clinic_id and patient_id = p_patient_id;

  -- 1. Histórico sem endereço; paciente sem identificação.
  update public.appointments set home_visit_address = null
   where clinic_id = p_clinic_id and patient_id = p_patient_id and home_visit_address is not null;

  update public.patients
     set full_name = 'Paciente anonimizado', birthdate = date '1900-01-01', notes = null,
         insurance_card_number = null, insurance_card_valid_until = null,
         is_active = false, anonymized_at = now()
   where clinic_id = p_clinic_id and id = p_patient_id;

  -- 2. Contato, sempre junto.
  select count(*) into v_others from public.patients
   where clinic_id = p_clinic_id and contact_id = v_contact.id and id <> p_patient_id and anonymized_at is null;

  if v_contact.anonymized_at is null then
    update public.contacts
       set full_name = 'Contato anonimizado', phone = app.anonymized_phone(v_contact.id), default_home_address = null,
           is_active = false, anonymized_at = now()
     where clinic_id = p_clinic_id and id = v_contact.id;
  end if;

  -- Mensagens do contato e dos atendimentos do paciente: sem texto e sem telefone.
  update public.whatsapp_messages
     set body = null, contact_phone = case when contact_phone is null then null else app.anonymized_phone(v_contact.id) end
   where clinic_id = p_clinic_id
     and (contact_id = v_contact.id or contact_phone = v_phone or appointment_id = any (v_appointments));

  delete from public.conversation_state where clinic_id = p_clinic_id and (contact_id = v_contact.id or contact_phone = v_phone);

  update public.bot_funnel_events
     set contact_phone = app.anonymized_phone(v_contact.id), metadata = app.scrub_personal(metadata)
   where clinic_id = p_clinic_id and (contact_id = v_contact.id or contact_phone = v_phone);

  -- Links de agendamento: vencidos, sem telefone e sem endereço.
  update public.booking_links
     set contact_phone = app.anonymized_phone(v_contact.id), home_visit_address = null,
         expires_at = least(expires_at, now())
   where clinic_id = p_clinic_id and (patient_id = p_patient_id or contact_id = v_contact.id);

  -- 5. Registro do Suporte (inclusive as cópias que as linhas acima acabaram de gerar).
  update public.platform_audit_log
     set old_row = app.scrub_personal(old_row), new_row = app.scrub_personal(new_row)
   where clinic_id = p_clinic_id
     and (
       (table_name = 'patients' and coalesce(new_row, old_row) ->> 'id' = p_patient_id::text)
       or (table_name = 'contacts' and coalesce(new_row, old_row) ->> 'id' = v_contact.id::text)
       or coalesce(new_row, old_row) ->> 'patient_id' = p_patient_id::text
       or coalesce(new_row, old_row) ->> 'contact_id' = v_contact.id::text
       or coalesce(new_row, old_row) ->> 'contact_phone' = v_phone
       or (table_name = 'appointments' and coalesce(new_row, old_row) ->> 'id' = any (select unnest(v_appointments)::text))
       or coalesce(new_row, old_row) ->> 'appointment_id' = any (select unnest(v_appointments)::text)
     );

  return jsonb_build_object('canceled', v_canceled, 'other_patients', v_others);
end
$function$;
