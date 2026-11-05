-- Bloqueio de clínica suspensa (F12.3b) na tabela de falhas de envio descartadas
-- (FE, `send_failure_dismissals`, que veio da main em 05/nov/2026): toda tabela com clinic_id
-- precisa do gatilho (o teste `suspensao-banco` confere). Mesmo modelo da 20261212120000.

drop trigger if exists send_failure_dismissals_guard_suspended on public.send_failure_dismissals;
create trigger send_failure_dismissals_guard_suspended
  before insert or update or delete on public.send_failure_dismissals
  for each row execute function app.guard_suspended_clinic_write();
