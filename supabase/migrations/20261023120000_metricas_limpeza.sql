-- Limpeza do redesign das Métricas (cliente, 22/out/2026, depois da validação):
-- os itens antigos "Métricas: Visão geral" e "Métricas: Atendimentos", que
-- viraram "Métricas: Desempenho" na M4 (20261022140000_metricas_matriz.sql),
-- saem do banco. Quem tinha um deles já ganhou o Desempenho naquela migração;
-- aqui só as linhas antigas são apagadas.

delete from public.clinic_features where feature_key in ('metrics_overview', 'metrics_appointments');
delete from public.features where key in ('metrics_overview', 'metrics_appointments');
