-- Bloqueio de clínica suspensa (F12.3b) na tabela do checklist de implantação
-- (IS3, `clinic_onboarding_checks`, que veio da main em 03/nov/2026): toda
-- tabela com clinic_id precisa do gatilho (o teste `suspensao-banco` confere).
-- Num banco novo, a 20261119 roda antes da 20261204 e a tabela fica sem ele;
-- num banco que já tinha a tabela, a 20261119 já pôs o gatilho. Recriar deixa
-- os dois casos iguais.

drop trigger if exists clinic_onboarding_checks_guard_suspended on public.clinic_onboarding_checks;
create trigger clinic_onboarding_checks_guard_suspended
  before insert or update or delete on public.clinic_onboarding_checks
  for each row execute function app.guard_suspended_clinic_write();
