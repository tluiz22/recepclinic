-- F5.4 — Link de remarcação ligado ao atendimento cancelado pela clínica
-- (bloqueio e cancelamento em massa): a tela "Avisar" põe o link na mensagem
-- de cada cancelado (cliente, 06/out/2026). Nulo nos links do bot.
alter table public.booking_links
  add column canceled_appointment_id uuid,
  add foreign key (clinic_id, canceled_appointment_id) references public.appointments (clinic_id, id);

create index booking_links_canceled_appointment_idx on public.booking_links (canceled_appointment_id)
  where canceled_appointment_id is not null;
