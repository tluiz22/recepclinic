-- Retorno só de uma consulta que já começou (cliente, 05/out/2026): o
-- retorno é marcado na data e hora de início da consulta de origem ou
-- depois, e do mesmo paciente. Vale para tudo (painel, bot, link); o painel
-- continua deixando a equipe marcar retorno sem consulta de origem, com aviso,
-- e o bot impede (regras da Fase 17).
create function app.check_return_origin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin record;
begin
  if new.origin_appointment_id is null then
    return new;
  end if;
  select patient_id, scheduled_at into v_origin
    from public.appointments
   where clinic_id = new.clinic_id and id = new.origin_appointment_id;
  if v_origin.patient_id is distinct from new.patient_id then
    raise exception 'O retorno precisa ser de uma consulta do mesmo paciente.' using errcode = 'P0001', hint = 'return_origin';
  end if;
  if new.scheduled_at < v_origin.scheduled_at then
    raise exception 'O retorno precisa ser depois do início da consulta de origem.' using errcode = 'P0001', hint = 'return_origin';
  end if;
  return new;
end
$$;

create trigger appointments_check_return_origin
  before insert or update of origin_appointment_id, scheduled_at, patient_id on public.appointments
  for each row execute function app.check_return_origin();
