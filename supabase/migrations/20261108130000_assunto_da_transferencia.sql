-- Jornada do bot, E4 (cliente, 31/out/2026): na transferência para a recepção
-- o bot pergunta uma vez o assunto; a primeira resposta em texto fica na
-- conversa e aparece na tela Atendimento. Exceção da D12 (só o assunto, até
-- 300 caracteres, apagado quando a conversa volta ao bot).

alter table public.conversation_state
  add column handoff_subject text check (char_length(handoff_subject) <= 300),
  -- Quando o bot perguntou (nulo = não perguntou nesta pausa).
  add column handoff_subject_asked_at timestamptz;

-- Fim da pausa apaga também o assunto e a pergunta.
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
