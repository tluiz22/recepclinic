-- Métricas › Agendamento digital deixa de depender do Bot de WhatsApp (cliente, 02/nov/2026):
-- o Suporte avalia a jornada no WhatsApp de cada clínica e libera a aba quando decidir.
-- Nenhuma liberação existente muda.
update public.features set depends_on = '{}' where key = 'metrics_funnel';
