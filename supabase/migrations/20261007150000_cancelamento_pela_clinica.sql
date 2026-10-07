-- F6.5 — Cancelamento pela clínica com aviso automático pelo WhatsApp e o
-- link de remarcação (cliente, 07/out/2026): template próprio.
alter table public.whatsapp_templates drop constraint whatsapp_templates_template_key_check;
alter table public.whatsapp_templates add constraint whatsapp_templates_template_key_check check (template_key in (
  'confirmation',
  'confirmation_return',
  'reschedule',
  'cancellation',
  'clinic_cancellation',
  'reminder',
  'exam_preparation',
  'waitlist_offer',
  'daily_summary_consultations',
  'daily_summary_exams',
  'daily_summary_consultations_today',
  'daily_summary_exams_today'
));
