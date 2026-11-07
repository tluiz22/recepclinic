-- Nome das agendas e agenda da equipe automática (cliente, 06/nov/2026).
--
-- 1. A agenda de um profissional não tem mais nome próprio: é sempre o nome do profissional. Renomear o profissional
--    renomeia a agenda (antes, a agenda guardava o nome da criação e a Agenda, o link de agendamento e as mensagens
--    seguiam com o nome antigo). A da equipe continua sempre "Exames".
-- 2. A agenda da equipe ("Exames") segue o item "Exames e procedimentos" da Matriz: liberar o item cria a agenda (ou
--    reativa a que já existe, com os horários e os serviços de antes); tirar o item desativa a agenda.

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
  elsif new.professional_id is not null then
    new.name := coalesce((select p.display_name from public.professionals p where p.id = new.professional_id), new.name);
  end if;
  return new;
end
$$;

drop trigger agendas_check_team on public.agendas;

create trigger agendas_check_team
  before insert or update of is_active, name, professional_id on public.agendas
  for each row execute function app.check_team_agenda();

-- Renomear o profissional renomeia a agenda dele.
create function app.sync_professional_agenda_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.agendas
     set name = new.display_name
   where clinic_id = new.clinic_id
     and professional_id = new.id
     and kind = 'professional'
     and name is distinct from new.display_name;
  return null;
end
$$;

create trigger professionals_sync_agenda_name
  after update of display_name on public.professionals
  for each row execute function app.sync_professional_agenda_name();

-- Item "Exames e procedimentos": cria ou reativa a agenda da equipe ao liberar; desativa ao tirar.
create function app.sync_team_agenda_with_exams()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.feature_key <> 'exams' then return null; end if;
    update public.agendas set is_active = true where clinic_id = new.clinic_id and kind = 'resource' and not is_active;
    if not exists (select 1 from public.agendas where clinic_id = new.clinic_id and kind = 'resource') then
      insert into public.agendas (clinic_id, name, kind) values (new.clinic_id, 'Exames', 'resource');
    end if;
  else
    if old.feature_key <> 'exams' then return null; end if;
    update public.agendas set is_active = false where clinic_id = old.clinic_id and kind = 'resource' and is_active;
  end if;
  return null;
end
$$;

create trigger clinic_features_sync_team_agenda
  after insert or delete on public.clinic_features
  for each row execute function app.sync_team_agenda_with_exams();

-- As que já existem: agenda de profissional com o nome dele; clínica com o item e sem a agenda da equipe ganha a sua.
update public.agendas a
   set name = p.display_name
  from public.professionals p
 where p.id = a.professional_id
   and a.kind = 'professional'
   and a.name is distinct from p.display_name;

insert into public.agendas (clinic_id, name, kind)
select cf.clinic_id, 'Exames', 'resource'
  from public.clinic_features cf
 where cf.feature_key = 'exams'
   and not exists (select 1 from public.agendas a where a.clinic_id = cf.clinic_id and a.kind = 'resource');
