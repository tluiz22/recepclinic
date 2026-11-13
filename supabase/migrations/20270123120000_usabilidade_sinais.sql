-- Aba Usabilidade (frente Usabilidade, U2; cliente 13/nov/2026): sinais de dificuldade no portal e na recepção, só do
-- que já está gravado (sem tabela nem gravação nova). Uma consulta por abertura da aba, limitada ao período e à
-- clínica; só o Suporte (equipe da plataforma) chama. Cada linha: quantos casos (`affected`) em quantos possíveis
-- (`base`).
--   portal_cancel_1h   consulta marcada pelo portal e cancelada em menos de 1 hora (base: marcadas pelo portal)
--   admin_cancel_5min  consulta marcada pela recepção e cancelada em menos de 5 minutos (base: marcadas pela recepção)
--   resched_1h         consulta remarcada em menos de 1 hora depois de marcada (base: marcadas)
--   code_wrong         código do celular com ao menos um erro (base: códigos enviados)
--   hold_expired       horário reservado no portal que venceu sem virar consulta (base: reservas)
-- A remarcação guarda só a última data; "remarcou 2 vezes" não sai de dado existente e ficou de fora.
--
-- Reversão: drop function public.metrics_usability.

create function public.metrics_usability(p_clinic_id uuid, p_start timestamptz, p_end timestamptz)
returns table (signal text, affected bigint, base bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with allowed as (select app.is_platform_staff() as ok),
  appts as (
    select a.booking_channel, a.created_at, a.canceled_at, a.rescheduled_at, a.status
      from public.appointments a, allowed
     where allowed.ok and a.clinic_id = p_clinic_id and a.created_at >= p_start and a.created_at < p_end
  ),
  codes as (
    select c.attempts from public.portal_codes c, allowed
     where allowed.ok and c.clinic_id = p_clinic_id and c.created_at >= p_start and c.created_at < p_end
  ),
  holds as (
    select h.appointment_id, h.released_at, h.expires_at from public.slot_holds h, allowed
     where allowed.ok and h.clinic_id = p_clinic_id and h.created_at >= p_start and h.created_at < p_end
  )
  select 'portal_cancel_1h', count(*) filter (where status = 'canceled' and canceled_at - created_at < interval '1 hour'), count(*)
    from appts where booking_channel = 'portal'
  union all
  select 'admin_cancel_5min', count(*) filter (where status = 'canceled' and canceled_at - created_at < interval '5 minutes'), count(*)
    from appts where booking_channel = 'admin'
  union all
  select 'resched_1h', count(*) filter (where rescheduled_at is not null and rescheduled_at - created_at < interval '1 hour'), count(*)
    from appts
  union all
  select 'code_wrong', count(*) filter (where attempts > 0), count(*) from codes
  union all
  select 'hold_expired', count(*) filter (where appointment_id is null and released_at is null and expires_at < now()), count(*) from holds
$$;

revoke execute on function public.metrics_usability(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.metrics_usability(uuid, timestamptz, timestamptz) to authenticated;
