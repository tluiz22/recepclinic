-- C7.2 Arquivo no preparo do exame (cliente, 28/out/2026): o modelo novo
-- `exam_preparation_file` (rc_preparo_arquivo_v1), com o arquivo no topo, sai
-- depois do preparo quando a conversa está fechada. Só a lista de modelos
-- aceitos muda.
--
-- Reversão: a mesma restrição sem 'exam_preparation_file' (apagar antes as
-- linhas desse modelo).

alter table public.whatsapp_templates drop constraint whatsapp_templates_template_key_check;
alter table public.whatsapp_templates add constraint whatsapp_templates_template_key_check check (template_key in (
  'confirmation', 'confirmation_return', 'reschedule', 'cancellation', 'clinic_cancellation', 'reminder',
  'exam_preparation', 'exam_preparation_file', 'consultation_guidance', 'waitlist_offer',
  'daily_summary_consultations', 'daily_summary_exams', 'daily_summary_consultations_today', 'daily_summary_exams_today',
  'nfse_document'
));
