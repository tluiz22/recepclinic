-- NA3 — Conversas que não são atendimento: métricas (cliente, 06/nov/2026, decisão 1; docs/conversas-nao-atendimento.md).
--
-- Enquanto marcado como Pessoal ou Administrativo/outros, o número inteiro sai das Métricas › Digital (tentativas do
-- bot, pedidos de recepção, taxa de resolução), inclusive o período anterior à marcação; voltou para atendimento, o
-- passado volta a contar. Pela classificação atual do telefone, no banco. Os contadores e as listas do atendimento
-- (Aguardando/Em atendimento, avisos) já ficam de fora: número marcado nunca fica com a clínica (20261226120000).
--
-- Reversão: recriar public.metrics_bot_sessions do 20261023130000.

CREATE OR REPLACE FUNCTION public.metrics_bot_sessions(p_clinic_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(session_id uuid, flow text, contact_phone text, contact_id uuid, started_at timestamp with time zone, last_at timestamp with time zone, in_period boolean, steps jsonb, last_failure jsonb, appointment_id uuid, appointment_status appointment_status)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with starts as (
    select f.session_id, min(f.occurred_at) as started_at
      from public.bot_funnel_events f
     where f.clinic_id = p_clinic_id
       and app.is_clinic_member(p_clinic_id)
       and (f.step = 'started' or f.flow = 'handoff')
       and f.occurred_at >= p_start and f.occurred_at < p_end + interval '2 days'
       -- NA: número marcado como não atendimento fica fora, inteiro.
       and not exists (
         select 1 from public.conversation_state c
          where c.clinic_id = f.clinic_id and c.contact_phone = f.contact_phone and c.classification <> 'patient'
       )
     group by f.session_id
  ), events as (
    select f.*
      from public.bot_funnel_events f
      join starts s on s.session_id = f.session_id
     where f.clinic_id = p_clinic_id
  ), firsts as (
    select distinct on (e.session_id, e.step) e.session_id, e.step, e.metadata, e.source, e.occurred_at
      from events e
     order by e.session_id, e.step, e.occurred_at, e.id
  ), failures as (
    select distinct on (e.session_id) e.session_id, e.metadata
      from events e
     where e.step = 'confirm_failed'
     order by e.session_id, e.occurred_at desc, e.id desc
  ), linked as (
    select distinct on (e.session_id) e.session_id, e.appointment_id
      from events e
     where e.appointment_id is not null
     order by e.session_id, e.occurred_at desc, e.id desc
  ), summary as (
    -- Uma passada nos passos de cada tentativa (antes, uma busca por coluna e por tentativa).
    select e.session_id,
           (array_agg(e.flow order by e.occurred_at, e.id))[1] as flow,
           (array_agg(e.contact_phone order by e.occurred_at, e.id))[1] as contact_phone,
           (array_agg(e.contact_id order by e.occurred_at, e.id) filter (where e.contact_id is not null))[1] as contact_id,
           max(e.occurred_at) as last_at
      from events e
     group by e.session_id
  ), steps as (
    select fi.session_id,
           jsonb_agg(jsonb_build_object('step', fi.step, 'metadata', fi.metadata, 'source', fi.source, 'at', fi.occurred_at) order by fi.occurred_at) as steps
      from firsts fi
     group by fi.session_id
  )
  select s.session_id,
         su.flow,
         su.contact_phone,
         su.contact_id,
         s.started_at,
         su.last_at,
         s.started_at < p_end,
         st.steps,
         fa.metadata,
         l.appointment_id,
         a.status
    from starts s
    join summary su on su.session_id = s.session_id
    left join steps st on st.session_id = s.session_id
    left join failures fa on fa.session_id = s.session_id
    left join linked l on l.session_id = s.session_id
    left join public.appointments a on a.id = l.appointment_id
     and a.agenda_id = any ((select app.metrics_agendas(p_clinic_id, null))::uuid[])
   order by s.started_at
$function$;
