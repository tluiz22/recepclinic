-- M2 e M3 do redesign das Métricas (cliente, 22/out/2026): as contas passam
-- para o banco. Até aqui a tela lia os atendimentos de 1000 em 1000 e até 20
-- mil passos do bot para contar na memória.
--
-- Todas as funções de leitura são `security invoker`: rodam com o login de
-- quem abre a tela, então o RLS vale como em qualquer leitura (a clínica, e
-- para o Profissional só as próprias agendas, D6/D11). Nada aqui grava.
-- Dias e semanas no fuso da clínica. O período anterior da comparação é a
-- mesma chamada com outras datas.
--
-- Regras (detalhes e decisões no plano, "Redesign das Métricas"):
--   - Agendamento criado: pela data da marcação, cada ocorrência de série
--     conta, os cancelados depois continuam contando (mostrados à parte), a
--     carga da implantação fica fora (decisões 4 e 6).
--   - Remarcação e cancelamento: pela data em que aconteceram (trilha e
--     canceled_at); remarcar nunca soma em "criados".
--   - Comparecimento: pela data do atendimento, só compareceu e faltou; os
--     que já passaram sem registro ficam à parte.
--   - Lembrete: a última tentativa de cada atendimento e o toque depois
--     dela (mesma regra do Resumo do Dia); "sem resposta" só depois do
--     horário do atendimento (decisão 5).

-- ---------------------------------------------------------------------------
-- M2: atendimento ligado ao passo do bot como coluna (antes só no JSON)
-- ---------------------------------------------------------------------------
alter table public.bot_funnel_events add column appointment_id uuid;
alter table public.bot_funnel_events
  add constraint bot_funnel_events_appointment_fk
  foreign key (clinic_id, appointment_id) references public.appointments (clinic_id, id) on delete set null (appointment_id);

update public.bot_funnel_events f
   set appointment_id = (f.metadata->>'appointment_id')::uuid
 where f.metadata->>'appointment_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and exists (
     select 1 from public.appointments a
      where a.clinic_id = f.clinic_id and a.id = (f.metadata->>'appointment_id')::uuid
   );

create index bot_funnel_events_appointment_idx on public.bot_funnel_events (appointment_id) where appointment_id is not null;

-- ---------------------------------------------------------------------------
-- Desempenho: o que aconteceu em cada dia (marcações, remarcações, cancelamentos)
-- ---------------------------------------------------------------------------
create function public.metrics_activity(
  p_clinic_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_agenda_ids uuid[],
  p_service_ids uuid[] default null,
  p_location_ids uuid[] default null
) returns table (
  day date,
  created_panel bigint,
  created_whatsapp bigint,
  created_canceled bigint,
  returns_panel bigint,
  returns_whatsapp bigint,
  rescheduled_patient bigint,
  rescheduled_team bigint,
  waitlist_advanced bigint,
  canceled_patient bigint,
  canceled_clinic bigint,
  canceled_mass bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with tz as (
    select timezone from public.clinic_settings where clinic_id = p_clinic_id
  ), facts as (
    -- Marcados no período (pela data da marcação).
    select (a.created_at at time zone tz.timezone)::date as day,
           (a.booking_channel = 'admin')::int as created_panel,
           (a.booking_channel <> 'admin')::int as created_whatsapp,
           (a.status = 'canceled')::int as created_canceled,
           (s.category = 'return_visit' and a.booking_channel = 'admin')::int as returns_panel,
           (s.category = 'return_visit' and a.booking_channel <> 'admin')::int as returns_whatsapp,
           0 as rescheduled_patient, 0 as rescheduled_team, 0 as waitlist_advanced,
           0 as canceled_patient, 0 as canceled_clinic, 0 as canceled_mass
      from public.appointments a
      join public.services s on s.id = a.service_id
      cross join tz
     where a.clinic_id = p_clinic_id
       and a.created_at >= p_start and a.created_at < p_end
       and a.agenda_import_id is null
       and a.agenda_id = any (p_agenda_ids)
       and (p_service_ids is null or a.service_id = any (p_service_ids))
       and (p_location_ids is null or a.location_id = any (p_location_ids))
    union all
    -- Remarcações (pela trilha: cada remarcação conta, não só a última).
    select (e.occurred_at at time zone tz.timezone)::date,
           0, 0, 0, 0, 0,
           (e.event_type = 'rescheduled' and e.channel in ('whatsapp_bot', 'booking_link'))::int,
           (e.event_type = 'rescheduled' and e.channel not in ('whatsapp_bot', 'booking_link'))::int,
           (e.event_type = 'waitlist_advanced')::int,
           0, 0, 0
      from public.appointment_events e
      join public.appointments a on a.id = e.appointment_id
      cross join tz
     where e.clinic_id = p_clinic_id
       and e.event_type in ('rescheduled', 'waitlist_advanced')
       and e.occurred_at >= p_start and e.occurred_at < p_end
       and a.agenda_id = any (p_agenda_ids)
       and (p_service_ids is null or a.service_id = any (p_service_ids))
       and (p_location_ids is null or a.location_id = any (p_location_ids))
    union all
    -- Cancelamentos (pela data do cancelamento).
    select (a.canceled_at at time zone tz.timezone)::date,
           0, 0, 0, 0, 0, 0, 0, 0,
           (a.canceled_via = 'whatsapp_bot')::int,
           (a.canceled_via is distinct from 'whatsapp_bot' and not a.mass_canceled)::int,
           (a.canceled_via is distinct from 'whatsapp_bot' and a.mass_canceled)::int
      from public.appointments a
      cross join tz
     where a.clinic_id = p_clinic_id
       and a.status = 'canceled'
       and a.canceled_at >= p_start and a.canceled_at < p_end
       and a.agenda_id = any (p_agenda_ids)
       and (p_service_ids is null or a.service_id = any (p_service_ids))
       and (p_location_ids is null or a.location_id = any (p_location_ids))
  )
  select day,
         sum(created_panel), sum(created_whatsapp), sum(created_canceled),
         sum(returns_panel), sum(returns_whatsapp),
         sum(rescheduled_patient), sum(rescheduled_team), sum(waitlist_advanced),
         sum(canceled_patient), sum(canceled_clinic), sum(canceled_mass)
    from facts
   group by day
   order by day
$$;

-- ---------------------------------------------------------------------------
-- Desempenho: atendimentos com data no período, por dia, serviço e local
-- ---------------------------------------------------------------------------
create function public.metrics_attendance(
  p_clinic_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_agenda_ids uuid[],
  p_service_ids uuid[] default null,
  p_location_ids uuid[] default null,
  p_now timestamptz default now()
) returns table (
  day date,
  service_id uuid,
  service_name text,
  service_category public.service_category,
  location_id uuid,
  location_name text,
  scheduled bigint,
  canceled bigint,
  completed bigint,
  no_show bigint,
  unregistered bigint,
  upcoming bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select (a.scheduled_at at time zone st.timezone)::date as day,
         s.id, s.name, s.category, l.id, l.name,
         count(*) filter (where a.status <> 'canceled'),
         count(*) filter (where a.status = 'canceled'),
         count(*) filter (where a.status = 'completed'),
         count(*) filter (where a.status = 'no_show'),
         count(*) filter (where a.status in ('scheduled', 'confirmed') and a.scheduled_at <= p_now),
         count(*) filter (where a.status in ('scheduled', 'confirmed') and a.scheduled_at > p_now)
    from public.appointments a
    join public.services s on s.id = a.service_id
    join public.locations l on l.id = a.location_id
    join public.clinic_settings st on st.clinic_id = a.clinic_id
   where a.clinic_id = p_clinic_id
     and a.scheduled_at >= p_start and a.scheduled_at < p_end
     and a.agenda_id = any (p_agenda_ids)
     and (p_service_ids is null or a.service_id = any (p_service_ids))
     and (p_location_ids is null or a.location_id = any (p_location_ids))
   group by 1, s.id, s.name, s.category, l.id, l.name
   order by 1
$$;

-- ---------------------------------------------------------------------------
-- Desempenho: resposta aos lembretes (um desfecho por atendimento)
-- ---------------------------------------------------------------------------
-- outcome: confirmed | reschedule | cancel (toque depois da última tentativa),
-- not_delivered (a última falhou ou ficou sem template), waiting (sem toque e
-- o horário ainda não chegou), no_answer (sem toque depois do horário),
-- canceled_no_answer (cancelado sem tocar: fica fora da conta) e none (sem
-- lembrete; usado no cruzamento com as faltas).
create function public.metrics_reminders(
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
security invoker
set search_path = ''
as $$
  with appts as (
    select a.id, a.status, a.scheduled_at
      from public.appointments a
     where a.clinic_id = p_clinic_id
       and a.scheduled_at >= p_start and a.scheduled_at < p_end
       and a.agenda_id = any (p_agenda_ids)
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
    select distinct on (m.appointment_id) m.appointment_id, m.message_type
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
           when lt.message_type = 'reminder_reschedule' then 'reschedule'
           when lt.message_type = 'reminder_cancel' then 'cancel'
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

-- ---------------------------------------------------------------------------
-- Desempenho: retornos (consultas realizadas com direito a retorno)
-- ---------------------------------------------------------------------------
-- Direito: Consulta realizada, não domiciliar, numa agenda que atende serviço
-- de Retorno ativo com prazo (o maior prazo, se houver mais de um; agenda com
-- algum Retorno sem prazo fica fora, porque o prazo nunca termina). Só a
-- última Consulta do paciente na agenda (a anterior perde o direito, como no
-- botão "Marcar retorno"). Com retorno = algum Retorno ligado e não cancelado.
-- status: due (prazo terminou dentro do período), open (prazo ainda aberto
-- hoje), other.
create function public.metrics_return_rights(
  p_clinic_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_agenda_ids uuid[],
  p_location_ids uuid[] default null,
  p_now timestamptz default now()
) returns table (
  appointment_id uuid,
  patient_id uuid,
  agenda_id uuid,
  scheduled_at timestamptz,
  last_date date,
  has_return boolean,
  has_upcoming boolean,
  status text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with tz as (
    select timezone from public.clinic_settings where clinic_id = p_clinic_id
  ), deadlines as (
    select sa.agenda_id, max(s.return_deadline_days) as days, bool_or(s.return_deadline_days is null) as unlimited
      from public.services s
      join public.service_agendas sa on sa.service_id = s.id
     where s.clinic_id = p_clinic_id and s.category = 'return_visit' and s.is_active
     group by sa.agenda_id
  ), consults as (
    select a.id, a.patient_id, a.agenda_id, a.scheduled_at,
           (a.scheduled_at at time zone tz.timezone)::date + d.days as last_date
      from public.appointments a
      join public.services s on s.id = a.service_id and s.category = 'consultation'
      join public.locations l on l.id = a.location_id and l.type <> 'home_visit'
      join deadlines d on d.agenda_id = a.agenda_id and not d.unlimited and d.days is not null
      cross join tz
     where a.clinic_id = p_clinic_id
       and a.status = 'completed'
       and a.agenda_id = any (p_agenda_ids)
       and (p_location_ids is null or a.location_id = any (p_location_ids))
       -- Prazo terminando a partir do início do período (os de antes não interessam).
       and (a.scheduled_at at time zone tz.timezone)::date + d.days >= (p_start at time zone tz.timezone)::date
       and a.scheduled_at < p_end
  )
  select c.id, c.patient_id, c.agenda_id, c.scheduled_at, c.last_date,
         exists (
           select 1 from public.appointments r
            where r.clinic_id = p_clinic_id and r.origin_appointment_id = c.id and r.status <> 'canceled'
         ),
         exists (
           select 1 from public.appointments f
             join public.services fs on fs.id = f.service_id and fs.category in ('consultation', 'return_visit')
            where f.clinic_id = p_clinic_id and f.patient_id = c.patient_id and f.agenda_id = c.agenda_id
              and f.status in ('scheduled', 'confirmed') and f.scheduled_at > p_now
         ),
         case
           when c.last_date < (p_now at time zone tz.timezone)::date
                and c.last_date >= (p_start at time zone tz.timezone)::date
                and c.last_date < (p_end at time zone tz.timezone)::date then 'due'
           when c.last_date >= (p_now at time zone tz.timezone)::date then 'open'
           else 'other'
         end
    from consults c
    cross join tz
   where not exists (
     -- A última Consulta do paciente na agenda (realizada ou ainda pendente).
     select 1 from public.appointments later
       join public.services ls on ls.id = later.service_id and ls.category = 'consultation'
      where later.clinic_id = p_clinic_id and later.patient_id = c.patient_id and later.agenda_id = c.agenda_id
        and later.status in ('completed', 'scheduled', 'confirmed')
        and later.scheduled_at > c.scheduled_at and later.scheduled_at <= p_now
   )
$$;

-- ---------------------------------------------------------------------------
-- Agendamento digital: as tentativas do bot resumidas no banco
-- ---------------------------------------------------------------------------
-- Uma linha por tentativa (sessão) iniciada em [p_start, p_end + 2 dias): a
-- regra de cada fluxo (etapas, desfecho) continua no código (botFunnel.ts),
-- que recebe só o primeiro registro de cada passo e a última falha ao
-- confirmar. `in_period` = iniciada dentro do período; as dos 2 dias depois
-- só servem para saber quem concluiu depois (Retomar contato).
create function public.metrics_bot_sessions(
  p_clinic_id uuid,
  p_start timestamptz,
  p_end timestamptz
) returns table (
  session_id uuid,
  flow text,
  contact_phone text,
  contact_id uuid,
  started_at timestamptz,
  last_at timestamptz,
  in_period boolean,
  steps jsonb,
  last_failure jsonb,
  appointment_id uuid,
  appointment_status public.appointment_status
)
language sql
stable
security invoker
set search_path = ''
as $$
  with starts as (
    select f.session_id, min(f.occurred_at) as started_at
      from public.bot_funnel_events f
     where f.clinic_id = p_clinic_id
       and (f.step = 'started' or f.flow = 'handoff')
       and f.occurred_at >= p_start and f.occurred_at < p_end + interval '2 days'
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
  )
  select s.session_id,
         (select e.flow from events e where e.session_id = s.session_id order by e.occurred_at, e.id limit 1),
         (select e.contact_phone from events e where e.session_id = s.session_id order by e.occurred_at, e.id limit 1),
         (select e.contact_id from events e where e.session_id = s.session_id and e.contact_id is not null order by e.occurred_at, e.id limit 1),
         s.started_at,
         (select max(e.occurred_at) from events e where e.session_id = s.session_id),
         s.started_at < p_end,
         (select jsonb_agg(jsonb_build_object('step', fi.step, 'metadata', fi.metadata, 'source', fi.source, 'at', fi.occurred_at) order by fi.occurred_at)
            from firsts fi where fi.session_id = s.session_id),
         (select fa.metadata from failures fa where fa.session_id = s.session_id),
         l.appointment_id,
         a.status
    from starts s
    left join linked l on l.session_id = s.session_id
    left join public.appointments a on a.id = l.appointment_id
   order by s.started_at
$$;

-- Falhas ao gravar um passo do funil (Administração › Erros), só a contagem:
-- mede quanto o funil pode estar contando a menos. A tabela de erros só o
-- Suporte lê; aqui sai só o número, e só para quem é da clínica.
create function public.metrics_funnel_write_failures(
  p_clinic_id uuid,
  p_start timestamptz,
  p_end timestamptz
) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when app.is_clinic_member(p_clinic_id) or app.is_platform_staff() then (
             select count(*) from public.system_errors e
              where e.clinic_id = p_clinic_id
                and e.scope = 'funil: erro ao gravar evento'
                and e.occurred_at >= p_start and e.occurred_at < p_end
           )
           else 0
         end
$$;

revoke execute on function public.metrics_activity(uuid, timestamptz, timestamptz, uuid[], uuid[], uuid[]) from public, anon;
revoke execute on function public.metrics_attendance(uuid, timestamptz, timestamptz, uuid[], uuid[], uuid[], timestamptz) from public, anon;
revoke execute on function public.metrics_reminders(uuid, timestamptz, timestamptz, uuid[], uuid[], uuid[], timestamptz) from public, anon;
revoke execute on function public.metrics_return_rights(uuid, timestamptz, timestamptz, uuid[], uuid[], timestamptz) from public, anon;
revoke execute on function public.metrics_bot_sessions(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.metrics_funnel_write_failures(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.metrics_activity(uuid, timestamptz, timestamptz, uuid[], uuid[], uuid[]) to authenticated;
grant execute on function public.metrics_attendance(uuid, timestamptz, timestamptz, uuid[], uuid[], uuid[], timestamptz) to authenticated;
grant execute on function public.metrics_reminders(uuid, timestamptz, timestamptz, uuid[], uuid[], uuid[], timestamptz) to authenticated;
grant execute on function public.metrics_return_rights(uuid, timestamptz, timestamptz, uuid[], uuid[], timestamptz) to authenticated;
grant execute on function public.metrics_bot_sessions(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.metrics_funnel_write_failures(uuid, timestamptz, timestamptz) to authenticated;
