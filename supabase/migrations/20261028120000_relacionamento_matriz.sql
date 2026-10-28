-- CRM A1 — Central de Relacionamento (cliente, 27/out/2026): item próprio
-- "Relacionamento" na matriz de acesso (Q2), numa área nova da matriz,
-- como o Módulo financeiro. Liberado por clínica pelo Suporte (D11);
-- nenhuma clínica recebe o item nesta migração.
--
-- Só a matriz muda: as listas da central são as que já existem, com as
-- mesmas funções e o mesmo RLS. Reversão:
--   delete from public.clinic_features where feature_key = 'relationship';
--   delete from public.features where key = 'relationship';
--   (e a área volta à regra anterior)

alter table public.features drop constraint features_area_check;
alter table public.features
  add constraint features_area_check
  check (area in ('agenda', 'whatsapp', 'metrics', 'finance', 'relationship'));

insert into public.features (key, area, label, depends_on, sort_order) values
  ('relationship', 'relationship', 'Relacionamento (central de pendências)', '{}', 190);
