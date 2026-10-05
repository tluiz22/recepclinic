-- F3.6b — Horizonte das séries sem fim (D9; cliente, 04/out/2026: 3 meses).
--
-- O agendador (credencial clinic_service) cria as próximas sessões das
-- séries conforme o tempo passa e precisa registrar as datas puladas (feriado,
-- bloqueio, horário ocupado) para a tela avisar a recepção. Só na própria
-- clínica; continua sem alterar nem apagar.

grant insert on public.appointment_series_skips to clinic_service;

create policy appointment_series_skips_insert_service on public.appointment_series_skips
  for insert to clinic_service
  with check (
    clinic_id = app.service_clinic_id()
    and exists (select 1 from public.appointment_series s where s.id = series_id and s.clinic_id = app.service_clinic_id())
  );
