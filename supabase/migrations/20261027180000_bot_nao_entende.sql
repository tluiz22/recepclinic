-- F8.5d — Bot que não entende (cliente, 27/out/2026): na 4ª mensagem seguida
-- que o bot não entende (texto fora das opções, áudio, foto, figurinha…), a
-- conversa vai para o atendimento humano. Uma resposta entendida zera a
-- contagem; a pausa e a volta ao bot também.
alter table public.conversation_state
  add column not_understood_count smallint not null default 0 check (not_understood_count >= 0);
