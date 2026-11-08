-- Horários que saem com o serviço (cliente, 08/nov/2026): desativar um serviço
-- desativa os horários só dele (service_id), marcados aqui; reativar o serviço
-- reativa só esses (os que já estavam desativados antes continuam desativados).
-- Reativar o horário pela tela de Horários (ou trocar o serviço dele) tira a marca.

alter table public.availability_windows
  add column off_with_service boolean not null default false;

comment on column public.availability_windows.off_with_service is
  'Desativado junto com o serviço; volta quando o serviço for reativado.';
