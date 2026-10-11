-- Ajustes dos testes do cliente (11/out/2026).

-- Como a clínica é chamada nos textos genéricos das mensagens: "a clínica",
-- "o consultório" ou outro nome com o artigo ("O consultório responderá sua
-- mensagem em breve"). O nome próprio continua com `message_article`.
alter table public.clinic_settings
  add column message_noun text not null default 'clínica' check (char_length(message_noun) between 1 and 40),
  add column message_noun_article text not null default 'a' check (message_noun_article in ('a', 'o'));

-- Prazo para oferecer horários (dias a partir de hoje): o bot só segue com o
-- serviço que tem horário livre nesse prazo, e a página de marcar só oferece
-- datas dentro dele. Padrão 60, como era fixo.
alter table public.clinic_settings
  add column booking_horizon_days integer not null default 60 check (booking_horizon_days between 7 and 365);
