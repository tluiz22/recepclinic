-- Fase 21 · etapa 1: paciente adulto no exame + idade limite para consulta.

-- Paciente que é o próprio responsável (adulto marcando exame para si).
-- Fica ligado ao seu próprio cadastro de responsável: lembrete, confirmação,
-- bot e cancelamento continuam indo para o telefone do responsável. Ainda
-- não é lido/gravado nesta etapa (entra nas etapas 3 e 5).
alter table patients
  add column is_guardian_self boolean not null default false;

-- No máximo um paciente "próprio responsável" por responsável.
create unique index patients_one_guardian_self_per_guardian_idx
  on patients (guardian_id)
  where is_guardian_self;

-- Idade (em anos) a partir da qual o paciente não pode mais marcar
-- Consulta: pode marcar até completar essa idade (idade < limite). Não vale
-- para Retorno nem Exame. Editável em Configurações > Duração.
alter table appointment_settings
  add column consultation_age_limit_years integer not null default 14
    check (consultation_age_limit_years > 0);
