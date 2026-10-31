-- Limites do bot por contato: padrão 5 nos três (cliente, 31/out/2026; antes
-- 3 atendimentos futuros, 3 cadastros em 30 dias e 2 faltas em 90 dias). Vale
-- para as clínicas novas e, nas que já existem, só no limite que ainda está no
-- padrão antigo: quem ajustou um valor à mão fica como está.
--
-- Reversão: os defaults de volta para 3, 3 e 2 (os valores já trocados para 5
-- não voltam sozinhos).

alter table public.clinic_settings
  alter column bot_max_future_appointments set default 5,
  alter column bot_max_new_patients set default 5,
  alter column bot_max_no_shows set default 5;

update public.clinic_settings set bot_max_future_appointments = 5 where bot_max_future_appointments = 3;
update public.clinic_settings set bot_max_new_patients = 5 where bot_max_new_patients = 3;
update public.clinic_settings set bot_max_no_shows = 5 where bot_max_no_shows = 2;
