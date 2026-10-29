-- C7.5 Preparo do exame numa mensagem só (cliente, 28/out/2026): com arquivo,
-- o preparo sai como o arquivo com o início e o final da mensagem
-- (rc_preparo_arquivo_v2), sem as instruções. O arquivo deixa de exigir o
-- texto do preparo.
--
-- Reversão: alter table public.services add constraint
-- services_preparation_file_needs_text check (preparation_file_path is null or
-- coalesce(btrim(preparation_instructions), '') <> '') (antes, dar texto aos
-- serviços com arquivo e sem instruções).

alter table public.services drop constraint services_preparation_file_needs_text;
