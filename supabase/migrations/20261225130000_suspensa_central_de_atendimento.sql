-- Bloqueio de clínica suspensa (F12.3b) nas tabelas da Central de Atendimento, que vieram da main em 06/nov/2026
-- (`central_switches`, `whatsapp_media`, `conversation_reads`, `conversation_access_log`, `whatsapp_history_events`):
-- toda tabela com clinic_id precisa do gatilho (o teste `suspensao-banco` confere). Mesmo modelo da 20261212120000.
-- O webhook e as rotinas (credencial da clínica) e o Suporte seguem gravando; o login da clínica suspensa, não. Na
-- clínica suspensa, a Central já fica fora do menu (AdminLayout).

drop trigger if exists central_switches_guard_suspended on public.central_switches;
create trigger central_switches_guard_suspended
  before insert or update or delete on public.central_switches
  for each row execute function app.guard_suspended_clinic_write();

drop trigger if exists whatsapp_media_guard_suspended on public.whatsapp_media;
create trigger whatsapp_media_guard_suspended
  before insert or update or delete on public.whatsapp_media
  for each row execute function app.guard_suspended_clinic_write();

drop trigger if exists conversation_reads_guard_suspended on public.conversation_reads;
create trigger conversation_reads_guard_suspended
  before insert or update or delete on public.conversation_reads
  for each row execute function app.guard_suspended_clinic_write();

drop trigger if exists conversation_access_log_guard_suspended on public.conversation_access_log;
create trigger conversation_access_log_guard_suspended
  before insert or update or delete on public.conversation_access_log
  for each row execute function app.guard_suspended_clinic_write();

drop trigger if exists whatsapp_history_events_guard_suspended on public.whatsapp_history_events;
create trigger whatsapp_history_events_guard_suspended
  before insert or update or delete on public.whatsapp_history_events
  for each row execute function app.guard_suspended_clinic_write();
