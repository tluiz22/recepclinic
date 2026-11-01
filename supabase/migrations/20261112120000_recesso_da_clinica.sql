-- Recesso da clínica (cliente, 01/nov/2026).
--
-- Um bloqueio de agenda pode ser marcado como recesso: `recess_message` guarda o
-- texto que o bot envia quando o paciente pede a recepção durante o bloqueio
-- (nulo = bloqueio comum). O texto usa {data} para o dia do retorno (o dia
-- seguinte ao fim do bloqueio), calculado no envio.

alter table public.schedule_blocks
  add column recess_message text check (recess_message is null or length(trim(recess_message)) > 0);
