-- Prazo para remarcar e cancelar pelo portal (RD10 revista na validação da F3, cliente, 10/nov/2026): o padrão passa de
-- 24 h para 0 h (sem prazo; o paciente remarca e cancela a qualquer hora). A clínica que quiser um prazo põe em
-- Configurações › Portal. As clínicas que já existem também passam para 0 h (decisão do cliente).
-- Reversão: `set default 24` (e voltar a 24 as clínicas, se for o caso).
alter table public.clinic_settings alter column portal_cancel_lead_hours set default 0;
update public.clinic_settings set portal_cancel_lead_hours = 0 where portal_cancel_lead_hours <> 0;
