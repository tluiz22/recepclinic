-- Fase 25 · etapa 1: lista de espera para encaixe/antecipação.
--
-- Quem já tem atendimento marcado entra na lista pelo bot (Consultas/Exames ›
-- "Encaixe ou antecipar atendimento"). Quando um horário abre (cancelamento
-- ou remarcação individual, ou a antecipação de alguém da lista), a vaga é
-- oferecida a um por vez, por ordem de entrada, com 60 minutos para
-- responder; "Sim" remarca na hora. Mesmo tipo (consulta, retorno, mesmo
-- exame); consulta e retorno no consultório aceitam qualquer clínica,
-- domiciliar só domiciliar.
--
-- Nada é lido/gravado pelo app nesta etapa: o bot entra na etapa 2, o motor
-- de ofertas e a rota do agendador na etapa 3, a tela na etapa 5.

-- ---------------------------------------------------------------------
-- waitlist_entries — quem está na fila
-- ---------------------------------------------------------------------
-- Uma linha por atendimento que pediu antecipação. Tipo e local não são
-- copiados: valem os do atendimento no momento de cada oferta (remarcar por
-- conta própria mantém na lista com o horário novo). A posição na fila é a
-- ordem de `created_at`; recusar ou não responder não muda a posição.
create table waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments (id) on delete cascade,
  status text not null default 'active' check (status in (
    'active',     -- na fila
    'advanced',   -- aceitou uma vaga (antecipado)
    'left',       -- saiu pelo bot ("Sair da lista")
    'removed',    -- retirado pela tela (secretária/médica)
    'closed'      -- saiu sozinho: atendimento aconteceu, foi cancelado etc.
  )),
  created_via text not null default 'whatsapp_bot' check (created_via in ('whatsapp_bot', 'booking_link')),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  -- Ex.: 'canceled', 'completed', 'no_show', 'past' (status 'closed').
  ended_reason text,
  -- Login de quem retirou pela tela; nulo nos demais casos.
  ended_by uuid references auth.users (id) on delete set null
);

-- No máximo uma entrada ativa por atendimento.
create unique index waitlist_entries_active_appointment_idx
  on waitlist_entries (appointment_id)
  where status = 'active';

create index waitlist_entries_active_queue_idx
  on waitlist_entries (created_at)
  where status = 'active';

alter table waitlist_entries enable row level security;

-- O bot e o agendador gravam com a service role (ignora RLS); a tela lê e
-- retira da lista com o login da secretária/médica.
create policy "authenticated full access" on waitlist_entries
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- ---------------------------------------------------------------------
-- waitlist_offers — vagas oferecidas
-- ---------------------------------------------------------------------
-- Uma linha por oferta feita a uma pessoa da fila. A vaga é identificada
-- pelo horário/local que abriu (`slot_*`) e pelo atendimento cuja saída
-- abriu o horário (`opened_by_appointment_id`); as ofertas da mesma vaga
-- formam a sequência "um por vez" — quem já recebeu essa vaga é pulado.
create table waitlist_offers (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references waitlist_entries (id) on delete cascade,
  -- Atendimento de quem recebe a oferta (o que seria antecipado).
  appointment_id uuid not null references appointments (id) on delete cascade,
  opened_by_appointment_id uuid references appointments (id) on delete set null,
  slot_scheduled_at timestamptz not null,
  slot_clinic_location_id uuid not null references clinic_locations (id),
  slot_duration_minutes integer not null,
  status text not null default 'pending' check (status in (
    'pending',    -- aguardando resposta (até expires_at)
    'accepted',   -- "Sim": atendimento remarcado para a vaga
    'declined',   -- "Não"
    'expired',    -- 60 min sem resposta
    'withdrawn'   -- vaga deixou de valer antes da resposta (ocupada, < 2h etc.)
  )),
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  -- Mensagem enviada (template ou texto livre na janela de 24h).
  whatsapp_message_id text,
  -- Ex.: motivo do 'withdrawn'.
  details jsonb not null default '{}'::jsonb
);

-- Uma oferta em aberto por vez para cada vaga, e por pessoa da fila.
create unique index waitlist_offers_pending_slot_idx
  on waitlist_offers (slot_clinic_location_id, slot_scheduled_at, opened_by_appointment_id)
  where status = 'pending';

create unique index waitlist_offers_pending_entry_idx
  on waitlist_offers (entry_id)
  where status = 'pending';

-- Ofertas a vencer (agendador de 5 em 5 minutos).
create index waitlist_offers_pending_expires_idx
  on waitlist_offers (expires_at)
  where status = 'pending';

create index waitlist_offers_entry_idx on waitlist_offers (entry_id, offered_at);

alter table waitlist_offers enable row level security;

create policy "authenticated read" on waitlist_offers
  for select to authenticated
  using (auth.uid() is not null);

-- ---------------------------------------------------------------------
-- Link de agendar: entrar na lista ao confirmar
-- ---------------------------------------------------------------------
-- Quem pede antecipação sem ter nada marcado recebe o link para marcar no
-- primeiro horário livre; ao confirmar pela página, o atendimento já entra
-- na lista.
alter table booking_links
  add column join_waitlist boolean not null default false;

-- ---------------------------------------------------------------------
-- Trilha (Fase 22): entrada, saída e antecipação
-- ---------------------------------------------------------------------
alter table appointment_events
  drop constraint appointment_events_event_type_check;

alter table appointment_events
  add constraint appointment_events_event_type_check check (event_type in (
    'created',
    'rescheduled',
    'canceled',
    'presence_confirmed',
    'presence_unconfirmed',
    'attendance_recorded',
    'attendance_corrected',
    'message_not_sent',
    'reminder_resent',
    'preparation_resent',
    'waitlist_joined',       -- entrou na lista de espera
    'waitlist_left',         -- details: { reason } (saiu pelo bot, retirado pela tela, encerrado)
    'waitlist_advanced'      -- "Antecipado pela lista de espera"; details: { from, to }
  ));

-- ---------------------------------------------------------------------
-- Estados novos do bot
-- ---------------------------------------------------------------------
-- WAITLIST_SELECT: escolher qual atendimento antecipar (quando há mais de um).
-- WAITLIST_LEAVE_CONFIRM: já está na lista — "Sair da lista" ou manter.
-- A resposta à oferta vem por botão e vale em qualquer estado (como o
-- lembrete), sem estado próprio.
alter table conversation_state drop constraint conversation_state_state_check;
alter table conversation_state add constraint conversation_state_state_check
  check (state in (
    'WELCOME',
    'MENU',
    'CONSULTAS_MENU',
    'EXAMES_MENU',
    'BOOK_MODALITY',
    'BOOK_LOCATION',
    'BOOK_HOME_ADDRESS',
    'BOOK_PATIENT_SELECT',
    'BOOK_PATIENT_NEW',
    'BOOK_AGE_LIMIT',
    'BOOK_SLOT_SELECT',
    'BOOK_CONFIRM',
    'EXAM_TYPE_SELECT',
    'EXAM_FOR_WHOM',
    'CANCEL_SELECT',
    'CANCEL_CONFIRM',
    'RESCHEDULE_SELECT',
    'RESCHEDULE_HOME_ADDRESS',
    'RESCHEDULE_CONFIRM',
    'WAITLIST_SELECT',
    'WAITLIST_LEAVE_CONFIRM',
    'INFO_MENU',
    'INFO_PREP_SELECT',
    'HUMAN_HANDOFF'
  ));

-- ---------------------------------------------------------------------
-- Agendador: vencer ofertas e passar a vaga ao próximo (de 5 em 5 minutos)
-- ---------------------------------------------------------------------
-- Mesma função e segredos do Vault das migrações 0029/0030. A rota só passa
-- a existir na etapa 3 — até lá a chamada responde 404, sem efeito.
-- ~288 chamadas/dia, dentro dos planos gratuitos. Um "Não" passa para o
-- próximo na hora, sem esperar este job.
select cron.schedule(
  'lista-de-espera-ofertas',
  '*/5 * * * *',
  $$ select internal.call_cron_route('/api/cron/waitlist-offers?trigger=scheduled') $$
);
