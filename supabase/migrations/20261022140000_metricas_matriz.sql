-- M4 do redesign das Métricas (decisão 2 do cliente, 22/out/2026): Visão
-- geral e Atendimentos viram a aba "Desempenho", com um item só na matriz. A
-- clínica que tinha qualquer um dos dois continua com acesso (o novo item é
-- liberado com quem e quando liberou o mais antigo). O Funil do bot vira
-- "Agendamento digital" (decisão 1; o item é o mesmo).
--
-- Os dois itens antigos saem do código (a tela da matriz não os mostra mais),
-- mas as linhas ficam no banco até a validação do cliente; a limpeza vem numa
-- migração própria, depois dela. Nada é apagado aqui.

insert into public.features (key, area, label, depends_on, sort_order)
values ('metrics_performance', 'metrics', 'Métricas: Desempenho', '{}', 95);

update public.features set label = 'Métricas: Agendamento digital' where key = 'metrics_funnel';

insert into public.clinic_features (clinic_id, feature_key, enabled_by, enabled_at)
select distinct on (clinic_id) clinic_id, 'metrics_performance', enabled_by, enabled_at
  from public.clinic_features
 where feature_key in ('metrics_overview', 'metrics_appointments')
 order by clinic_id, enabled_at
on conflict do nothing;
