-- F4.9 — Saem da matriz de acesso (cliente, 05/out/2026):
--   - "Métricas: Envios": a aba Envios foi para o Resumo do Dia (F4.8), para
--     toda a equipe, com o lembrete ou o resumo do dia liberados;
--   - "Relatórios": a aba Atendimentos das Métricas já cobre (como no piloto).
delete from public.clinic_features where feature_key in ('metrics_sends', 'reports');
delete from public.features where key in ('metrics_sends', 'reports');
