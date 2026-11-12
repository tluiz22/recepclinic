-- NA1 — Conversas que não são atendimento (cliente, 06/nov/2026; docs/arquivo/modulos/conversas-nao-atendimento.md, decisões 1 a 5).
--
-- A equipe marca o número como Pessoal ou Administrativo/outros: o número sai do bot, das métricas e dos pendentes.
-- Aditiva, sem tabela nova:
--   1. `conversation_state`: a classificação (patient | personal | administrative), quando e por quem.
--   2. Guarda: a classificação só muda pela função (a credencial do bot não marca); número marcado nunca fica com a
--      clínica (Aguardando/Em atendimento) nem com o responsável.
--   3. `set_conversation_classification`: só Administrador e Recepção; ao marcar, zera o estado do bot (começo, sem
--      contexto, tentativa do funil fechada como `classified`) e tira o atendimento aberto sem mensagem nenhuma; ao
--      voltar para atendimento, estado inicial, sem mensagem (a próxima mensagem segue as regras de hoje).
--   4. `handoff_events`: o evento `classified` (de/para, quem, quando), pelo gatilho que já existe; a marcação não
--      gera também o "finalizado".
--
-- Reversão: drop function public.set_conversation_classification; drop trigger conversation_state_a_classification_guard;
-- recriar app.conversation_handoff_event do 20261215120000; alter table handoff_events drop column classification_from,
-- classification_to (e a restrição do kind); alter table conversation_state drop column classification, classified_at,
-- classified_by.

-- ---------------------------------------------------------------------------
-- 1. Classificação da conversa
-- ---------------------------------------------------------------------------
alter table public.conversation_state
  add column classification text not null default 'patient' check (classification in ('patient', 'personal', 'administrative')),
  add column classified_at timestamptz,
  add column classified_by uuid references auth.users (id) on delete set null;

create index conversation_state_classified_idx on public.conversation_state (clinic_id) where classification <> 'patient';

comment on column public.conversation_state.classification is
  'NA: patient (atendimento, padrão) | personal | administrative. Marcado: sem bot, fora das métricas e dos pendentes.';

grant select (classification, classified_at, classified_by) on public.conversation_state to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Guarda (antes dos outros gatilhos: o nome começa por "a_")
-- ---------------------------------------------------------------------------
create function app.conversation_classification_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.conversation_classifying', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      new.classification := 'patient';
      new.classified_at := null;
      new.classified_by := null;
    elsif new.classification is distinct from old.classification
       or new.classified_at is distinct from old.classified_at
       or new.classified_by is distinct from old.classified_by then
      raise exception 'A classificação da conversa muda só pela tela (Administrador ou Recepção).' using errcode = '42501';
    end if;
  end if;
  -- Número marcado não fica com a clínica: o bot (toque de lembrete) ou o painel não abrem atendimento nele.
  if new.classification <> 'patient' then
    new.human_handoff := false;
    new.handoff_status := null;
  end if;
  return new;
end
$$;
create trigger conversation_state_a_classification_guard before insert or update on public.conversation_state
  for each row execute function app.conversation_classification_guard();

-- ---------------------------------------------------------------------------
-- 4. Eventos (antes da função, que dispara o gatilho)
-- ---------------------------------------------------------------------------
alter table public.handoff_events drop constraint handoff_events_kind_check;
alter table public.handoff_events
  add constraint handoff_events_kind_check check (kind in ('status', 'assigned', 'transferred', 'released', 'finished', 'classified')),
  add column classification_from text check (classification_from in ('patient', 'personal', 'administrative')),
  add column classification_to text check (classification_to in ('patient', 'personal', 'administrative'));

create or replace function app.conversation_handoff_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text := case when tg_op = 'INSERT' or not old.human_handoff then 'bot' else old.handoff_status end;
  v_to text := case when new.human_handoff then new.handoff_status else 'bot' end;
  v_old_assigned uuid := case when tg_op = 'UPDATE' then old.assigned_to end;
  v_status_changed boolean := v_from is distinct from v_to;
  v_assignment_changed boolean := v_old_assigned is distinct from new.assigned_to;
  v_kind text;
begin
  -- Marcada (ou de volta para atendimento): um evento só, com o de/para da classificação; o atendimento que estava
  -- aberto sai junto, sem o "finalizado".
  if tg_op = 'UPDATE' and old.classification is distinct from new.classification then
    insert into public.handoff_events (
      clinic_id, contact_phone, contact_id, handoff_id, from_status, to_status, origin, actor_id, occurred_at,
      kind, assigned_from, assigned_to, classification_from, classification_to
    )
    values (
      new.clinic_id, new.contact_phone, new.contact_id, old.handoff_id, coalesce(v_from, 'waiting_clinic'),
      coalesce(v_to, 'waiting_clinic'), 'reception', (select auth.uid()), coalesce(new.classified_at, now()),
      'classified', v_old_assigned, new.assigned_to, old.classification, new.classification
    );
    return null;
  end if;
  if not v_status_changed and not v_assignment_changed then
    return null;
  end if;
  v_kind := case
    when v_status_changed and v_to = 'bot' then 'finished'
    when v_status_changed then 'status'
    when v_old_assigned is null then 'assigned'
    when new.assigned_to is null then 'released'
    else 'transferred'
  end;
  insert into public.handoff_events (
    clinic_id, contact_phone, contact_id, handoff_id, from_status, to_status, origin, actor_id, occurred_at,
    kind, assigned_from, assigned_to
  )
  values (
    new.clinic_id,
    new.contact_phone,
    new.contact_id,
    coalesce(new.handoff_id, case when tg_op = 'UPDATE' then old.handoff_id end),
    coalesce(v_from, 'waiting_clinic'),
    coalesce(v_to, 'waiting_clinic'),
    coalesce(new.handoff_changed_by, 'system'),
    (select auth.uid()),
    case when v_status_changed then coalesce(new.handoff_status_at, now()) else now() end,
    v_kind,
    v_old_assigned,
    new.assigned_to
  );
  return null;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Marcar e desmarcar
-- ---------------------------------------------------------------------------
-- true = mudou; false = já estava assim (repetir não registra de novo).
create function public.set_conversation_classification(p_clinic_id uuid, p_contact_phone text, p_classification text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv public.conversation_state%rowtype;
  v_user uuid := (select auth.uid());
begin
  if not app.has_clinic_role(p_clinic_id, array['admin', 'reception']::public.clinic_role[]) then
    raise exception 'Só o Administrador e a Recepção marcam a conversa.' using errcode = '42501';
  end if;
  if p_classification is null or p_classification not in ('patient', 'personal', 'administrative') then
    raise exception 'Classificação inválida.' using errcode = '22023';
  end if;
  if p_contact_phone is not distinct from (select s.support_whatsapp from public.platform_settings s limit 1) then
    raise exception 'O número do suporte do RecepClinic não é marcado.' using errcode = '22023';
  end if;

  select * into v_conv from public.conversation_state c
   where c.clinic_id = p_clinic_id and c.contact_phone = p_contact_phone
   for update;
  if not found then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;
  if v_conv.classification = p_classification then
    return false;
  end if;

  -- Marcar no meio de uma marcação, remarcação ou cancelamento: a tentativa do funil fecha como "classified".
  if p_classification <> 'patient' and v_conv.funnel_session_id is not null and v_conv.funnel_flow is not null then
    insert into public.bot_funnel_events (clinic_id, session_id, flow, step, source, contact_phone, contact_id, metadata)
    values (
      p_clinic_id, v_conv.funnel_session_id, v_conv.funnel_flow, 'abandoned', 'bot', p_contact_phone, v_conv.contact_id,
      jsonb_build_object('reason', 'classified', 'last_step', v_conv.state)
    );
  end if;

  perform set_config('app.conversation_classifying', 'on', true);
  update public.conversation_state c
     set classification = p_classification,
         classified_at = now(),
         classified_by = v_user,
         state = 'WELCOME',
         context = '{}'::jsonb,
         funnel_session_id = null,
         funnel_flow = null,
         not_understood_count = 0,
         human_handoff = false,
         handoff_status_at = case when v_conv.human_handoff then now() else c.handoff_status_at end,
         handoff_changed_by = case when v_conv.human_handoff then 'reception' else c.handoff_changed_by end
   where c.id = v_conv.id;
  perform set_config('app.conversation_classifying', 'off', true);
  return true;
end
$$;
revoke execute on function public.set_conversation_classification(uuid, text, text) from public, anon, clinic_service;
grant execute on function public.set_conversation_classification(uuid, text, text) to authenticated;
