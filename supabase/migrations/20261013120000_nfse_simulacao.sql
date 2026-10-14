-- F11.4b — Ambiente "Simulação" da nota fiscal (cliente, 13/out/2026).
--
-- Para testar emissão, PDF, envio e cancelamento sem o e-CNPJ de uma clínica:
-- a nota é "emitida" pelo próprio servidor, sem falar com a Receita, e sai
-- marcada como simulada. Só o Suporte liga (a mesma regra do ambiente:
-- app.fiscal_environment_rules) e o servidor só aceita onde a variável
-- NFSE_SIMULATION=1 estiver definida (o staging). A numeração da DPS é
-- própria do ambiente, como já é entre Produção Restrita e Produção.

alter table public.clinic_fiscal_settings drop constraint clinic_fiscal_settings_environment_check;
alter table public.clinic_fiscal_settings add constraint clinic_fiscal_settings_environment_check
  check (environment in ('restricted', 'production', 'simulation'));

alter table public.nfse_dps_counters drop constraint nfse_dps_counters_environment_check;
alter table public.nfse_dps_counters add constraint nfse_dps_counters_environment_check
  check (environment in ('restricted', 'production', 'simulation'));

alter table public.nfse_invoices drop constraint nfse_invoices_environment_check;
alter table public.nfse_invoices add constraint nfse_invoices_environment_check
  check (environment in ('restricted', 'production', 'simulation'));
