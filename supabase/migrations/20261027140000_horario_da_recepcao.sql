-- F8.5b — Horário da recepção (cliente, 27/out/2026): quando a clínica atende
-- pelo WhatsApp. Liga e desliga as notificações do atendimento humano (F8.5c)
-- e diz ao paciente quando a clínica responde (F8.5d). Um intervalo por dia da
-- semana (0 = domingo … 6 = sábado), sem os feriados da clínica.
--
-- Nulo = ainda não salvo: vale o sugerido pelos horários das agendas (o
-- primeiro e o último horário de cada dia), calculado pela aplicação.
-- Formato: lista de 7 posições, cada uma nula (fechada) ou
-- {"open": "HH:MM", "close": "HH:MM"}; a aplicação confere os horários.
alter table public.clinic_settings
  add column reception_hours jsonb
    check (reception_hours is null or (jsonb_typeof(reception_hours) = 'array' and jsonb_array_length(reception_hours) = 7));
