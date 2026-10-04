-- Botão "Reenviar preparo do exame" (ajuste de 02/out/2026): novo tipo de
-- evento na trilha, `preparation_resent`, com quem reenviou.
--
-- Decisão do cliente: um botão por tipo de envio — o preparo com falha ganha
-- reenvio próprio (só o preparo), e o "Reenviar lembrete" fica só para o
-- lembrete.

alter table appointment_events
  drop constraint appointment_events_event_type_check;

alter table appointment_events
  add constraint appointment_events_event_type_check check (event_type in (
    'created',
    'rescheduled',
    'canceled',
    'presence_confirmed',
    'presence_unconfirmed',
    'attendance_recorded',
    'attendance_corrected',
    'message_not_sent',
    'reminder_resent',
    'preparation_resent'     -- botão "Reenviar preparo do exame"
  ));
