-- F9.5 — Contadores de uso por clínica para o Suporte (L49; cliente, 09/out/2026).
--
-- Sem cobrança: só para acompanhar. Por mês, no fuso da clínica:
--   - atendimentos criados (como já era);
--   - mensagens que saíram de fato (aceitas pela Meta): antes contava toda
--     mensagem registrada, até as puladas por falta de template ou que
--     falharam no envio;
--   - dessas, os templates (que a Meta cobra da clínica); o resto são as
--     respostas do bot e da conversa, sem custo na janela de 24h.
-- Os meses já contados são recalculados a partir do histórico.

alter table public.clinic_usage_monthly add column templates_sent integer not null default 0;

drop trigger whatsapp_messages_count_usage on public.whatsapp_messages;
drop trigger appointments_count_usage on public.appointments;
drop function app.count_outbound_message();
drop function app.count_created_appointment();
drop function app.bump_usage(uuid, integer, integer);

create function app.bump_usage(p_clinic_id uuid, p_messages integer, p_templates integer, p_appointments integer)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.clinic_usage_monthly (clinic_id, month, messages_sent, templates_sent, appointments_created)
  values (p_clinic_id, date_trunc('month', app.clinic_today(p_clinic_id))::date, p_messages, p_templates, p_appointments)
  on conflict (clinic_id, month) do update
    set messages_sent = public.clinic_usage_monthly.messages_sent + excluded.messages_sent,
        templates_sent = public.clinic_usage_monthly.templates_sent + excluded.templates_sent,
        appointments_created = public.clinic_usage_monthly.appointments_created + excluded.appointments_created
$$;

-- Mensagem que saiu: registrada como enviada (nem falha, nem pulada).
create function app.count_outbound_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction = 'outbound' and new.status is distinct from 'failed' and coalesce(new.status, '') not like 'skipped%' then
    perform app.bump_usage(new.clinic_id, 1, case when new.template_name is not null then 1 else 0 end, 0);
  end if;
  return null;
end
$$;

create function app.count_created_appointment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.bump_usage(new.clinic_id, 0, 0, 1);
  return null;
end
$$;

create trigger whatsapp_messages_count_usage
  after insert on public.whatsapp_messages
  for each row execute function app.count_outbound_message();

create trigger appointments_count_usage
  after insert on public.appointments
  for each row execute function app.count_created_appointment();

revoke execute on function app.bump_usage(uuid, integer, integer, integer) from public, anon, authenticated, clinic_service;

-- Recalcula os meses já contados, com a regra nova, a partir do histórico.
delete from public.clinic_usage_monthly;

insert into public.clinic_usage_monthly (clinic_id, month, messages_sent, templates_sent, appointments_created)
select clinic_id, month, sum(messages), sum(templates), sum(appointments)
from (
  select m.clinic_id,
         date_trunc('month', (m.created_at at time zone coalesce(s.timezone, 'America/Sao_Paulo')))::date as month,
         1 as messages,
         case when m.template_name is not null then 1 else 0 end as templates,
         0 as appointments
    from public.whatsapp_messages m
    left join public.clinic_settings s on s.clinic_id = m.clinic_id
   where m.direction = 'outbound' and m.status is distinct from 'failed' and coalesce(m.status, '') not like 'skipped%'
  union all
  select a.clinic_id,
         date_trunc('month', (a.created_at at time zone coalesce(s.timezone, 'America/Sao_Paulo')))::date,
         0, 0, 1
    from public.appointments a
    left join public.clinic_settings s on s.clinic_id = a.clinic_id
) usage
group by clinic_id, month;
