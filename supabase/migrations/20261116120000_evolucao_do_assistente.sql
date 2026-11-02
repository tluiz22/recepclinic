-- Evolução do assistente (EA, cliente, 02/nov/2026; docs/evolucao-assistente.md).
--
-- 1. Dúvida respondida pela base de conhecimento vira tentativa própria no funil
--    (flow "info"): started → answered → resolved ("Resolvido") ou escalated
--    ("Falar com a recepção"). Base da taxa de resolução sem a recepção.
-- 2. "Perguntas frequentes no bot" ligado por padrão com o "Bot de WhatsApp":
--    quem já tem o bot recebe o item (o Suporte pode desligar depois na matriz).

alter table public.bot_funnel_events drop constraint bot_funnel_events_flow_check;
alter table public.bot_funnel_events add constraint bot_funnel_events_flow_check
  check (flow in ('booking', 'return_booking', 'exam', 'cancel', 'reschedule', 'handoff', 'info'));

insert into public.clinic_features (clinic_id, feature_key)
  select cf.clinic_id, 'knowledge_base'
    from public.clinic_features cf
   where cf.feature_key = 'whatsapp_bot'
  on conflict do nothing;
