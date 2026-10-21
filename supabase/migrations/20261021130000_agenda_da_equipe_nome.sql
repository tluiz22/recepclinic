-- Agenda da equipe (cliente, 21/out/2026): o nome é sempre "Exames", ao criar,
-- ao renomear e ao reativar. As que já existem passam a se chamar assim.

create or replace function app.check_team_agenda()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'resource' then
    new.name := 'Exames';
    if new.is_active and (tg_op = 'INSERT' or not old.is_active) then
      perform app.require_feature(new.clinic_id, 'exams');
    end if;
  end if;
  return new;
end
$$;

drop trigger agendas_check_team on public.agendas;

create trigger agendas_check_team
  before insert or update of is_active, name on public.agendas
  for each row execute function app.check_team_agenda();

update public.agendas set name = 'Exames' where kind = 'resource' and name <> 'Exames';
