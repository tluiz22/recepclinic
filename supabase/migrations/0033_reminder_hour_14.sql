-- Lembrete às 14h para os atendimentos do dia seguinte (ajuste de 02/out/2026).
--
-- Decisão do cliente: o horário do lembrete continua configurável na tela
-- Envios (7h às 20h), com 14h como padrão; o lembrete passa a ir para todos
-- os atendimentos do dia seguinte (00:00 às 23:59, Fortaleza), não mais para
-- a janela das próximas 26h. A janela é calculada na rota
-- `/api/cron/appointment-reminders`; aqui só muda o horário.

alter table appointment_settings
  alter column reminder_hour set default 14;

update appointment_settings
  set reminder_hour = 14, updated_at = now()
  where id = 1;
