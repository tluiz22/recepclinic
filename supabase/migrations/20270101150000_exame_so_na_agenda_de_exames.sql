-- ---------------------------------------------------------------------------
-- Exame só na agenda de Exames (cliente, 08/nov/2026; item 3 da validação)
-- ---------------------------------------------------------------------------
-- "Exames será sempre na agenda de exames. O profissional faz parte da equipe e
-- a equipe se organiza junto com os profissionais para tratar os exames." Vale
-- para todas as clínicas, também as de um profissional só.
--
-- Os exames que estavam na agenda de um profissional passam para a agenda de
-- Exames (criada onde faltar; reativada se estava desativada), com:
--   - os horários de atendimento só deles (service_id = o exame);
--   - uma cópia, só para o exame, dos horários "todos os serviços" da agenda do
--     profissional (para o exame continuar com vaga);
--   - os atendimentos futuros (marcado ou confirmado), as séries em andamento e
--     os links de agendar.
-- O histórico (atendimentos já feitos, cancelados) fica onde está.
--
-- Daqui em diante, serviço do tipo exame só da Equipe (o banco recusa exame de
-- profissional; a tela avisa antes).
--
-- Reversão: drop da constraint services_exam_team_only (os dados movidos não voltam sozinhos).

alter table public.agendas disable trigger user;
alter table public.services disable trigger user;
alter table public.service_agendas disable trigger user;
alter table public.availability_windows disable trigger user;
alter table public.appointments disable trigger user;
alter table public.appointment_series disable trigger user;
alter table public.booking_links disable trigger user;

do $$
declare
  c record;
  s record;
  v_team uuid;
  v_from uuid[];
begin
  -- A agenda de Exames de cada clínica que tem exame de profissional.
  for c in select distinct clinic_id from public.services where category = 'exam' and professional_id is not null loop
    select id into v_team from public.agendas where clinic_id = c.clinic_id and kind = 'resource';
    if v_team is null then
      insert into public.agendas (clinic_id, name, kind, professional_id, profile)
      values (c.clinic_id, 'Exames', 'resource', null, coalesce((select profile from public.clinic_settings where clinic_id = c.clinic_id), 'mixed'));
    else
      update public.agendas set is_active = true where id = v_team and not is_active;
    end if;
  end loop;

  for s in select id, clinic_id, professional_id from public.services where category = 'exam' and professional_id is not null loop
    select id into v_team from public.agendas where clinic_id = s.clinic_id and kind = 'resource';
    select coalesce(array_agg(distinct agenda_id), '{}') into v_from
      from (
        select agenda_id from public.service_agendas where service_id = s.id
        union
        select id from public.agendas where clinic_id = s.clinic_id and professional_id = s.professional_id
      ) a
     where agenda_id <> v_team;

    update public.availability_windows set agenda_id = v_team
     where clinic_id = s.clinic_id and service_id = s.id and agenda_id = any (v_from);

    insert into public.availability_windows (clinic_id, agenda_id, location_id, service_id, weekday, start_time, end_time, capacity, is_active)
    select w.clinic_id, v_team, w.location_id, s.id, w.weekday, w.start_time, w.end_time, w.capacity, w.is_active
      from public.availability_windows w
     where w.clinic_id = s.clinic_id and w.service_id is null and w.agenda_id = any (v_from)
       and exists (select 1 from public.service_locations sl where sl.service_id = s.id and sl.location_id = w.location_id);

    update public.appointments set agenda_id = v_team
     where clinic_id = s.clinic_id and service_id = s.id and agenda_id = any (v_from)
       and scheduled_at >= now() and status in ('scheduled', 'confirmed');

    update public.appointment_series set agenda_id = v_team
     where clinic_id = s.clinic_id and service_id = s.id and agenda_id = any (v_from) and ended_at is null;

    update public.booking_links set agenda_id = v_team
     where clinic_id = s.clinic_id and service_id = s.id and agenda_id = any (v_from);

    delete from public.service_agendas where service_id = s.id;
    insert into public.service_agendas (clinic_id, service_id, agenda_id) values (s.clinic_id, s.id, v_team);

    update public.services set professional_id = null, is_team = true where id = s.id;
  end loop;
end
$$;

alter table public.agendas enable trigger user;
alter table public.services enable trigger user;
alter table public.service_agendas enable trigger user;
alter table public.availability_windows enable trigger user;
alter table public.appointments enable trigger user;
alter table public.appointment_series enable trigger user;
alter table public.booking_links enable trigger user;

-- Exame é da Equipe (o sem dono, de antes do MS, ganha a Equipe ao entrar na agenda de Exames).
alter table public.services add constraint services_exam_team_only check (category <> 'exam' or professional_id is null);
