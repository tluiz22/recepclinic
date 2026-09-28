-- Fase 15 · etapa 4: transferência para a secretária no log de eventos.
--
-- Marcar/remarcar/cancelar (bot e tela) não entram aqui — já são gravados em
-- `appointments` desde a Fase 17 (canal, login e data de cada ação) e a tela
-- de métricas lê de lá. Fica aqui só o que não existia: o pedido de "Falar
-- com a secretária" no menu do bot, como um evento avulso (tentativa de um
-- passo só, flow 'handoff').

alter table bot_funnel_events drop constraint bot_funnel_events_flow_check;
alter table bot_funnel_events add constraint bot_funnel_events_flow_check
  check (flow in (
    'booking',         -- Consultas > Agendar consulta
    'return_booking',  -- Consultas > Agendar retorno
    'exam',            -- Exames > Marcar exame
    'cancel',          -- Consultas/Exames > Cancelar (categoria em metadata)
    'reschedule',      -- Consultas/Exames > Remarcar (categoria em metadata)
    'handoff'          -- Menu > Falar com a secretária
  ));
