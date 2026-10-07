-- F6.4 — Número em coexistência (app WhatsApp Business + API): só com ele a
-- recepção consegue responder o paciente, então o "Falar com a recepção" do
-- bot só aparece com esta marca (cliente, 07/out/2026). O Suporte marca na
-- conexão até a F8 (Embedded Signup com coexistência).
alter table public.whatsapp_connections
  add column coexistence boolean not null default false;

-- Leitura liberada coluna a coluna (o id do segredo fica de fora).
grant select (coexistence) on public.whatsapp_connections to authenticated, clinic_service;
