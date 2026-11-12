-- F3e-1 da recepção digital (10/nov/2026): atendimento domiciliar pelo portal (D5, seção 15.5 do plano).
--   A reserva guarda o endereço do atendimento em casa, informado depois do paciente (DM2b); a marcação o leva para
--   `appointments.home_visit_address` e para o endereço padrão do contato, como o bot. Texto só (rua e número,
--   complemento, bairro e ponto de referência juntos), até 500 caracteres.
-- Tudo pela credencial limitada à clínica (clinic_service), só nas reservas dela (política da F2c).
--
-- Reversão: `alter table public.slot_holds drop column home_visit_address;` (a restrição e o grant caem junto).

alter table public.slot_holds
  add column home_visit_address text
    constraint slot_holds_home_visit_address_length check (home_visit_address is null or char_length(home_visit_address) between 1 and 500);

grant update (home_visit_address) on public.slot_holds to clinic_service;
