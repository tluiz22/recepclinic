-- F10.1c (cliente, 19 e 20/out/2026): a carga da agenda atual, autorizada
-- pelo Suporte depois da conferência (sem erro). Tudo numa transação: entra
-- inteira ou não entra nada.
--   - Sem aviso de marcação: a confirmação sai da rota do painel, não do
--     banco; o preparo e as orientações saem só depois dela. Os lembretes saem
--     normalmente (rotina de sempre).
--   - Quem já existe (mesmo WhatsApp = mesmo contato; no contato, mesmo nome e
--     nascimento = mesmo paciente) fica como está e só ganha as consultas; se
--     estava inativo e tem consulta na carga, volta a ficar ativo.
--   - As consultas importadas ficam marcadas (agenda_import_id): a trilha diz
--     "Importado na implantação" e elas não contam no "Marcados por" das
--     Métricas nem no contador de atendimentos criados (Uso).
--   - Contatos e pacientes criados pela carga também ficam marcados, para o
--     "Desfazer" (F10.1d).

alter table public.contacts add column agenda_import_id uuid references public.agenda_import_requests (id);
alter table public.patients add column agenda_import_id uuid references public.agenda_import_requests (id);
alter table public.appointments add column agenda_import_id uuid references public.agenda_import_requests (id);

create index contacts_agenda_import_idx on public.contacts (agenda_import_id) where agenda_import_id is not null;
create index patients_agenda_import_idx on public.patients (agenda_import_id) where agenda_import_id is not null;
create index appointments_agenda_import_idx on public.appointments (agenda_import_id) where agenda_import_id is not null;

-- Contador de uso: a consulta importada não é atendimento criado no mês.
create or replace function app.count_created_appointment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.agenda_import_id is null then
    perform app.bump_usage(new.clinic_id, 0, 0, 1);
  end if;
  return null;
end
$$;

-- A carga. `p_plan` vem da conferência (src/lib/data/agendaImport.ts):
-- [{ contactId, phone, contactName, patientId, name, birthdate, isContactSelf,
--    insurancePlanId, cardNumber, appointments: [{ serviceId, agendaId,
--    locationId, scheduledAt, durationMinutes, homeAddress }] }]
create function public.load_agenda_import(p_request_id uuid, p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
      insert into public.appointment_events (clinic_id, appointment_id, event_type, actor_id, channel, details)
        values (v_request.clinic_id, v_appointment_id, 'created', (select auth.uid()), 'admin', '{"imported": true}'::jsonb);
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
$$;

revoke execute on function public.load_agenda_import(uuid, jsonb) from public, anon, clinic_service;
grant execute on function public.load_agenda_import(uuid, jsonb) to authenticated;
