-- Funil do portal (frente Usabilidade, U1; cliente 13/nov/2026): a visita anônima. Uma linha por visita (cookie, sem
-- nome, celular nem IP) que só guarda por onde entrou e o passo mais longe alcançado. A página não espera a gravação;
-- só grava quando o passo avança. Apagada depois de 30 dias, como as sessões.
--
-- Passos (`furthest`): 1 entrou · 2 lista de profissionais · 3 escolheu o profissional · 4 viu os horários ·
-- 5 escolheu um horário · 6 celular confirmado (horário reservado) · 7 revisão · 8 marcou.

create table public.portal_visits (
  id uuid primary key,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  entry text not null check (entry in ('clinic', 'professional', 'whatsapp')),
  furthest smallint not null check (furthest between 1 and 8),
  created_at timestamptz not null default now()
);
create index portal_visits_clinic_idx on public.portal_visits (clinic_id, created_at);

alter table public.portal_visits enable row level security;
create policy portal_visits_service on public.portal_visits for all to clinic_service
  using (clinic_id = app.service_clinic_id()) with check (clinic_id = app.service_clinic_id());
create policy portal_visits_staff on public.portal_visits for select to authenticated using (app.is_platform_staff());
revoke all on public.portal_visits from anon, authenticated;
grant select on public.portal_visits to authenticated;
grant select, insert, update on public.portal_visits to clinic_service;

create trigger portal_visits_audit_platform_staff after insert or update or delete on public.portal_visits
  for each row execute function app.audit_platform_staff_write();
create trigger portal_visits_guard_suspended before insert or update or delete on public.portal_visits
  for each row execute function app.guard_suspended_clinic_write();

-- Avança a visita (ou a abre). Visita de outra clínica com o mesmo id: nada muda.
create function public.portal_visit_step(p_visit_id uuid, p_entry text, p_step smallint)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.portal_visits as v (id, clinic_id, entry, furthest)
  values (p_visit_id, app.service_clinic_id(), p_entry, p_step)
  on conflict (id) do update set furthest = greatest(v.furthest, excluded.furthest)
    where v.clinic_id = excluded.clinic_id and v.furthest < excluded.furthest
$$;

revoke execute on function public.portal_visit_step(uuid, text, smallint) from public, anon, authenticated;
grant execute on function public.portal_visit_step(uuid, text, smallint) to clinic_service;

-- Métricas › Portal: visitas do período (pela abertura) por entrada e passo mais longe. Só Administrador e Suporte.
create function public.metrics_portal_steps(p_clinic_id uuid, p_start timestamptz, p_end timestamptz)
returns table (entry text, furthest smallint, visits bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select v.entry, v.furthest, count(*)
    from public.portal_visits v
   where v.clinic_id = p_clinic_id and v.created_at >= p_start and v.created_at < p_end
     and app.has_clinic_role(p_clinic_id, array['admin']::public.clinic_role[])
   group by v.entry, v.furthest
$$;

revoke execute on function public.metrics_portal_steps(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.metrics_portal_steps(uuid, timestamptz, timestamptz) to authenticated;

-- Limpeza diária (o mesmo agendamento de 20270109130000, agora com as visitas).
select cron.schedule('limpar-portal', '25 3 * * *', $cron$
  delete from public.portal_rate_hits where at < now() - interval '2 days';
  delete from public.portal_blocks where blocked_until < now() - interval '30 days';
  delete from public.portal_sessions where created_at < now() - interval '30 days';
  delete from public.portal_links where created_at < now() - interval '30 days';
  delete from public.portal_limit_resets where created_at < now() - interval '30 days';
  delete from public.portal_visits where created_at < now() - interval '30 days';
$cron$);
