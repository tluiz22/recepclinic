-- F3f (bot enxuto, seção 15.6 do implementacao-recepcao-digital.md; aprovada pelo cliente em 11/nov/2026):
-- dois propósitos novos do link do portal.
--   professionals: "👥 Profissionais" do menu do bot (BE-3) abre a página Profissionais, valores e convênios.
--   cancel: "Cancelar ↗" do lembrete novo (BE-10) abre o portal já no cancelamento daquela consulta.
-- Sem mudança de dados.

alter table public.portal_links drop constraint portal_links_purpose_check;
alter table public.portal_links add constraint portal_links_purpose_check
  check (purpose in ('book', 'return', 'exam', 'reschedule', 'my_appointments', 'professionals', 'cancel'));
alter table public.portal_links add constraint portal_links_cancel_needs_appointment
  check (purpose <> 'cancel' or appointment_id is not null);
