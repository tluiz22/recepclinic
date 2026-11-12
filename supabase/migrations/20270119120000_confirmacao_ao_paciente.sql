-- F3f E6 (BE-9, cliente 11/nov/2026): Configurações › Lembretes ganha "Confirmação ao paciente", com duas caixas
-- ligadas por padrão: confirmação das consultas marcadas pelo portal e das marcadas pela recepção.
alter table public.clinic_settings
  add column confirm_portal_booking boolean not null default true,
  add column confirm_reception_booking boolean not null default true;
