-- A DMED sai do RecepClinic (cliente, 30/out/2026): é feita pelo contador da
-- clínica. Saem a configuração do arquivo (responsável pelo preenchimento,
-- CPF do responsável perante o CNPJ e CNES) e a função que registrava a
-- geração. A trilha fiscal fica como está: os registros "dmed_generated" já
-- gravados continuam no histórico da clínica (o evento segue aceito).

drop function public.log_dmed_generated(uuid, integer, integer, bigint, integer);
drop table public.clinic_dmed_settings;
