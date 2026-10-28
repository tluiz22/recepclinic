-- ---------------------------------------------------------------------------
-- Exame em paralelo (cliente, 28/out/2026): exame não ocupa o horário da agenda.
-- Consulta e retorno podem ser marcados no mesmo horário de um exame, e o exame
-- (individual ou turma) no de qualquer atendimento, até de outro exame. Os
-- bloqueios da agenda continuam valendo para todos.
--
-- A trava (appointments_no_overlap) só olhava a turma de exame; agora olha a
-- categoria do serviço, copiada para o atendimento na marcação (is_exam), como
-- já se fazia com is_group_session.
--
-- Reversão: recriar appointments_no_overlap com "and not is_group_session",
-- restaurar app.appointment_defaults() de 20261004150000_atendimentos.sql e
-- alter table public.appointments drop column is_exam.

alter table public.appointments add column is_exam boolean not null default false;

-- Sem gatilhos: a marca nova não é mudança do atendimento (nem updated_at nem trilha).
alter table public.appointments disable trigger user;
update public.appointments a
  set is_exam = true
  from public.services s
  where s.id = a.service_id and s.category = 'exam';
alter table public.appointments enable trigger user;

create or replace function app.appointment_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.service_id is distinct from old.service_id or new.agenda_id is distinct from old.agenda_id then
    if not exists (
      select 1 from public.service_agendas where service_id = new.service_id and agenda_id = new.agenda_id
    ) then
      raise exception 'Este serviço não é atendido nesta agenda.' using errcode = 'P0001', hint = 'service_not_in_agenda';
    end if;
  end if;

  if tg_op = 'INSERT' or new.service_id is distinct from old.service_id then
    select s.scheduling_mode = 'group', s.category = 'exam'
      into new.is_group_session, new.is_exam
      from public.services s where s.id = new.service_id;
  end if;

  if tg_op = 'INSERT' then
    if new.price_cents is null then
      new.price_cents := app.service_price(new.service_id, new.location_id);
    end if;
    if new.insurance_plan_id is null then
      new.insurance_plan_id := (select insurance_plan_id from public.patients where id = new.patient_id);
    end if;
  elsif new.service_id is distinct from old.service_id or new.location_id is distinct from old.location_id then
    new.price_cents := app.service_price(new.service_id, new.location_id);
  end if;

  return new;
end
$$;

-- Trava de horário por agenda (D2), agora sem os exames.
alter table public.appointments drop constraint appointments_no_overlap;
alter table public.appointments add constraint appointments_no_overlap exclude using gist (
  agenda_id with =,
  app.appointment_period(scheduled_at, duration_minutes) with &&
) where (status in ('scheduled', 'confirmed') and not is_exam);
