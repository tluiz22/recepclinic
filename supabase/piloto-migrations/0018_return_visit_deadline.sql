-- Fase 17 · etapa 1: modelo de dados para o retorno com prazo.

-- Prazo (em dias, contados da Consulta de origem) em que o retorno pode
-- ser marcado. Editável em Configurações > Duração.
alter table appointment_settings
  add column return_visit_deadline_days integer not null default 30
    check (return_visit_deadline_days > 0);

-- Consulta (first_visit) que deu origem a este retorno. Nulo para
-- consultas, para retornos marcados antes desta fase e para exceções
-- marcadas pela tela sem vínculo. Ainda não é lido/gravado nesta etapa
-- (entra nas etapas 3–5).
alter table appointments
  add column origin_appointment_id uuid references appointments (id);

create index appointments_origin_appointment_id_idx
  on appointments (origin_appointment_id);

-- Mesmo vínculo no link de agendar/remarcar gerado pelo bot, copiado para
-- appointments.origin_appointment_id na confirmação pela página.
alter table booking_links
  add column origin_appointment_id uuid references appointments (id);
