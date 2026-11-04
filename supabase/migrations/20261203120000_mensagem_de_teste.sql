-- IS2 Mensagem de teste (cliente, 03/nov/2026; docs/implantacao-segura.md): o
-- modelo novo `connection_test` (rc_teste_envio_v1) confirma que o WhatsApp da
-- clínica entrega mensagens automáticas (cartão na Meta e template aprovado)
-- antes de ativar a clínica. Só a lista de modelos aceitos muda.
--
-- Reversão: a mesma restrição sem 'connection_test' (apagar antes as linhas
-- desse modelo).

alter table public.whatsapp_templates drop constraint whatsapp_templates_template_key_check;
alter table public.whatsapp_templates add constraint whatsapp_templates_template_key_check check (template_key in (
  'confirmation', 'confirmation_return', 'reschedule', 'cancellation', 'clinic_cancellation', 'reminder',
  'exam_preparation', 'exam_preparation_file', 'consultation_guidance', 'waitlist_offer',
  'daily_summary_consultations', 'daily_summary_exams', 'daily_summary_consultations_today', 'daily_summary_exams_today',
  'nfse_document', 'connection_test'
));
