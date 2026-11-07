-- Bloqueio de clínica suspensa (F12.3b) na tabela de eventos do atendimento humano
-- (CA, `handoff_events`, que veio da main em 05/nov/2026): toda tabela com clinic_id
-- precisa do gatilho (o teste `suspensao-banco` confere). Como no checklist de
-- implantação (20261207120000): recriar deixa banco novo e banco existente iguais.

drop trigger if exists handoff_events_guard_suspended on public.handoff_events;
create trigger handoff_events_guard_suspended
  before insert or update or delete on public.handoff_events
  for each row execute function app.guard_suspended_clinic_write();
