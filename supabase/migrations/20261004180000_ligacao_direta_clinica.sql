-- F2.7 — Toda tabela com clinic_id aponta direto para a clínica, com exclusão
-- em cascata (lição da F2.5: só a ligação indireta pode travar a exclusão da
-- clínica). Conferido pela varredura de estrutura em tests/db/isolamento.test.ts.
--
-- Exceção deliberada: platform_audit_log não aponta para a clínica, para o
-- registro do Suporte sobreviver à exclusão dela.

alter table public.service_agendas
  add foreign key (clinic_id) references public.clinics (id) on delete cascade;
alter table public.service_locations
  add foreign key (clinic_id) references public.clinics (id) on delete cascade;
alter table public.member_agenda_grants
  add foreign key (clinic_id) references public.clinics (id) on delete cascade;
alter table public.professional_insurance_exclusions
  add foreign key (clinic_id) references public.clinics (id) on delete cascade;
alter table public.appointment_series_skips
  add foreign key (clinic_id) references public.clinics (id) on delete cascade;
alter table public.appointment_events
  add foreign key (clinic_id) references public.clinics (id) on delete cascade;
