-- Jornada do bot, E2 (cliente, 31/out/2026): o paciente diz no bot se o
-- atendimento é particular ou por convênio. O plano aceito vai no link de
-- marcar e, ao confirmar na página, fica gravado no atendimento (e no
-- paciente sem plano). Nulo = particular ou clínica sem convênios (como hoje).

alter table public.booking_links
  add column insurance_plan_id uuid,
  add foreign key (clinic_id, insurance_plan_id) references public.insurance_plans (clinic_id, id);
