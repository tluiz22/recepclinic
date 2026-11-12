-- CN6 — enviar foto e PDF pela Central (plano em docs/arquivo/modulos/planejamento-central-atendimento.md, seção 6 e decisão 8b,
-- cliente, 05/nov/2026). Aditiva.
--
-- 1. O navegador sobe o arquivo direto ao bucket `whatsapp-media` (link de envio de uso único, gerado pelo servidor
--    com a credencial da clínica, na pasta `<clínica>/<telefone>/env-<chave>.<ext>`). O servidor confere o arquivo
--    (tipo pelo conteúdo e tamanho: foto JPEG/PNG até 5 MB, PDF até 10 MB) e chama `central_media_send_prepare`, que
--    tem as mesmas regras da resposta em texto (quem pode, 24 h, responsável que a tela mostrou, a chave da tela) e
--    grava a mensagem "enviando" com o anexo (legenda opcional, até 1.024 caracteres, o limite da Meta).
-- 2. "Tentar de novo" numa mensagem com anexo: a `central_send_retry` devolve `media` (o servidor sobe o arquivo à
--    Meta de novo e envia).
--
-- Reversão: drop function public.central_media_send_prepare; a central_send_retry de 20261220120000.

create function public.central_media_send_prepare(
  p_clinic_id uuid,
  p_contact_phone text,
  p_client_key uuid,
  p_caption text,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes bigint,
  p_file_name text,
  p_sha256 text,
  p_expected_assigned uuid
)
returns table (outcome text, message_id uuid, assigned_to uuid, assigned_name text)
language plpgsql
security definer
set search_path = ''
as $$
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

  if not v_conv.human_handoff then
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
$$;
revoke execute on function public.central_media_send_prepare(uuid, text, uuid, text, text, text, bigint, text, text, uuid) from public, anon, clinic_service;
grant execute on function public.central_media_send_prepare(uuid, text, uuid, text, text, text, bigint, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Tentar de novo: anexo
-- ---------------------------------------------------------------------------
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
  -- O "Retomar conversa" (modelo) sai fora das 24 h; o resto só dentro.
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
  return query select
    case when v_msg.message_type = 'conversation_resume' then 'resume'
         when v_msg.media_id is not null then 'media'
         else 'ok' end,
    v_msg.contact_phone, v_msg.body;
end
$$;
