-- F9.4 — Anonimização de paciente a pedido (LGPD, L42; cliente, 09/out/2026).
--
-- A clínica (controladora) atende o pedido do paciente; o RecepClinic
-- (operador) executa. Regras do cliente:
--   1. o histórico fica, sem ninguém identificável: atendimentos passados com
--      data, serviço, profissional, valor e situação; o paciente vira
--      "Paciente anonimizado";
--   2. o contato do paciente (telefone, nome, endereço, mensagens) é sempre
--      anonimizado junto, mesmo que responda por outros pacientes (esses
--      ficam sem telefone até a clínica cadastrar outro contato);
--   3. só o Administrador da clínica e o Suporte;
--   4. atendimentos futuros são cancelados junto, sem aviso ao paciente (a
--      lista de espera pode oferecer as vagas);
--   5. as cópias no registro do Suporte (platform_audit_log) perdem os campos
--      pessoais.
-- Irreversível. O telefone vira um número impossível ("+00…", único por
-- contato), que o envio pelo WhatsApp recusa (src/lib/anonymization.ts).

alter table public.patients add column anonymized_at timestamptz;
alter table public.contacts add column anonymized_at timestamptz;

-- Paciente anonimizado não volta: fica inativo e não aceita alteração.
alter table public.patients add constraint patients_anonymized_inactive check (anonymized_at is null or not is_active);
alter table public.contacts add constraint contacts_anonymized_inactive check (anonymized_at is null or not is_active);

create function app.keep_patient_anonymized()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.anonymized_at is not null then
    raise exception 'paciente anonimizado não pode ser alterado' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger patients_keep_anonymized
  before update on public.patients
  for each row execute function app.keep_patient_anonymized();

-- O contato anonimizado pode receber um telefone novo (os outros pacientes
-- dele voltam a ter com quem falar): src/lib/data/patients.ts › updateContact
-- limpa anonymized_at e reativa. Os dados antigos já foram apagados.

-- Campos pessoais de uma linha copiada (registro do Suporte, metadados).
create function app.scrub_personal(p_row jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_row is null or jsonb_typeof(p_row) <> 'object' then p_row
    else (
      select coalesce(jsonb_object_agg(
        key,
        case when key in (
          'full_name', 'name', 'contact_name', 'patient_name', 'phone', 'contact_phone', 'birthdate', 'notes',
          'default_home_address', 'home_visit_address', 'home_address', 'address', 'insurance_card_number',
          'insurance_card_valid_until', 'body', 'context'
        ) and value <> 'null'::jsonb then to_jsonb('anonimizado'::text) else value end
      ), '{}'::jsonb)
      from jsonb_each(p_row)
    )
  end
$$;

-- Telefone impossível e único por contato: "+00" e 13 dígitos do id.
create function app.anonymized_phone(p_contact_id uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select '+00' || lpad(((('x' || substr(md5(p_contact_id::text), 1, 12))::bit(48)::bigint) % 10000000000000)::text, 13, '0')
$$;

create function public.anonymize_patient(p_clinic_id uuid, p_patient_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  with canceled as (
    update public.appointments
       set status = 'canceled', canceled_at = now(), canceled_via = 'admin', canceled_by = v_actor, mass_canceled = false
     where clinic_id = p_clinic_id and patient_id = p_patient_id
       and status in ('scheduled', 'confirmed') and scheduled_at > now()
    returning id
  ), trail as (
    insert into public.appointment_events (clinic_id, appointment_id, event_type, actor_id, channel, details)
    select p_clinic_id, id, 'canceled', v_actor, 'admin', jsonb_build_object('reason', 'anonymized')
      from canceled
    returning 1
  )
  select count(*) into v_canceled from trail;

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
$$;

revoke execute on function public.anonymize_patient(uuid, uuid) from public, anon, clinic_service;
grant execute on function public.anonymize_patient(uuid, uuid) to authenticated;
revoke execute on function app.scrub_personal(jsonb) from public, anon, authenticated, clinic_service;
revoke execute on function app.anonymized_phone(uuid) from public, anon, authenticated, clinic_service;
