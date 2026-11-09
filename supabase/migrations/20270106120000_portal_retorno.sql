-- F2d da recepção digital (09/nov/2026): marcar o retorno pelo portal (D4, seção 8 do plano).
--   A reserva guarda a consulta de origem do retorno (escolhida em "De qual consulta é o retorno?"): o paciente e o
--   médico vêm dela, e a marcação liga o retorno a ela (`appointments.origin_appointment_id`), como no bot.
-- Tudo pela credencial limitada à clínica (clinic_service), só nas reservas dela (política da F2c).
--
-- Reversão: `alter table public.slot_holds drop column return_origin_id;` (o índice e o grant caem junto).

alter table public.slot_holds
  add column return_origin_id uuid references public.appointments (id) on delete set null;

-- A exclusão de um atendimento procura as reservas ligadas a ele (chave estrangeira).
create index slot_holds_return_origin_idx on public.slot_holds (return_origin_id) where return_origin_id is not null;

grant update (return_origin_id) on public.slot_holds to clinic_service;
