-- Agendas (cliente, 21/out/2026): uma por profissional e no máximo uma da
-- equipe (a de recurso, "Exames": exames que não são feitos por um dos
-- profissionais cadastrados). A desativada também conta: reativa-se a antiga.
-- A da equipe só com o item "Exames e procedimentos" (D11) e só atende
-- serviços do tipo exame. Conferido no staging antes: nenhum dado fora da regra.

create unique index agendas_one_per_professional
  on public.agendas (clinic_id, professional_id)
  where kind = 'professional';

create unique index agendas_one_team_per_clinic
  on public.agendas (clinic_id)
  where kind = 'resource';

create function app.check_team_agenda()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'resource' and new.is_active and (tg_op = 'INSERT' or not old.is_active) then
    perform app.require_feature(new.clinic_id, 'exams');
  end if;
  return new;
end
$$;

create trigger agendas_check_team
  before insert or update of is_active on public.agendas
  for each row execute function app.check_team_agenda();

create function app.check_team_agenda_service()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.agendas where id = new.agenda_id and kind = 'resource')
     and exists (select 1 from public.services where id = new.service_id and category <> 'exam') then
    raise exception 'A agenda da equipe só atende serviços do tipo exame.'
      using errcode = 'P0001', hint = 'team_agenda_exam_only';
  end if;
  return new;
end
$$;

create trigger service_agendas_check_team
  before insert on public.service_agendas
  for each row execute function app.check_team_agenda_service();
