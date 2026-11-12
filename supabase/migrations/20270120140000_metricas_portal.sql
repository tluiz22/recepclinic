-- F6, parte 2: Métricas › Portal. O caminho do paciente no portal, da clínica toda, no período (pela data da sessão):
-- visitas, com celular confirmado, com horário reservado; e as marcações feitas pelo portal.
-- Visita = sessão aberta (link do bot ou endereço da clínica). Uma visita pode reservar e marcar mais de uma vez.
-- Só o Administrador da clínica e o Suporte (como a tela: o Profissional vê só a própria agenda). Sessões e bloqueios são apagados
-- depois de 30 dias pela limpeza diária; as marcações (`appointments`) ficam.
create function public.metrics_portal(
  p_clinic_id uuid,
  p_start timestamptz,
  p_end timestamptz
) returns table (
  visits bigint,
  from_bot_link bigint,
  verified bigint,
  held bigint,
  booked bigint,
  blocks bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.visits, s.from_bot_link, s.verified, s.held,
    (select count(*) from public.appointments a
      where a.clinic_id = p_clinic_id and a.booking_channel = 'portal' and a.agenda_import_id is null
        and a.created_at >= p_start and a.created_at < p_end),
    (select count(*) from public.portal_blocks b
      where b.clinic_id = p_clinic_id and b.created_at >= p_start and b.created_at < p_end)
  from (
    select count(*) as visits,
           count(*) filter (where s.link_id is not null) as from_bot_link,
           -- Quem entra pelo link do WhatsApp já tem o celular comprovado pela conversa.
           count(*) filter (where s.phone_verified_at is not null or s.link_id is not null) as verified,
           count(*) filter (where exists (select 1 from public.slot_holds h where h.session_id = s.id)) as held
      from public.portal_sessions s
     where s.clinic_id = p_clinic_id and s.created_at >= p_start and s.created_at < p_end
  ) s
  where app.has_clinic_role(p_clinic_id, array['admin']::public.clinic_role[])
$$;

revoke execute on function public.metrics_portal(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.metrics_portal(uuid, timestamptz, timestamptz) to authenticated;
