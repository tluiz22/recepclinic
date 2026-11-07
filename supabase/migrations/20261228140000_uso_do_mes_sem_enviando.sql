-- Uso do mês sem as mensagens paradas em "enviando" (CN4a; cliente, 07/nov/2026). A resposta da Central é gravada
-- "enviando" antes de sair; se o servidor cair no meio, ela fica assim e contava no uso do mês como se tivesse saído
-- (a que falha já ficava fora). Agora só conta a que saiu de verdade (vira "enviada" quando sai).
--
-- Reversão: recriar meta_message_counts como na 20261214120000.

create or replace function public.meta_message_counts(p_from date, p_clinic_id uuid default null)
returns table (clinic_id uuid, month date, templates integer, service integer, app_replies integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.clinic_id, c.month, c.templates, c.service, c.app_replies
    from (
      select m.clinic_id,
             date_trunc('month', m.created_at at time zone coalesce(s.timezone, 'America/Fortaleza'))::date as month,
             count(*) filter (where m.message_type not in ('agent_reply', 'app_auto_reply') and m.template_name is not null)::integer as templates,
             count(*) filter (where m.message_type not in ('agent_reply', 'app_auto_reply') and m.template_name is null)::integer as service,
             count(*) filter (where m.message_type in ('agent_reply', 'app_auto_reply'))::integer as app_replies
        from public.whatsapp_messages m
        left join public.clinic_settings s on s.clinic_id = m.clinic_id
       where m.direction = 'outbound'
         and m.status is distinct from 'failed'
         -- Cliente, 07/nov/2026: resposta da Central parada em "enviando" (o servidor caiu no meio) não saiu.
         and m.status is distinct from 'sending'
         and coalesce(m.status, '') not like 'skipped%'
         -- Margem de um dia para o fuso; o corte exato é o do mês, abaixo.
         and m.created_at >= p_from::timestamp - interval '1 day'
         and (p_clinic_id is null or m.clinic_id = p_clinic_id)
       group by 1, 2
    ) c
   where c.month >= p_from
$$;
