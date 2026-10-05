-- RQE do profissional (Registro de Qualificação de Especialista), opcional;
-- quem tem mais de uma especialidade guarda os números separados por vírgula
-- (cliente, 05/out/2026). Ex.: "6271, 8890".
alter table public.professionals
  add column rqe text check (rqe is null or rqe ~ '^\d{1,10}(, \d{1,10})*$');
