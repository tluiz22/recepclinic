-- CRM B0, migração 2 (aprovada pelo cliente em 28/out/2026). Só depois do
-- código da migração 1 publicado no mesmo ambiente (o código antigo lia o
-- body pelo login e quebraria).
--
-- 1. Apaga o texto já guardado das mensagens recebidas e das respostas da
--    recepção pelo app (o código novo já não grava). Não tem volta.
-- 2. O login (authenticated) lê e altera todas as colunas menos body e
--    retry_payload (o pedido do reenvio, com o texto); anon perde a leitura e
--    a alteração (o RLS já não deixava ver nada). O insert continua (o painel
--    grava os avisos e os reenvios). O bot e as rotinas (clinic_service), a
--    anonimização e as Métricas (security definer) não mudam.
--
-- Reversão: grant select, update on public.whatsapp_messages to anon, authenticated;
-- o texto apagado não volta.

update public.whatsapp_messages
   set body = null
 where body is not null
   and (direction = 'inbound' or message_type = 'agent_reply');

revoke select, update on public.whatsapp_messages from anon, authenticated;

grant select (
  id, clinic_id, appointment_id, contact_id, direction, message_type, template_name, status,
  wa_message_id, created_at, contact_phone, attempt, first_attempt_id, failure_code, failure_reason, retry_at
) on public.whatsapp_messages to authenticated;

grant update (status, message_type, appointment_id, retry_at, retry_payload, failure_code, failure_reason)
  on public.whatsapp_messages to authenticated;
