-- CN4b — "Retomar conversa" e liberação em 30 min (Central de Atendimento; plano em
-- docs/arquivo/modulos/planejamento-central-atendimento.md, decisões 5 e 7 e R1, cliente, 05/nov/2026). Aditiva.
--
-- 1. Modelo novo `conversation_resume` (rc_retomar_conversa_v1, texto aprovado pelo cliente em 05/nov, opção C): fora
--    das 24 h, o único jeito de voltar a falar com o paciente. `central_resume_prepare` confere quem pode, a janela
--    fechada e o responsável, e grava o envio (um por vez: enquanto o paciente não responde, não sai outro, porque
--    cada envio é pago).
-- 2. Liberação automática (decisão 5, revista na R1): o paciente esperando 30 min sem resposta de quem está com a
--    conversa, contados só no horário da clínica (algum horário de agenda ativa naquele dia e hora, fora dos
--    feriados), volta para "Sem responsável" (do Profissional, volta para a Recepção). Sem notificação. Pela rotina
--    de 5 em 5 minutos do atendimento humano.
--
-- Reversão: drop das funções novas; a restrição de `template_key` sem 'conversation_resume' (apagar antes as linhas
-- desse modelo).

alter table public.whatsapp_templates drop constraint whatsapp_templates_template_key_check;
alter table public.whatsapp_templates add constraint whatsapp_templates_template_key_check check (template_key in (
  'confirmation', 'confirmation_return', 'reschedule', 'cancellation', 'clinic_cancellation', 'reminder',
  'exam_preparation', 'exam_preparation_file', 'consultation_guidance', 'waitlist_offer',
  'daily_summary_consultations', 'daily_summary_exams', 'daily_summary_consultations_today', 'daily_summary_exams_today',
  'nfse_document', 'connection_test', 'conversation_resume'
));

-- ---------------------------------------------------------------------------
-- 1. Retomar conversa
-- ---------------------------------------------------------------------------
-- outcome: ok (gravada, enviar), duplicate (essa chave já foi), bot (o servidor pausa o bot e chama de novo), changed
-- (o responsável mudou desde a tela), window_open (o paciente escreveu: responda por texto), pending (já foi um
-- "Retomar conversa" depois da última mensagem do paciente; `message_id` = esse envio).
create function public.central_resume_prepare(
  p_clinic_id uuid,
  p_contact_phone text,
  p_client_key uuid,
  p_body text,
  p_template_name text,
  p_expected_assigned uuid
)
returns table (outcome text, message_id uuid, assigned_to uuid, assigned_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_conv public.conversation_state%rowtype;
  v_existing uuid;
  v_last_patient timestamptz;
  v_pending uuid;
  v_id uuid;
begin
  if not app.central_active(p_clinic_id) then
    raise exception 'A Central de atendimento não está ligada nesta clínica.'
      using errcode = 'P0001', hint = 'feature_disabled:central_attendance';
  end if;
  if p_client_key is null or nullif(btrim(coalesce(p_body, '')), '') is null or nullif(btrim(coalesce(p_template_name, '')), '') is null then
    raise exception 'Envio incompleto.' using errcode = '22023';
  end if;

  select * into v_conv from public.conversation_state c
   where c.clinic_id = p_clinic_id and c.contact_phone = p_contact_phone
   for update;
  if not found then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;
  if not app.can_reply_conversation(p_clinic_id, v_conv.assigned_to, v_conv.human_handoff) then
    raise exception 'Esta conversa não está com você.' using errcode = '42501';
  end if;

  select m.id into v_existing from public.whatsapp_messages m
   where m.clinic_id = p_clinic_id and m.client_key = p_client_key;
  if v_existing is not null then
    return query select 'duplicate'::text, v_existing, v_conv.assigned_to, app.member_first_name(p_clinic_id, v_conv.assigned_to);
    return;
  end if;

  select max(m.created_at) into v_last_patient from public.whatsapp_messages m
   where m.clinic_id = p_clinic_id and m.contact_phone = p_contact_phone
     and m.direction = 'inbound' and m.source = 'live';
  if v_last_patient is not null and v_last_patient >= now() - interval '23 hours 30 minutes' then
    return query select 'window_open'::text, null::uuid, v_conv.assigned_to, app.member_first_name(p_clinic_id, v_conv.assigned_to);
    return;
  end if;
  select m.id into v_pending from public.whatsapp_messages m
   where m.clinic_id = p_clinic_id and m.contact_phone = p_contact_phone
     and m.message_type = 'conversation_resume' and m.status <> 'failed'
     and m.created_at > coalesce(v_last_patient, '-infinity'::timestamptz)
   order by m.created_at desc
   limit 1;
  if v_pending is not null then
    return query select 'pending'::text, v_pending, v_conv.assigned_to, app.member_first_name(p_clinic_id, v_conv.assigned_to);
    return;
  end if;

  if not v_conv.human_handoff then
    return query select 'bot'::text, null::uuid, null::uuid, null::text;
    return;
  end if;
  if v_conv.assigned_to is distinct from p_expected_assigned and v_conv.assigned_to is distinct from v_user then
    return query select 'changed'::text, null::uuid, v_conv.assigned_to, app.member_first_name(p_clinic_id, v_conv.assigned_to);
    return;
  end if;

  insert into public.whatsapp_messages (
    clinic_id, contact_id, contact_phone, direction, message_type, template_name, body, status, author, sent_by,
    handoff_id, client_key
  )
  values (
    p_clinic_id, v_conv.contact_id, p_contact_phone, 'outbound', 'conversation_resume', btrim(p_template_name),
    btrim(p_body), 'sending', 'agent_panel', v_user, v_conv.handoff_id, p_client_key
  )
  returning id into v_id;

  -- Quem retoma assume; a conversa fica "Em atendimento" (aguarda o paciente).
  update public.conversation_state c set assigned_to = v_user
   where c.id = v_conv.id and c.assigned_to is distinct from v_user;
  update public.conversation_state c
     set handoff_status = 'in_progress', handoff_status_at = now(), handoff_changed_by = 'reception'
   where c.id = v_conv.id and c.handoff_status is distinct from 'in_progress';

  return query select 'ok'::text, v_id, v_user, app.member_first_name(p_clinic_id, v_user);
end
$$;
revoke execute on function public.central_resume_prepare(uuid, text, uuid, text, text, uuid) from public, anon, clinic_service;
grant execute on function public.central_resume_prepare(uuid, text, uuid, text, text, uuid) to authenticated;

-- "Tentar de novo" também vale para o "Retomar conversa" (que sai fora das 24 h): a regra da janela fica só no texto.
create or replace function public.central_send_retry(p_clinic_id uuid, p_message_id uuid)
returns table (outcome text, contact_phone text, body text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg public.whatsapp_messages%rowtype;
  v_conv public.conversation_state%rowtype;
  v_last_patient timestamptz;
begin
  if not app.central_active(p_clinic_id) then
    raise exception 'A Central de atendimento não está ligada nesta clínica.'
      using errcode = 'P0001', hint = 'feature_disabled:central_attendance';
  end if;
  select * into v_msg from public.whatsapp_messages m
   where m.clinic_id = p_clinic_id and m.id = p_message_id and m.author = 'agent_panel'
   for update;
  if not found then
    raise exception 'Mensagem não encontrada.' using errcode = 'P0002';
  end if;
  select * into v_conv from public.conversation_state c
   where c.clinic_id = p_clinic_id and c.contact_phone = v_msg.contact_phone;
  if not found or not app.can_reply_conversation(p_clinic_id, v_conv.assigned_to, v_conv.human_handoff) then
    raise exception 'Esta conversa não está com você.' using errcode = '42501';
  end if;
  if not (v_msg.status = 'failed' or (v_msg.status = 'sending' and v_msg.created_at < now() - interval '2 minutes')) then
    return query select 'already'::text, v_msg.contact_phone, null::text;
    return;
  end if;
  if v_msg.message_type <> 'conversation_resume' then
    select max(m.created_at) into v_last_patient from public.whatsapp_messages m
     where m.clinic_id = p_clinic_id and m.contact_phone = v_msg.contact_phone
       and m.direction = 'inbound' and m.source = 'live';
    if v_last_patient is null or v_last_patient < now() - interval '23 hours 30 minutes' then
      return query select 'window_closed'::text, v_msg.contact_phone, null::text;
      return;
    end if;
  end if;
  update public.whatsapp_messages m
     set status = 'sending', failure_reason = null, failure_code = null, created_at = now()
   where m.id = v_msg.id;
  return query select (case when v_msg.message_type = 'conversation_resume' then 'resume' else 'ok' end)::text, v_msg.contact_phone, v_msg.body;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Liberação em 30 min, no horário da clínica
-- ---------------------------------------------------------------------------
-- Minutos em que a clínica atende entre dois instantes: a união dos horários das agendas ativas de cada dia (fuso da
-- clínica), fora dos feriados.
create function app.clinic_open_minutes(p_clinic_id uuid, p_from timestamptz, p_to timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with tz as (
    select coalesce((select s.timezone from public.clinic_settings s where s.clinic_id = p_clinic_id), 'America/Sao_Paulo') as name
  ),
  days as (
    select d::date as day
      from tz, generate_series((p_from at time zone tz.name)::date, (p_to at time zone tz.name)::date, interval '1 day') d
  ),
  slots as (
    select tstzrange((d.day + w.start_time) at time zone tz.name, (d.day + w.end_time) at time zone tz.name) as r
      from days d
      cross join tz
      join public.availability_windows w on w.clinic_id = p_clinic_id and w.is_active and w.weekday = extract(dow from d.day)
      join public.agendas a on a.clinic_id = p_clinic_id and a.id = w.agenda_id and a.is_active
     where not exists (select 1 from public.clinic_holidays h where h.clinic_id = p_clinic_id and h.date = d.day)
  ),
  open as (
    select range_agg(r) * tstzmultirange(tstzrange(p_from, p_to)) as m from slots
  )
  select coalesce(sum(extract(epoch from upper(part) - lower(part)) / 60), 0)
    from open, unnest(open.m) part
$$;

-- Rotina (credencial da clínica): devolve quantas voltaram para "Sem responsável".
create function public.central_release_idle(p_clinic_id uuid, p_minutes integer default 30)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released integer := 0;
  v_row record;
begin
  if app.service_clinic_id() is distinct from p_clinic_id then
    raise exception 'Só a rotina da clínica libera conversas.' using errcode = '42501';
  end if;
  if not app.central_active(p_clinic_id) then
    return 0;
  end if;
  for v_row in
    select c.id, c.assigned_to, greatest(c.handoff_status_at, c.assigned_at) as since
      from public.conversation_state c
     where c.clinic_id = p_clinic_id and c.human_handoff and c.assigned_to is not null
       and c.handoff_status = 'waiting_clinic'
       and greatest(c.handoff_status_at, c.assigned_at) < now() - make_interval(mins => p_minutes)
     for update skip locked
  loop
    if app.clinic_open_minutes(p_clinic_id, v_row.since, now()) >= p_minutes then
      update public.conversation_state c
         set assigned_to = null, handoff_changed_by = 'system'
       where c.id = v_row.id and c.assigned_to = v_row.assigned_to;
      v_released := v_released + 1;
    end if;
  end loop;
  return v_released;
end
$$;
revoke execute on function public.central_release_idle(uuid, integer) from public, anon, authenticated;
grant execute on function public.central_release_idle(uuid, integer) to clinic_service;
