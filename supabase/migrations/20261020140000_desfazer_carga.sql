-- F10.1d (cliente, 19/out/2026): desfazer a carga da agenda atual, pelo
-- Suporte, com confirmação. Saem as consultas importadas que ninguém mexeu e
-- os pacientes e contatos que a carga criou e ficaram sem uso; ficam:
--   - as consultas já mexidas: remarcadas, confirmadas, com comparecimento
--     ou falta registrados, canceladas, com presença confirmada, com mensagem
--     enviada (lembrete inclusive), com pagamento, com retorno marcado a
--     partir delas ou presas a outro registro (link, lista de espera);
--   - os pacientes com outra consulta (ou outro registro) e os contatos com
--     outro paciente (ou conversa no WhatsApp).
-- A tela mostra quais ficam e por quê. `p_apply = false` faz tudo e volta
-- atrás no fim (a prévia do "Desfazer"): o resultado é o mesmo da aplicação.
-- Quem já existia e voltou a ficar ativo com a carga continua ativo.

alter table public.agenda_import_requests
  add column undone_by uuid references auth.users (id) on delete set null,
  add column undone_at timestamptz;

-- A página do link não muda o desfeito (como os outros campos do Suporte).
create or replace function app.guard_agenda_import_answer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.is_platform_staff() or (select auth.role()) = 'service_role' then
    return new;
  end if;
  if old.status not in ('sent', 'draft', 'returned') or old.expires_at <= now() then
    raise exception 'Este link já foi enviado ou venceu.' using errcode = 'P0001', hint = 'agenda_import_closed';
  end if;
  if new.status not in ('draft', 'submitted')
     or new.clinic_id <> old.clinic_id or new.token_hash <> old.token_hash or new.email <> old.email
     or new.expires_at <> old.expires_at or new.requested_at <> old.requested_at or new.link_sent_at <> old.link_sent_at
     or new.requested_by is distinct from old.requested_by
     or new.return_comment is distinct from old.return_comment
     or new.returned_by is distinct from old.returned_by or new.returned_at is distinct from old.returned_at
     or new.loaded_by is distinct from old.loaded_by or new.loaded_at is distinct from old.loaded_at
     or new.undone_by is distinct from old.undone_by or new.undone_at is distinct from old.undone_at then
    raise exception 'Alteração não permitida no link.' using errcode = '42501';
  end if;
  return new;
end
$$;

create function public.undo_agenda_import(p_request_id uuid, p_apply boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request record;
  v_row record;
  v_reasons text[];
  v_result jsonb;
  v_appointments_removed integer := 0;
  v_patients_removed integer := 0;
  v_contacts_removed integer := 0;
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
      if exists (select 1 from public.patients p where p.contact_id = v_row.id) then
        v_contacts_kept := v_contacts_kept || jsonb_build_object('name', v_row.full_name, 'reason', 'tem paciente');
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
$$;

revoke execute on function public.undo_agenda_import(uuid, boolean) from public, anon, clinic_service;
grant execute on function public.undo_agenda_import(uuid, boolean) to authenticated;
