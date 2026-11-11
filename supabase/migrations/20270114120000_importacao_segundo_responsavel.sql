-- Importação da agenda com o 2º responsável (VR-7, D14; cliente, 10/nov/2026; migração aprovada pelo cliente em
-- 11/nov/2026). O link da agenda atual ganha "Nome do 2º responsável" e "Telefone do 2º responsável" (opcionais); o 1º
-- telefone segue o principal.
--
-- 1. patient_contacts.agenda_import_id: a ligação feita pela carga (para o Desfazer).
-- 2. load_agenda_import: liga o 2º responsável (contato já cadastrado, criado antes nesta carga ou novo), com o
--    registro em patient_contact_events; devolve também `links`.
-- 3. undo_agenda_import: desliga o 2º responsável ligado pela carga (menos quem virou o principal ou marcou consulta do
--    paciente) e não apaga o contato que ainda cuida de algum paciente; devolve também `linksRemoved`.
--
-- Reversão: recriar as duas funções como em 20261020130000 e 20261020140000 e
-- `alter table public.patient_contacts drop column agenda_import_id`.

alter table public.patient_contacts
  add column agenda_import_id uuid references public.agenda_import_requests (id) on delete set null;
create index patient_contacts_agenda_import_idx on public.patient_contacts (agenda_import_id) where agenda_import_id is not null;

create or replace function public.load_agenda_import(p_request_id uuid, p_plan jsonb)
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
  v_second_phone text;
  v_second_id uuid;
  v_links integer := 0;
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

    -- 2º responsável (VR-7): o já cadastrado, o criado antes nesta carga (mesmo WhatsApp) ou um novo, ligado ao
    -- paciente com o registro; o 1º telefone segue o principal.
    v_second_phone := nullif(v_entry->>'secondPhone', '');
    if v_second_phone is not null and v_second_phone <> v_entry->>'phone' then
      v_second_id := nullif(v_entry->>'secondContactId', '')::uuid;
      if v_second_id is null then
        select id into v_second_id from public.contacts
          where clinic_id = v_request.clinic_id and phone = v_second_phone;
      end if;
      if v_second_id is null then
        insert into public.contacts (clinic_id, full_name, phone, agenda_import_id)
          values (v_request.clinic_id, v_entry->>'secondName', v_second_phone, v_request.id)
          returning id into v_second_id;
        v_contacts := v_contacts + 1;
      else
        update public.contacts set is_active = true
          where id = v_second_id and not is_active and anonymized_at is null;
        if found then v_reactivated := v_reactivated + 1; end if;
      end if;
      insert into public.patient_contacts (clinic_id, patient_id, contact_id, created_by, agenda_import_id)
        values (v_request.clinic_id, v_patient_id, v_second_id, (select auth.uid()), v_request.id)
        on conflict (patient_id, contact_id) do nothing;
      if found then
        insert into public.patient_contact_events (clinic_id, patient_id, contact_id, event, actor_id)
          values (v_request.clinic_id, v_patient_id, v_second_id, 'linked', (select auth.uid()));
        v_links := v_links + 1;
      end if;
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
    'reactivated', v_reactivated,
    'links', v_links
  );
end
$function$;

create or replace function public.undo_agenda_import(p_request_id uuid, p_apply boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_request record;
  v_row record;
  v_reasons text[];
  v_result jsonb;
  v_appointments_removed integer := 0;
  v_patients_removed integer := 0;
  v_contacts_removed integer := 0;
  v_links_removed integer := 0;
  v_appointments_kept jsonb := '[]'::jsonb;
  v_patients_kept jsonb := '[]'::jsonb;
  v_contacts_kept jsonb := '[]'::jsonb;
begin
  if not app.is_platform_staff() then
    raise exception 'Só o Suporte desfaz a carga da agenda atual.' using errcode = '42501';
  end if;
  select id, clinic_id, status into v_request
    from public.agenda_import_requests where id = p_request_id
    for update;
  if v_request.id is null then
    raise exception 'Agenda atual não encontrada.' using errcode = 'P0001', hint = 'agenda_import_not_found';
  end if;
  if v_request.status <> 'loaded' then
    raise exception 'Esta agenda atual não foi carregada.' using errcode = 'P0001', hint = 'agenda_import_not_loaded';
  end if;

  begin
    -- Consultas
    for v_row in
      select a.id, a.status, a.rescheduled_at, a.patient_confirmed_at, a.reminder_sent_at, a.scheduled_at,
             p.full_name as patient_name, s.name as service_name
        from public.appointments a
        join public.patients p on p.id = a.patient_id
        join public.services s on s.id = a.service_id
       where a.agenda_import_id = v_request.id
       order by a.scheduled_at
    loop
      v_reasons := array[]::text[];
      if v_row.status = 'canceled' then v_reasons := array_append(v_reasons, 'cancelada'); end if;
      if v_row.status = 'completed' then v_reasons := array_append(v_reasons, 'comparecimento registrado'); end if;
      if v_row.status = 'no_show' then v_reasons := array_append(v_reasons, 'falta registrada'); end if;
      if v_row.status = 'confirmed' then v_reasons := array_append(v_reasons, 'confirmada'); end if;
      if v_row.rescheduled_at is not null then v_reasons := array_append(v_reasons, 'remarcada'); end if;
      if v_row.patient_confirmed_at is not null then v_reasons := array_append(v_reasons, 'presença confirmada'); end if;
      if v_row.reminder_sent_at is not null
         or exists (select 1 from public.whatsapp_messages m where m.appointment_id = v_row.id and m.direction = 'outbound') then
        v_reasons := array_append(v_reasons, 'mensagem enviada');
      end if;
      if exists (select 1 from public.payments pay where pay.appointment_id = v_row.id) then
        v_reasons := array_append(v_reasons, 'pagamento registrado');
      end if;
      if exists (select 1 from public.appointments r where r.origin_appointment_id = v_row.id) then
        v_reasons := array_append(v_reasons, 'retorno marcado a partir dela');
      end if;
      if cardinality(v_reasons) = 0 then
        begin
          delete from public.appointments where id = v_row.id;
          v_appointments_removed := v_appointments_removed + 1;
        exception when foreign_key_violation then
          v_reasons := array_append(v_reasons, 'presa a outro registro (link ou lista de espera)');
        end;
      end if;
      if cardinality(v_reasons) > 0 then
        v_appointments_kept := v_appointments_kept || jsonb_build_object(
          'patientName', v_row.patient_name, 'serviceName', v_row.service_name,
          'scheduledAt', v_row.scheduled_at, 'reasons', to_jsonb(v_reasons));
      end if;
    end loop;

    -- 2º responsáveis ligados pela carga (VR-7): saem, menos quem virou o principal ou marcou consulta do paciente.
    for v_row in
      select pc.id, pc.patient_id, pc.contact_id, c.full_name
        from public.patient_contacts pc
        join public.contacts c on c.id = pc.contact_id
        join public.patients p on p.id = pc.patient_id
       where pc.agenda_import_id = v_request.id
       order by c.full_name
    loop
      if exists (select 1 from public.patients p where p.id = v_row.patient_id and p.contact_id = v_row.contact_id) then
        v_contacts_kept := v_contacts_kept || jsonb_build_object('name', v_row.full_name, 'reason', 'virou o responsável principal');
      elsif exists (select 1 from public.appointments a where a.patient_id = v_row.patient_id and a.booked_by_contact_id = v_row.contact_id) then
        v_contacts_kept := v_contacts_kept || jsonb_build_object('name', v_row.full_name, 'reason', 'marcou consulta do paciente');
      else
        delete from public.patient_contacts where id = v_row.id;
        insert into public.patient_contact_events (clinic_id, patient_id, contact_id, event, actor_id)
          values (v_request.clinic_id, v_row.patient_id, v_row.contact_id, 'unlinked', (select auth.uid()));
        v_links_removed := v_links_removed + 1;
      end if;
    end loop;

    -- Pacientes criados pela carga
    for v_row in select p.id, p.full_name from public.patients p where p.agenda_import_id = v_request.id order by p.full_name loop
      if exists (select 1 from public.appointments a where a.patient_id = v_row.id) then
        v_patients_kept := v_patients_kept || jsonb_build_object('name', v_row.full_name, 'reason', 'tem consulta');
      else
        begin
          delete from public.patients where id = v_row.id;
          v_patients_removed := v_patients_removed + 1;
        exception when foreign_key_violation then
          v_patients_kept := v_patients_kept || jsonb_build_object('name', v_row.full_name, 'reason', 'tem outros registros na clínica');
        end;
      end if;
    end loop;

    -- Contatos criados pela carga
    for v_row in select c.id, c.full_name from public.contacts c where c.agenda_import_id = v_request.id order by c.full_name loop
      if exists (select 1 from public.patients p where p.contact_id = v_row.id)
         or exists (select 1 from public.patient_contacts pc where pc.contact_id = v_row.id) then
        if not v_contacts_kept @> jsonb_build_array(jsonb_build_object('name', v_row.full_name)) then
          v_contacts_kept := v_contacts_kept || jsonb_build_object('name', v_row.full_name, 'reason', 'tem paciente');
        end if;
      elsif exists (select 1 from public.whatsapp_messages m where m.contact_id = v_row.id)
         or exists (select 1 from public.conversation_state w where w.contact_id = v_row.id) then
        v_contacts_kept := v_contacts_kept || jsonb_build_object('name', v_row.full_name, 'reason', 'tem conversa no WhatsApp');
      else
        begin
          delete from public.contacts where id = v_row.id;
          v_contacts_removed := v_contacts_removed + 1;
        exception when foreign_key_violation then
          v_contacts_kept := v_contacts_kept || jsonb_build_object('name', v_row.full_name, 'reason', 'tem outros registros na clínica');
        end;
      end if;
    end loop;

    if p_apply then
      update public.agenda_import_requests
        set status = 'undone', undone_by = (select auth.uid()), undone_at = now()
        where id = v_request.id;
    end if;

    v_result := jsonb_build_object(
      'applied', p_apply,
      'appointmentsRemoved', v_appointments_removed,
      'patientsRemoved', v_patients_removed,
      'contactsRemoved', v_contacts_removed,
      'linksRemoved', v_links_removed,
      'appointmentsKept', v_appointments_kept,
      'patientsKept', v_patients_kept,
      'contactsKept', v_contacts_kept
    );
    if not p_apply then
      -- Prévia: volta tudo atrás e fica só o resultado.
      raise exception 'previa' using errcode = 'P0001', hint = 'agenda_import_preview';
    end if;
  exception when sqlstate 'P0001' then
    if p_apply then raise; end if;
    if v_result is null then raise; end if;
  end;

  return v_result;
end
$function$;
