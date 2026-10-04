-- Fase 17 · etapa 4: link de reagendamento gerado pela própria clínica
-- (cancelamento em massa / bloqueio de agenda, Fases 12/13) para um
-- retorno cancelado. O link continua vinculado à Consulta de origem (o
-- retorno novo conta como "o" retorno dela), mas sem o limite de datas do
-- prazo — o cancelamento foi da clínica, a família não perde o direito
-- por isso (decisão do cliente).
alter table booking_links
  add column return_deadline_waived boolean not null default false;
