-- Fase 15 · etapa 1: log de eventos do funil de agendamento via WhatsApp.
--
-- Append-only: cada linha é um passo de uma "tentativa" (`session_id`) de um
-- fluxo do bot — do toque na opção do menu até o resultado final (etapa 2) e
-- os passos na página /agendar/[token] (etapa 3). `conversation_state`
-- continua guardando só o estado atual; o histórico fica aqui.
--
-- Abandono: uma tentativa sem evento de resultado é abandono na última etapa
-- alcançada — calculado na leitura (a maioria de quem some não volta a
-- escrever). Quando o bot percebe na hora (voltar ao menu, timeout de
-- inatividade), grava também um evento 'abandoned' com o motivo.

create table bot_funnel_events (
  id bigint generated always as identity primary key,
  session_id uuid not null,
  flow text not null check (flow in (
    'booking',         -- Consultas > Agendar consulta
    'return_booking',  -- Consultas > Agendar retorno
    'exam',            -- Exames > Marcar exame
    'cancel',          -- Consultas/Exames > Cancelar (categoria em metadata)
    'reschedule'       -- Consultas/Exames > Remarcar (categoria em metadata)
  )),
  -- 'started', o estado da conversa em que entrou (ex.: 'BOOK_LOCATION'),
  -- 'abandoned', e os resultados/passos da página das etapas seguintes.
  step text not null,
  source text not null default 'bot' check (source in ('bot', 'web')),
  guardian_phone text not null,
  guardian_id uuid references guardians (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index bot_funnel_events_flow_occurred_idx on bot_funnel_events (flow, occurred_at);
create index bot_funnel_events_session_idx on bot_funnel_events (session_id);

alter table bot_funnel_events enable row level security;

-- Gravação só pelo servidor (service role, que ignora RLS); o admin só lê.
create policy "authenticated read" on bot_funnel_events
  for select to authenticated
  using (auth.uid() is not null);

-- Tentativa em andamento na conversa (nulo fora de um fluxo).
alter table conversation_state
  add column funnel_session_id uuid,
  add column funnel_flow text;

-- Liga o link de agendar/remarcar à tentativa que o gerou (etapa 3).
alter table booking_links
  add column funnel_session_id uuid;
