-- CN4a — responder, assumir e transferir pela Central (plano em docs/planejamento-central-atendimento.md, decisões 4,
-- 5 e 7 e R2, cliente, 05/nov/2026). Aditiva.
--
-- 1. Responder (`central_send_prepare`): confere quem pode, a janela de 24 h e o responsável que a tela mostrou;
--    grava a mensagem "enviando" (tipo `panel_reply`, autor `agent_panel`, com a chave da tela: o mesmo envio não sai
--    duas vezes) e quem envia vira o responsável, com a conversa "Em atendimento". Enviar de verdade e gravar o
--    resultado é do servidor (credencial da clínica). Envio simultâneo: o segundo recebe "changed" e não sai.
-- 2. "Tentar de novo" (`central_send_retry`): a mensagem que falhou volta para "enviando", uma vez.
-- 3. Assumir e transferir (`central_assign`): Administrador e Recepção (e o Suporte); transferir para alguém da
--    equipe, inclusive Profissional; sem motivo (Etapa 2).
-- 4. O responsável só muda por essas funções: o login deixa de mudar `assigned_to` direto.
-- 5. O texto da resposta pela Central segue a mesma guarda do texto (D12 revista).
--
-- Reversão: drop das funções novas; grant update on public.conversation_state to authenticated; a guarda
-- de 20261216120000.

-- ---------------------------------------------------------------------------
-- 5. Guarda do texto: a resposta pela Central entra na regra
-- ---------------------------------------------------------------------------
create or replace function app.whatsapp_message_body_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.body is not null
     and (new.direction = 'inbound' or new.message_type in ('agent_reply', 'app_auto_reply', 'panel_reply'))
     and not app.central_active(new.clinic_id) then
    new.body := null;
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Responsável só pelas funções
-- ---------------------------------------------------------------------------
-- O login tinha update na tabela toda: passa a ter em todas as colunas menos as do responsável.
revoke update on public.conversation_state from authenticated;
do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = 'public.conversation_state'::regclass and a.attnum > 0 and not a.attisdropped
     and a.attname not in ('assigned_to', 'assigned_at');
  execute format('grant update (%s) on public.conversation_state to authenticated', v_cols);
end
$$;

-- Quem pode responder na conversa: Administrador, Recepção e Suporte; o Profissional, só a que está com ele.
create function app.can_reply_conversation(p_clinic_id uuid, p_assigned_to uuid, p_human_handoff boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_clinic_role(p_clinic_id, array['admin', 'reception']::public.clinic_role[])
      or coalesce(p_human_handoff and p_assigned_to = (select auth.uid())
          and app.has_clinic_role(p_clinic_id, array['professional']::public.clinic_role[]), false)
$$;

-- Primeiro nome de quem está com a conversa ("Ana assumiu agora"); sem nome na clínica, o começo do e-mail.
create function app.member_first_name(p_clinic_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(split_part(nullif(btrim(m.display_name), ''), ' ', 1), split_part(u.email, '@', 1))
    from public.clinic_members m
    join auth.users u on u.id = m.user_id
   where m.clinic_id = p_clinic_id and m.user_id = p_user_id
$$;

-- ---------------------------------------------------------------------------
-- 1. Responder
-- ---------------------------------------------------------------------------
-- outcome: ok (mensagem gravada, enviar), duplicate (essa chave já foi: não enviar de novo), bot (a conversa está com o
-- bot: o servidor pausa e chama de novo), changed (o responsável mudou desde que a tela abriu: não sai),
-- window_closed (mais de 24 h desde a última mensagem do paciente).
create function public.central_send_prepare(
  p_clinic_id uuid,
  p_contact_phone text,
  p_client_key uuid,
  p_body text,
  p_expected_assigned uuid
)
returns table (outcome text, message_id uuid, assigned_to uuid, assigned_name text)
language plpgsql
security definer
set search_path = ''
as $$
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
$$;
revoke execute on function public.central_send_prepare(uuid, text, uuid, text, uuid) from public, anon, clinic_service;
grant execute on function public.central_send_prepare(uuid, text, uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Tentar de novo
-- ---------------------------------------------------------------------------
-- Devolve o texto para reenviar (null = não dá: já saiu, outra pessoa já tentou, ou fora das 24 h).
create function public.central_send_retry(p_clinic_id uuid, p_message_id uuid)
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
  -- "Enviando" há mais de 2 min: o servidor caiu no meio; pode tentar de novo.
  if not (v_msg.status = 'failed' or (v_msg.status = 'sending' and v_msg.created_at < now() - interval '2 minutes')) then
    return query select 'already'::text, v_msg.contact_phone, null::text;
    return;
  end if;
  select max(m.created_at) into v_last_patient from public.whatsapp_messages m
   where m.clinic_id = p_clinic_id and m.contact_phone = v_msg.contact_phone
     and m.direction = 'inbound' and m.source = 'live';
  if v_last_patient is null or v_last_patient < now() - interval '23 hours 30 minutes' then
    return query select 'window_closed'::text, v_msg.contact_phone, null::text;
    return;
  end if;
  update public.whatsapp_messages m
     set status = 'sending', failure_reason = null, failure_code = null, created_at = now()
   where m.id = v_msg.id;
  return query select 'ok'::text, v_msg.contact_phone, v_msg.body;
end
$$;
revoke execute on function public.central_send_retry(uuid, uuid) from public, anon, clinic_service;
grant execute on function public.central_send_retry(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Assumir e transferir
-- ---------------------------------------------------------------------------
-- p_to null = assumir (quem chama). outcome: ok, changed (o responsável mudou desde que a tela abriu), closed (a
-- conversa já foi finalizada), same (já estava com essa pessoa).
create function public.central_assign(
  p_clinic_id uuid,
  p_contact_phone text,
  p_expected_assigned uuid,
  p_to uuid default null
)
returns table (outcome text, assigned_to uuid, assigned_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_to uuid := coalesce(p_to, (select auth.uid()));
  v_conv public.conversation_state%rowtype;
begin
  if not app.central_active(p_clinic_id) then
    raise exception 'A Central de atendimento não está ligada nesta clínica.'
      using errcode = 'P0001', hint = 'feature_disabled:central_attendance';
  end if;
  if not app.has_clinic_role(p_clinic_id, array['admin', 'reception']::public.clinic_role[]) then
    raise exception 'Só o Administrador e a Recepção assumem ou transferem conversas.' using errcode = '42501';
  end if;
  if p_to is not null and not exists (
    select 1 from public.clinic_members m
     where m.clinic_id = p_clinic_id and m.user_id = p_to
       and m.roles && array['admin', 'reception', 'professional']::public.clinic_role[]
  ) then
    raise exception 'Essa pessoa não é da equipe da clínica.' using errcode = '22023';
  end if;
  if p_to is null and not exists (select 1 from public.clinic_members m where m.clinic_id = p_clinic_id and m.user_id = v_user) then
    raise exception 'Só quem é da equipe da clínica assume a conversa.' using errcode = '42501';
  end if;

  select * into v_conv from public.conversation_state c
   where c.clinic_id = p_clinic_id and c.contact_phone = p_contact_phone
   for update;
  if not found then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;
  if not v_conv.human_handoff then
    return query select 'closed'::text, null::uuid, null::text;
    return;
  end if;
  if v_conv.assigned_to is not distinct from v_to then
    return query select 'same'::text, v_to, app.member_first_name(p_clinic_id, v_to);
    return;
  end if;
  if v_conv.assigned_to is distinct from p_expected_assigned then
    return query select 'changed'::text, v_conv.assigned_to, app.member_first_name(p_clinic_id, v_conv.assigned_to);
    return;
  end if;
  update public.conversation_state c set assigned_to = v_to where c.id = v_conv.id;
  return query select 'ok'::text, v_to, app.member_first_name(p_clinic_id, v_to);
end
$$;
revoke execute on function public.central_assign(uuid, text, uuid, uuid) from public, anon, clinic_service;
grant execute on function public.central_assign(uuid, text, uuid, uuid) to authenticated;

-- Para quem transferir: a equipe que atende (nome na clínica; sem nome, o começo do e-mail).
create function public.central_team(p_clinic_id uuid)
returns table (user_id uuid, name text, roles public.clinic_role[])
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.has_clinic_role(p_clinic_id, array['admin', 'reception']::public.clinic_role[]) then
    raise exception 'Sem acesso à equipe desta clínica.' using errcode = '42501';
  end if;
  return query
    select m.user_id, coalesce(nullif(btrim(m.display_name), ''), split_part(u.email, '@', 1)), m.roles
      from public.clinic_members m
      join auth.users u on u.id = m.user_id
     where m.clinic_id = p_clinic_id
       and m.roles && array['admin', 'reception', 'professional']::public.clinic_role[]
     order by 2;
end
$$;
revoke execute on function public.central_team(uuid) from public, anon, clinic_service;
grant execute on function public.central_team(uuid) to authenticated;
