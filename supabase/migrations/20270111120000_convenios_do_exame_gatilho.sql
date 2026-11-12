-- ---------------------------------------------------------------------------
-- Convênios de cada exame: correção do gatilho do "Particular" (CE-3, 11/nov/2026)
-- ---------------------------------------------------------------------------
-- Em 20270110140000, a condição juntava "current_user = 'authenticated'" e
-- app.can_manage_insurance num "and" só: o Postgres não garante a ordem, e quem
-- não pode executar a função (service_role, scripts e testes) recebia "permission
-- denied". Agora a permissão só é consultada no update pela tela.
--
-- Reversão: a versão de 20270110140000.

create or replace function app.guard_service_accepts_private()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.accepts_private is distinct from old.accepts_private and current_user = 'authenticated' then
    if not coalesce(app.can_manage_insurance(new.clinic_id), false) then
      raise exception 'Sem permissão para mudar os convênios do exame.' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
