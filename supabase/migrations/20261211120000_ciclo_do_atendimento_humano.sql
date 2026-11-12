-- CA — Ciclo de vida do atendimento humano (cliente, 04/nov/2026; docs/arquivo/modulos/ciclo-atendimento-humano.md).
--
-- A situação da conversa com a clínica passa a ser guardada (antes era calculada pela última mensagem):
--   waiting_clinic   "Aguardando a clínica": o paciente pediu ou escreveu, e a clínica precisa agir;
--   in_progress      "Em atendimento": a clínica respondeu pelo app.
-- Só duas situações (cliente, 04/nov/2026: com dezenas de conversas, três confundiriam).
-- O bot continua desligado só pelo human_handoff. Cada mudança de responsável ou de situação vira um evento em
-- handoff_events (gatilho, na mesma operação: sem mudança, sem evento), separado do histórico de mensagens.

alter table public.conversation_state
  add column handoff_status text check (handoff_status in ('waiting_clinic', 'in_progress')),
  -- Hora da última mudança (de situação ou de responsável): a rotina de 12 h confere que nada mudou antes de encerrar.
  add column handoff_status_at timestamptz,
  -- Um id por atendimento (da pausa até a volta ao bot), para os indicadores.
  add column handoff_id uuid,
  -- Quem fez a última mudança: o paciente, a recepção, o sistema (rotina) ou o bot.
  add column handoff_changed_by text check (handoff_changed_by in ('patient', 'reception', 'system', 'bot'));

-- Fim da pausa apaga os dados dela (menos a hora e o autor da mudança, que o evento usa); pausa nova começa em
-- "Aguardando a clínica", com id próprio.
create or replace function app.conversation_handoff_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not new.human_handoff then
    new.human_handoff_at := null;
    new.handoff_reason := null;
    new.handoff_started_at := null;
    new.handoff_notified_at := null;
    new.handoff_reminded_at := null;
    new.handoff_subject := null;
    new.handoff_subject_asked_at := null;
    new.handoff_status := null;
    new.handoff_id := null;
  else
    if new.human_handoff_at is null then
      new.human_handoff_at := now();
    end if;
    if new.handoff_started_at is null then
      new.handoff_started_at := new.human_handoff_at;
    end if;
    if new.handoff_status is null then
      new.handoff_status := 'waiting_clinic';
    end if;
    if new.handoff_id is null then
      new.handoff_id := gen_random_uuid();
    end if;
  end if;
  -- Mudou a situação ou o responsável sem a hora informada: agora.
  if tg_op = 'INSERT' then
    if new.handoff_status_at is null and new.human_handoff then
      new.handoff_status_at := new.handoff_started_at;
    end if;
  elsif (old.human_handoff is distinct from new.human_handoff or old.handoff_status is distinct from new.handoff_status)
        and new.handoff_status_at is not distinct from old.handoff_status_at then
    new.handoff_status_at := now();
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Eventos do atendimento humano
-- ---------------------------------------------------------------------------
create table public.handoff_events (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  contact_phone text not null,
  contact_id uuid,
  handoff_id uuid,
  -- 'bot' = o bot responde; as outras, a situação com a clínica.
  from_status text not null check (from_status in ('bot', 'waiting_clinic', 'in_progress')),
  to_status text not null check (to_status in ('bot', 'waiting_clinic', 'in_progress')),
  origin text not null check (origin in ('patient', 'reception', 'system', 'bot')),
  -- Usuário da tela (Finalizar atendimento); nulo para o paciente, o bot, a rotina e o app.
  actor_id uuid references auth.users (id) on delete set null,
  occurred_at timestamptz not null default now(),
  foreign key (clinic_id, contact_id) references public.contacts (clinic_id, id) on delete set null (contact_id)
);

create index handoff_events_clinic_idx on public.handoff_events (clinic_id, occurred_at);
create index handoff_events_handoff_idx on public.handoff_events (handoff_id);

-- A equipe lê; só o banco grava (gatilho abaixo).
select app.enable_clinic_service_written_rls('public.handoff_events');

-- ---------------------------------------------------------------------------
-- Carga: as conversas com a clínica hoje, pela regra de antes (última mensagem; cortesia não conta, C27)
-- ---------------------------------------------------------------------------
with paused as (
  select id, clinic_id, contact_phone, coalesce(handoff_started_at, human_handoff_at, now()) as started
    from public.conversation_state
   where human_handoff
),
agent as (
  select p.id, max(m.created_at) as last_agent
    from paused p
    join public.whatsapp_messages m
      on m.clinic_id = p.clinic_id and m.contact_phone = p.contact_phone
     and m.message_type = 'agent_reply' and m.created_at >= p.started
   group by p.id
),
unanswered as (
  select p.id, min(m.created_at) as first_unanswered
    from paused p
    join agent a on a.id = p.id
    join public.whatsapp_messages m
      on m.clinic_id = p.clinic_id and m.contact_phone = p.contact_phone
     and m.direction = 'inbound' and m.message_type <> 'courtesy' and m.created_at > a.last_agent
   group by p.id
)
update public.conversation_state c
   set handoff_status = case when a.last_agent is null or u.first_unanswered is not null then 'waiting_clinic' else 'in_progress' end,
       handoff_status_at = case
         when a.last_agent is null then p.started
         when u.first_unanswered is not null then u.first_unanswered
         else a.last_agent
       end,
       handoff_id = gen_random_uuid()
  from paused p
  left join agent a on a.id = p.id
  left join unanswered u on u.id = p.id
 where c.id = p.id;

-- ---------------------------------------------------------------------------
-- Gatilho dos eventos (depois da carga, que não é um evento)
-- ---------------------------------------------------------------------------
create function app.conversation_handoff_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text := case when tg_op = 'INSERT' or not old.human_handoff then 'bot' else old.handoff_status end;
  v_to text := case when new.human_handoff then new.handoff_status else 'bot' end;
begin
  if v_from is not distinct from v_to then
    return null;
  end if;
  insert into public.handoff_events (clinic_id, contact_phone, contact_id, handoff_id, from_status, to_status, origin, actor_id, occurred_at)
  values (
    new.clinic_id,
    new.contact_phone,
    new.contact_id,
    coalesce(new.handoff_id, case when tg_op = 'UPDATE' then old.handoff_id end),
    coalesce(v_from, 'waiting_clinic'),
    v_to,
    coalesce(new.handoff_changed_by, 'system'),
    (select auth.uid()),
    coalesce(new.handoff_status_at, now())
  );
  return null;
end
$$;

create trigger conversation_state_handoff_event after insert or update on public.conversation_state
  for each row execute function app.conversation_handoff_event();
