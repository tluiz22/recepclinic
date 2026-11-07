-- NA4 — Conversas que não são atendimento: tela Conversas (cliente, 06/nov/2026; telas NA0; docs/conversas-nao-atendimento.md).
--
--  1. A lista ganha a aba "Pessoal e admin." (p_classified): os números marcados, com o selo, quem marcou e quando e as
--     mensagens novas (não lidas por pessoa). Abertas e Finalizadas deixam esses números de fora.
--  2. Responder pelo painel num número marcado: a mensagem sai (dentro das 24 h) sem abrir atendimento nem assumir; o
--     bot continua calado (antes, conversa sem atendimento era pausada primeiro).
--
-- Reversão: recriar central_conversations do 20261218120000 e as três funções de envio do 20261219120000,
-- 20261222120000 e 20261220120000.


CREATE OR REPLACE FUNCTION public.central_send_prepare(p_clinic_id uuid, p_contact_phone text, p_client_key uuid, p_body text, p_expected_assigned uuid)
 RETURNS TABLE(outcome text, message_id uuid, assigned_to uuid, assigned_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := (select auth.uid());
  v_body text := btrim(coalesce(p_body, ''));
  v_conv public.conversation_state%rowtype;
  v_existing uuid;
  v_last_patient timestamptz;
  v_id uuid;
begin
  if not app.central_active(p_clinic_id) then
    raise exception 'A Central de atendimento não está ligada nesta clínica.'
      using errcode = 'P0001', hint = 'feature_disabled:central_attendance';
  end if;
  if v_body = '' or char_length(v_body) > 4096 then
    raise exception 'Escreva a mensagem (até 4.096 caracteres).' using errcode = '22023';
  end if;
  if p_client_key is null then
    raise exception 'Envio sem chave.' using errcode = '22023';
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

  -- Número marcado (NA): responde sem atendimento; o bot continua calado.
  if not v_conv.human_handoff and v_conv.classification = 'patient' then
    return query select 'bot'::text, null::uuid, null::uuid, null::text;
    return;
  end if;
  if v_conv.assigned_to is distinct from p_expected_assigned and v_conv.assigned_to is distinct from v_user then
    return query select 'changed'::text, null::uuid, v_conv.assigned_to, app.member_first_name(p_clinic_id, v_conv.assigned_to);
    return;
  end if;

  select max(m.created_at) into v_last_patient from public.whatsapp_messages m
   where m.clinic_id = p_clinic_id and m.contact_phone = p_contact_phone
     and m.direction = 'inbound' and m.source = 'live';
  if v_last_patient is null or v_last_patient < now() - interval '23 hours 30 minutes' then
    return query select 'window_closed'::text, null::uuid, v_conv.assigned_to, app.member_first_name(p_clinic_id, v_conv.assigned_to);
    return;
  end if;

  insert into public.whatsapp_messages (
    clinic_id, contact_id, contact_phone, direction, message_type, body, status, author, sent_by, handoff_id, client_key
  )
  values (
    p_clinic_id, v_conv.contact_id, p_contact_phone, 'outbound', 'panel_reply', v_body, 'sending', 'agent_panel', v_user,
    v_conv.handoff_id, p_client_key
  )
  returning id into v_id;

  -- Responder assume (decisão 5) e a conversa fica "Em atendimento": duas mudanças, dois eventos ("Ana assumiu").
  update public.conversation_state c set assigned_to = v_user
   where c.id = v_conv.id and c.assigned_to is distinct from v_user;
  update public.conversation_state c
     set handoff_status = 'in_progress', handoff_status_at = now(), handoff_changed_by = 'reception'
   where c.id = v_conv.id and c.handoff_status is distinct from 'in_progress';

  -- Quem respondeu leu.
  insert into public.conversation_reads (clinic_id, contact_phone, user_id, last_read_at)
  values (p_clinic_id, p_contact_phone, v_user, now())
  on conflict (clinic_id, contact_phone, user_id) do update set last_read_at = excluded.last_read_at;

  return query select 'ok'::text, v_id, v_user, app.member_first_name(p_clinic_id, v_user);
end
$function$;

CREATE OR REPLACE FUNCTION public.central_media_send_prepare(p_clinic_id uuid, p_contact_phone text, p_client_key uuid, p_caption text, p_storage_path text, p_mime_type text, p_size_bytes bigint, p_file_name text, p_sha256 text, p_expected_assigned uuid)
 RETURNS TABLE(outcome text, message_id uuid, assigned_to uuid, assigned_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := (select auth.uid());
  v_caption text := nullif(btrim(coalesce(p_caption, '')), '');
  v_conv public.conversation_state%rowtype;
  v_existing uuid;
  v_last_patient timestamptz;
  v_media uuid;
  v_id uuid;
begin
  if not app.central_active(p_clinic_id) then
    raise exception 'A Central de atendimento não está ligada nesta clínica.'
      using errcode = 'P0001', hint = 'feature_disabled:central_attendance';
  end if;
  if char_length(coalesce(v_caption, '')) > 1024 then
    raise exception 'A legenda vai até 1.024 caracteres.' using errcode = '22023';
  end if;
  if p_client_key is null then
    raise exception 'Envio sem chave.' using errcode = '22023';
  end if;
  -- Foto JPEG/PNG até 5 MB (limite da Meta para imagem) e PDF até 10 MB (decisão 8b).
  if not ((p_mime_type in ('image/jpeg', 'image/png') and p_size_bytes between 1 and 5242880)
          or (p_mime_type = 'application/pdf' and p_size_bytes between 1 and 10485760)) then
    raise exception 'Envie foto (JPG ou PNG, até 5 MB) ou PDF (até 10 MB).' using errcode = '22023';
  end if;
  -- O arquivo está na pasta da conversa.
  if p_storage_path is null
     or p_storage_path not like p_clinic_id::text || '/' || regexp_replace(p_contact_phone, '\D', '', 'g') || '/env-%' then
    raise exception 'Arquivo fora da conversa.' using errcode = '22023';
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

  -- Número marcado (NA): responde sem atendimento; o bot continua calado.
  if not v_conv.human_handoff and v_conv.classification = 'patient' then
    return query select 'bot'::text, null::uuid, null::uuid, null::text;
    return;
  end if;
  if v_conv.assigned_to is distinct from p_expected_assigned and v_conv.assigned_to is distinct from v_user then
    return query select 'changed'::text, null::uuid, v_conv.assigned_to, app.member_first_name(p_clinic_id, v_conv.assigned_to);
    return;
  end if;

  select max(m.created_at) into v_last_patient from public.whatsapp_messages m
   where m.clinic_id = p_clinic_id and m.contact_phone = p_contact_phone
     and m.direction = 'inbound' and m.source = 'live';
  if v_last_patient is null or v_last_patient < now() - interval '23 hours 30 minutes' then
    return query select 'window_closed'::text, null::uuid, v_conv.assigned_to, app.member_first_name(p_clinic_id, v_conv.assigned_to);
    return;
  end if;

  insert into public.whatsapp_media (clinic_id, direction, mime_type, size_bytes, sha256, file_name, storage_path, status, stored_at)
  values (p_clinic_id, 'outbound', p_mime_type, p_size_bytes, p_sha256, left(nullif(btrim(coalesce(p_file_name, '')), ''), 255), p_storage_path, 'stored', now())
  returning id into v_media;

  insert into public.whatsapp_messages (
    clinic_id, contact_id, contact_phone, direction, message_type, body, status, author, sent_by, handoff_id, client_key, media_id
  )
  values (
    p_clinic_id, v_conv.contact_id, p_contact_phone, 'outbound', 'panel_reply', v_caption, 'sending', 'agent_panel', v_user,
    v_conv.handoff_id, p_client_key, v_media
  )
  returning id into v_id;
  update public.whatsapp_media w set message_id = v_id where w.id = v_media;

  -- Responder assume (decisão 5), como a resposta em texto.
  update public.conversation_state c set assigned_to = v_user
   where c.id = v_conv.id and c.assigned_to is distinct from v_user;
  update public.conversation_state c
     set handoff_status = 'in_progress', handoff_status_at = now(), handoff_changed_by = 'reception'
   where c.id = v_conv.id and c.handoff_status is distinct from 'in_progress';

  insert into public.conversation_reads (clinic_id, contact_phone, user_id, last_read_at)
  values (p_clinic_id, p_contact_phone, v_user, now())
  on conflict (clinic_id, contact_phone, user_id) do update set last_read_at = excluded.last_read_at;

  return query select 'ok'::text, v_id, v_user, app.member_first_name(p_clinic_id, v_user);
end
$function$;

CREATE OR REPLACE FUNCTION public.central_resume_prepare(p_clinic_id uuid, p_contact_phone text, p_client_key uuid, p_body text, p_template_name text, p_expected_assigned uuid)
 RETURNS TABLE(outcome text, message_id uuid, assigned_to uuid, assigned_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- Número marcado (NA): responde sem atendimento; o bot continua calado.
  if not v_conv.human_handoff and v_conv.classification = 'patient' then
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
$function$;

drop function public.central_conversations(uuid, boolean, text, integer);
CREATE FUNCTION public.central_conversations(p_clinic_id uuid, p_finished boolean DEFAULT false, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 200, p_classified boolean DEFAULT false)
 RETURNS TABLE(contact_phone text, contact_id uuid, name text, human_handoff boolean, handoff_status text, handoff_status_at timestamp with time zone, handoff_started_at timestamp with time zone, handoff_reason text, handoff_subject text, assigned_to uuid, assigned_name text, last_message_at timestamp with time zone, last_message_author text, last_message_preview text, last_patient_at timestamp with time zone, unread integer, profile_name text, handoff_id uuid, classification text, classified_at timestamp with time zone, classified_by_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := (select auth.uid());
  v_all boolean := app.is_platform_staff() or app.has_clinic_role(p_clinic_id, array['admin', 'reception']::public.clinic_role[]);
  v_professional boolean := app.has_clinic_role(p_clinic_id, array['professional']::public.clinic_role[]);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_digits text := nullif(regexp_replace(coalesce(p_search, ''), '\D', '', 'g'), '');
begin
  if not app.central_active(p_clinic_id) then
    raise exception 'A Central de atendimento não está ligada nesta clínica.'
      using errcode = 'P0001', hint = 'feature_disabled:central_attendance';
  end if;
  if not v_all and not v_professional then
    raise exception 'Sem acesso às conversas desta clínica.' using errcode = '42501';
  end if;
  if exists (select 1 from public.clinics k where k.id = p_clinic_id and k.status = 'onboarding') then
    return;
  end if;
  return query
    select c.contact_phone, coalesce(c.contact_id, pc.id), coalesce(ct.full_name, pc.full_name), c.human_handoff,
           c.handoff_status, c.handoff_status_at, c.handoff_started_at, c.handoff_reason, c.handoff_subject,
           c.assigned_to, nullif(btrim(mem.display_name), ''), c.last_message_at, c.last_message_author,
           c.last_message_preview, c.last_patient_at,
           case when c.human_handoff and not app.is_platform_staff() then (
             select least(count(*), 99)::integer from public.whatsapp_messages m
              where m.clinic_id = c.clinic_id and m.contact_phone = c.contact_phone
                and m.direction = 'inbound' and m.source = 'live'
                and m.sort_at > coalesce(r.last_read_at, c.handoff_started_at, c.human_handoff_at)
           ) when c.classification <> 'patient' and not app.is_platform_staff() then (
             select least(count(*), 99)::integer from public.whatsapp_messages m
              where m.clinic_id = c.clinic_id and m.contact_phone = c.contact_phone
                and m.direction = 'inbound' and m.source = 'live'
                and m.sort_at > coalesce(r.last_read_at, c.classified_at)
           ) else 0 end,
           c.profile_name, c.handoff_id, c.classification, c.classified_at,
           case when c.classified_by is not null then app.member_first_name(c.clinic_id, c.classified_by) end
      from public.conversation_state c
      left join public.contacts ct on ct.clinic_id = c.clinic_id and ct.id = c.contact_id
      left join lateral (
        select x.id, x.full_name from public.contacts x
         where c.contact_id is null and x.clinic_id = c.clinic_id and x.phone = c.contact_phone and x.is_active
         limit 1
      ) pc on true
      left join public.clinic_members mem on mem.clinic_id = c.clinic_id and mem.user_id = c.assigned_to
      left join public.conversation_reads r on r.clinic_id = c.clinic_id and r.contact_phone = c.contact_phone and r.user_id = v_user
     where c.clinic_id = p_clinic_id
       and c.contact_phone is distinct from (select s.support_whatsapp from public.platform_settings s limit 1)
       and (case
              when p_classified then c.classification <> 'patient'
              when p_finished then not c.human_handoff and c.classification = 'patient'
              else c.human_handoff
            end)
       and (not p_classified or v_all)
       and (v_all or (c.human_handoff and c.assigned_to = v_user))
       and (not p_finished or c.last_message_at is not null)
       and (
         v_search is null
         or coalesce(ct.full_name, pc.full_name, '') ilike '%' || v_search || '%'
         or coalesce(c.profile_name, '') ilike '%' || v_search || '%'
         or (v_digits is not null and length(v_digits) >= 4 and regexp_replace(c.contact_phone, '\D', '', 'g') like '%' || v_digits || '%')
       )
     order by
       case when not p_finished and c.handoff_status = 'waiting_clinic' then 0 else 1 end,
       case when not p_finished and c.handoff_status = 'waiting_clinic' then c.handoff_status_at end asc nulls last,
       c.last_message_at desc nulls last,
       c.contact_phone
     limit greatest(1, least(coalesce(p_limit, 200), 500));
end
$function$;

revoke execute on function public.central_conversations(uuid, boolean, text, integer, boolean) from public, anon, clinic_service;
grant execute on function public.central_conversations(uuid, boolean, text, integer, boolean) to authenticated;
