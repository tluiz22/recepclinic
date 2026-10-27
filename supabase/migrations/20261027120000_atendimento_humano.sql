-- F8.5a — Atendimento humano (cliente, 27/out/2026): a tela "Atendimento"
-- lista as conversas em que o bot parou e a clínica precisa responder. Para
-- isso a conversa guarda, da pausa em andamento, o motivo e quando ela começou
-- (o human_handoff_at é renovado a cada mensagem da recepção e não serve para
-- "há quanto tempo espera").

alter table public.conversation_state
  add column handoff_reason text
    check (handoff_reason in ('requested', 'agent_took_over', 'bot_limit', 'no_availability', 'not_understood')),
  add column handoff_started_at timestamptz;

-- Fim da pausa apaga também o motivo e o início; pausa sem início informado
-- começa agora.
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
  else
    if new.human_handoff_at is null then
      new.human_handoff_at := now();
    end if;
    if new.handoff_started_at is null then
      new.handoff_started_at := new.human_handoff_at;
    end if;
  end if;
  return new;
end
$$;

-- Pausas em andamento antes desta migração: começam na última mensagem da
-- recepção, sem motivo conhecido.
update public.conversation_state
  set handoff_started_at = human_handoff_at
  where human_handoff and handoff_started_at is null;

-- Respostas da recepção pelo app por número (a tela compara com as mensagens
-- do paciente, que já têm índice próprio).
create index whatsapp_messages_agent_reply_idx
  on public.whatsapp_messages (clinic_id, contact_phone, created_at desc)
  where message_type = 'agent_reply';
