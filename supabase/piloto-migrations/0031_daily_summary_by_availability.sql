-- Fase 22 (ajuste de 30/set/2026): o resumo do dia da manhã deixa de sair às
-- 6h30 fixas e passa a sair 1h antes do início dos atendimentos do dia —
-- primeira janela da tela Disponibilidade daquele dia da semana (ou o
-- primeiro atendimento, se for mais cedo); sem janela no dia, 6h30 de
-- reserva. Consultas e exames são calculados de forma independente.
--
-- Como as janelas podem começar fora da hora cheia, o agendador chama a rota
-- a cada 5 minutos e ela decide se chegou a hora (`trigger=scheduled`).

-- Um registro por envio do resumo da manhã: trava "uma vez por dia e por
-- tipo" e guarda o primeiro horário informado à equipe. Se depois do envio
-- for marcado um atendimento antes dele (ou o dia estava vazio), a rota
-- reenvia o resumo atualizado e grava outro registro.
create table daily_summary_sends (
  id bigint generated always as identity primary key,
  summary_date date not null,
  kind text not null check (kind in ('consultas', 'exames')),
  first_scheduled_at timestamptz not null,
  sent_at timestamptz not null default now()
);

create index daily_summary_sends_date_kind_idx
  on daily_summary_sends (summary_date, kind, sent_at desc);

-- Só a service role (rota do agendador) lê e grava; nenhuma tela usa.
alter table daily_summary_sends enable row level security;

-- Mesmo nome = o pg_cron substitui o agendamento das 6h30 (migração 0030).
select cron.schedule(
  'resumo-do-dia-manha',
  '*/5 * * * *',
  $$ select internal.call_cron_route('/api/cron/daily-summary?send=final&trigger=scheduled') $$
);
