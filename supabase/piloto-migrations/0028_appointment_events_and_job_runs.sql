-- Fase 22 · etapa 1: trilha de auditoria da agenda + execuções dos crons.
--
-- Ainda não é gravado por ninguém nesta etapa: os pontos da agenda entram na
-- etapa 2 e os crons na etapa 3. As colunas de autoria da Fase 17
-- (`created_by`, `rescheduled_*`, `canceled_*`, `patient_confirmed_*`)
-- continuam — nada que funciona hoje muda.

-- ---------------------------------------------------------------------
-- appointment_events
-- ---------------------------------------------------------------------
-- Append-only: uma linha por ação sobre um atendimento. Mensagens enviadas
-- (e o status enviada/entregue/lida/falhou da Meta) NÃO são duplicadas aqui
-- — a trilha lê de `whatsapp_messages`, que já tem `appointment_id`. Aqui só
-- entra o que não gera mensagem: ações da agenda, envio automático que não
-- aconteceu (+ motivo) e reenvio manual do lembrete.
create table appointment_events (
  id bigint generated always as identity primary key,
  appointment_id uuid not null references appointments (id) on delete cascade,
  event_type text not null check (event_type in (
    'created',               -- marcado
    'rescheduled',           -- details: { from, to } (scheduled_at antigo → novo)
    'canceled',
    'presence_confirmed',
    'presence_unconfirmed',  -- presença desfeita pela tela
    'attendance_recorded',   -- details: { status: 'completed' | 'no_show' }
    'attendance_corrected',  -- details: { from, to }
    'message_not_sent',      -- details: { kind, reason } (ex.: reminder / no_phone)
    'reminder_resent'        -- botão "Reenviar lembrete"
  )),
  -- Login de quem fez pela tela; nulo = WhatsApp ou o próprio sistema.
  actor_id uuid references auth.users (id) on delete set null,
  channel text not null check (channel in (
    'admin',           -- tela do admin
    'whatsapp_bot',    -- conversa do bot (inclui o botão do lembrete)
    'booking_link',    -- página /agendar/[token]
    'cron',            -- envios automáticos
    'mass_cancel',     -- cancelamento em massa de um dia (Fase 12)
    'schedule_block'   -- bloqueio de agenda cancelando atendimentos (Fase 13)
  )),
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index appointment_events_appointment_idx
  on appointment_events (appointment_id, occurred_at);

-- "Não enviado" recente para o alerta do Dashboard (etapa 5).
create index appointment_events_not_sent_idx
  on appointment_events (occurred_at)
  where event_type = 'message_not_sent';

alter table appointment_events enable row level security;

-- As ações da tela gravam com o login da secretária/médica (cliente
-- autenticado); o bot e os crons, com a service role (ignora RLS). Só leitura
-- e inserção: sem update/delete, a trilha não se reescreve.
create policy "authenticated read" on appointment_events
  for select to authenticated
  using (auth.uid() is not null);

create policy "authenticated insert" on appointment_events
  for insert to authenticated
  with check (auth.uid() is not null);

-- ---------------------------------------------------------------------
-- job_runs
-- ---------------------------------------------------------------------
-- Uma linha por execução de cron, gravada inclusive quando não há nada para
-- enviar — distingue "não rodou" de "rodou e não tinha ninguém". Aberta como
-- 'running' no início e fechada com 'ok'/'error' no fim; uma linha que fica
-- em 'running' = execução que caiu no meio (timeout).
create table job_runs (
  id bigint generated always as identity primary key,
  job text not null check (job in ('appointment_reminders', 'daily_summary')),
  -- Resumo diário: 'preview' (véspera) ou 'final' (manhã). Nulo no lembrete.
  variant text check (variant in ('preview', 'final')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'error')),
  error_message text,
  -- Totais da execução, ex.: { sent, failed, not_sent, skipped }.
  totals jsonb not null default '{}'::jsonb
);

create index job_runs_job_started_idx on job_runs (job, started_at desc);

alter table job_runs enable row level security;

-- Gravação só pelos crons (service role); o admin só lê.
create policy "authenticated read" on job_runs
  for select to authenticated
  using (auth.uid() is not null);
