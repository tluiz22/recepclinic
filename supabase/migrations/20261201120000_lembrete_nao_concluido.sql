-- Pedido não concluído, PN1 (cliente, 03/nov/2026; docs/arquivo/modulos/pedido-nao-concluido.md):
-- no lembrete, Remarcar e Cancelar só contam quando a remarcação ou o
-- cancelamento aconteceu depois do toque. Antes disso, o desfecho é
-- not_completed ("Não concluíram"), como no Relatório do dia (daily.ts,
-- reminderGroup). Só muda o desfecho; a assinatura e as permissões ficam.
--
-- Timestamp depois das migrações da branch faturamento (até 20261127), para a
-- ordem não inverter quando ela entrar na main.
--
-- outcome: confirmed | reschedule | cancel (toque depois da última tentativa e
-- a ação feita depois do toque), not_completed (tocou em Remarcar ou Cancelar e
-- não concluiu), not_delivered (a última falhou ou ficou sem template), waiting
-- (sem toque e o horário ainda não chegou), no_answer (sem toque depois do
-- horário), canceled_no_answer (cancelado sem tocar: fica fora da conta) e none
-- (sem lembrete; usado no cruzamento com as faltas).
create or replace function public.metrics_reminders(
  p_clinic_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_agenda_ids uuid[],
  p_service_ids uuid[] default null,
  p_location_ids uuid[] default null,
  p_now timestamptz default now()
) returns table (outcome text, status public.appointment_status, total bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with appts as (
    select a.id, a.status, a.scheduled_at, a.rescheduled_at, a.canceled_at
      from public.appointments a
     where a.clinic_id = p_clinic_id
       and a.scheduled_at >= p_start and a.scheduled_at < p_end
       and a.agenda_id = any ((select app.metrics_agendas(p_clinic_id, p_agenda_ids))::uuid[])
       and (p_service_ids is null or a.service_id = any (p_service_ids))
       and (p_location_ids is null or a.location_id = any (p_location_ids))
  ), last_sent as (
    select distinct on (m.appointment_id) m.appointment_id, m.status, m.created_at
      from public.whatsapp_messages m
      join appts on appts.id = m.appointment_id
     where m.clinic_id = p_clinic_id
       and m.direction = 'outbound'
       and m.message_type = 'appointment_reminder'
     order by m.appointment_id, m.created_at desc, m.id desc
  ), last_tap as (
    select distinct on (m.appointment_id) m.appointment_id, m.message_type, m.created_at
      from public.whatsapp_messages m
      join last_sent ls on ls.appointment_id = m.appointment_id
     where m.clinic_id = p_clinic_id
       and m.direction = 'inbound'
       and m.message_type in ('reminder_confirm', 'reminder_reschedule', 'reminder_cancel')
       and m.created_at >= ls.created_at
     order by m.appointment_id, m.created_at desc, m.id desc
  )
  select case
           when ls.appointment_id is null then 'none'
           when lt.message_type = 'reminder_confirm' then 'confirmed'
           when lt.message_type = 'reminder_reschedule' then
             case when a.rescheduled_at >= lt.created_at then 'reschedule' else 'not_completed' end
           when lt.message_type = 'reminder_cancel' then
             case when a.status = 'canceled' and a.canceled_at >= lt.created_at then 'cancel' else 'not_completed' end
           when ls.status in ('failed', 'skipped_no_template') then 'not_delivered'
           when a.status = 'canceled' then 'canceled_no_answer'
           when a.scheduled_at > p_now then 'waiting'
           else 'no_answer'
         end as outcome,
         a.status,
         count(*)
    from appts a
    left join last_sent ls on ls.appointment_id = a.id
    left join last_tap lt on lt.appointment_id = a.id
   group by 1, 2
$$;
