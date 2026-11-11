-- Aviso ao outro responsável (VR4, D14; textos aprovados pelo cliente em 11/nov/2026; migração aprovada no mesmo dia).
-- Dois modelos novos da Meta: quem marcou recebe o aviso quando outro responsável remarca ou cancela a consulta.
-- Só acrescenta as chaves à lista que whatsapp_templates aceita.
--
-- Reversão: recriar a lista como em 20270104120000 (sem 'rescheduled_by_other' e 'canceled_by_other'), depois de apagar
-- as linhas dessas chaves.

alter table public.whatsapp_templates drop constraint whatsapp_templates_template_key_check;
alter table public.whatsapp_templates add constraint whatsapp_templates_template_key_check check (template_key in (
  'confirmation', 'confirmation_return', 'reschedule', 'cancellation', 'clinic_cancellation', 'reminder',
  'exam_preparation', 'exam_preparation_file', 'consultation_guidance', 'waitlist_offer',
  'daily_summary_consultations', 'daily_summary_exams', 'daily_summary_consultations_today', 'daily_summary_exams_today',
  'nfse_document', 'connection_test', 'conversation_resume', 'portal_code',
  'rescheduled_by_other', 'canceled_by_other'
));
