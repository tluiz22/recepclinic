-- ---------------------------------------------------------------------------
-- Horários de serviço desativado antes da regra de 08/nov (cliente, 10/nov/2026)
-- ---------------------------------------------------------------------------
-- Desde 08/nov (20270101120000), desativar um serviço desativa os horários só
-- dele, marcados com off_with_service (voltam se o serviço for reativado). Os
-- serviços desativados antes disso ficaram com os horários ligados: não abrem
-- vaga, mas aparecem ligados em Configurações › Horários (no staging, a Consulta
-- Domiciliar de 08/out, desativada em 31/out, com seg e qua das 14h às 16h).
--
-- Decisão do cliente: aplicar a regra a esses dados, em todas as clínicas. Os
-- horários ativos só de um serviço desativado ficam desativados e marcados como
-- "saíram com o serviço". Sem gatilhos: não é edição de horário pela tela.
--
-- Reversão: update public.availability_windows set is_active = true,
-- off_with_service = false where (os ids gravados antes de aplicar).

alter table public.availability_windows disable trigger user;

update public.availability_windows w
   set is_active = false,
       off_with_service = true
  from public.services s
 where s.id = w.service_id
   and s.clinic_id = w.clinic_id
   and not s.is_active
   and w.is_active;

alter table public.availability_windows enable trigger user;
