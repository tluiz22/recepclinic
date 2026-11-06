-- CN8 — histórico do app na conexão (plano em docs/planejamento-central-atendimento.md, decisão 10 e seção 4.7,
-- cliente, 05/nov/2026). Aditiva.
--
-- 1. `whatsapp_history_events`: o webhook só grava o evento `history` bruto (um por bloco do histórico, um por aviso
--    de recusa, um por lote de anexos que a Meta manda depois). Só com a Central valendo (como o texto, D12 revista).
-- 2. `central_history_process` (rotina de cada minuto, credencial da clínica): grava cada mensagem com
--    `source = 'history'`, a hora original e o mesmo `wa_message_id` (o índice único evita duplicar). Não cria conversa
--    (R3): o histórico aparece quando o paciente escrever de novo. Anexo antigo fica como "media_placeholder"; quando a
--    Meta manda o anexo (só dos últimos 14 dias), vira anexo pendente e a rotina dos anexos baixa.
-- 3. Mensagem do histórico não conta no uso do mês (não foi enviada agora) e não muda de autor quando o tipo muda.
-- 4. O evento bruto (tem o texto) sai 7 dias depois de processado, na rotina diária de guarda.
--
-- Reversão: drop table public.whatsapp_history_events; drop function public.central_history_process; as funções
-- app.count_outbound_message e app.whatsapp_message_defaults anteriores; a central_retention de 20261223120000.

create table public.whatsapp_history_events (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  kind text not null check (kind in ('chunk', 'media', 'declined')),
  phase smallint,
  chunk_order integer,
  progress smallint check (progress between 0 and 100),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts smallint not null default 0 check (attempts between 0 and 20),
  error text check (char_length(error) <= 300),
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index whatsapp_history_events_pending_idx on public.whatsapp_history_events (clinic_id, received_at) where status = 'pending';
comment on table public.whatsapp_history_events is
  'Histórico do app na conexão (CN8): evento bruto do webhook history, processado em lotes pela rotina.';

alter table public.whatsapp_history_events enable row level security;
create policy whatsapp_history_events_service on public.whatsapp_history_events for all to clinic_service
  using (clinic_id = app.service_clinic_id()) with check (clinic_id = app.service_clinic_id());
revoke all on public.whatsapp_history_events from anon, authenticated;
grant select, insert, update, delete on public.whatsapp_history_events to clinic_service;
create trigger whatsapp_history_events_audit_platform_staff after insert or update or delete on public.whatsapp_history_events
  for each row execute function app.audit_platform_staff_write();

-- Só com a Central valendo (o evento tem o texto das conversas).
create function app.whatsapp_history_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not app.central_active(new.clinic_id) then
    return null;
  end if;
  return new;
end
$$;
create trigger whatsapp_history_guard before insert on public.whatsapp_history_events
  for each row execute function app.whatsapp_history_guard();

-- ---------------------------------------------------------------------------
-- 3. Uso do mês e autor
-- ---------------------------------------------------------------------------
create or replace function app.count_outbound_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction = 'outbound' and new.source = 'live' and new.status is distinct from 'failed' and coalesce(new.status, '') not like 'skipped%' then
    perform app.bump_usage(new.clinic_id, 1, case when new.template_name is not null then 1 else 0 end, 0);
  end if;
  return null;
end
$$;

create or replace function app.whatsapp_message_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Gravação em lote pela API manda null nas colunas que faltam: a origem padrão é "ao vivo".
    new.source := coalesce(new.source, 'live');
    new.sort_at := coalesce(new.wa_timestamp, new.created_at, now());
    new.author := coalesce(new.author, app.message_author(new.direction, new.message_type, new.template_name));
  elsif new.message_type is distinct from old.message_type and new.author is distinct from 'agent_panel' and new.source = 'live' then
    new.author := app.message_author(new.direction, new.message_type, new.template_name);
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Processar
-- ---------------------------------------------------------------------------
-- Situação da mensagem no histórico ("READ" ou "read") para a do sistema.
create function app.history_status(p_direction text, p_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_direction = 'inbound' then 'received'
    when lower(coalesce(p_status, '')) in ('read', 'played') then 'read'
    when lower(coalesce(p_status, '')) = 'delivered' then 'delivered'
    when lower(coalesce(p_status, '')) = 'error' then 'failed'
    else 'sent'
  end
$$;

create function public.central_history_process(p_clinic_id uuid, p_limit integer default 5)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.whatsapp_history_events%rowtype;
  v_thread jsonb;
  v_msg jsonb;
  v_phone text;
  v_from text;
  v_direction text;
  v_type text;
  v_at timestamptz;
  v_contact uuid;
  v_media uuid;
  v_message uuid;
  v_inserted integer;
  v_messages integer := 0;
  v_media_count integer := 0;
  v_events integer := 0;
  v_waiting boolean;
begin
  if app.service_clinic_id() is distinct from p_clinic_id then
    raise exception 'Só a rotina da clínica processa o histórico.' using errcode = '42501';
  end if;
  if not app.central_active(p_clinic_id) then
    return jsonb_build_object('events', 0, 'messages', 0, 'media', 0);
  end if;

  for v_event in
    select * from public.whatsapp_history_events e
     where e.clinic_id = p_clinic_id and e.status = 'pending'
     order by e.kind = 'media', e.phase nulls last, e.chunk_order nulls last, e.id
     limit p_limit
     for update skip locked
  loop
    v_events := v_events + 1;
    v_waiting := false;
    begin
      if v_event.kind = 'chunk' then
        for v_thread in select * from jsonb_array_elements(coalesce(v_event.payload -> 'threads', '[]'::jsonb)) loop
          v_phone := '+' || regexp_replace(coalesce(v_thread ->> 'id', ''), '\D', '', 'g');
          continue when v_phone !~ '^\+\d{10,15}$';
          select c.id into v_contact from public.contacts c
           where c.clinic_id = p_clinic_id and c.phone = v_phone and c.is_active
           limit 1;
          for v_msg in select * from jsonb_array_elements(coalesce(v_thread -> 'messages', '[]'::jsonb)) loop
            continue when coalesce(v_msg ->> 'id', '') = '' or coalesce(v_msg ->> 'timestamp', '') !~ '^\d{1,12}$';
            v_from := regexp_replace(coalesce(v_msg ->> 'from', ''), '\D', '', 'g');
            v_direction := case when v_from = substr(v_phone, 2) then 'inbound' else 'outbound' end;
            v_type := left(coalesce(nullif(v_msg ->> 'type', ''), 'unknown'), 40);
            v_at := to_timestamp((v_msg ->> 'timestamp')::bigint);
            insert into public.whatsapp_messages (
              clinic_id, contact_id, contact_phone, direction, message_type, body, status, wa_message_id,
              wa_timestamp, created_at, author, source
            )
            values (
              p_clinic_id, v_contact, v_phone, v_direction, v_type,
              left(coalesce(v_msg -> 'text' ->> 'body', v_msg -> v_type ->> 'caption'), 4096),
              app.history_status(v_direction, v_msg -> 'history_context' ->> 'status'),
              left(v_msg ->> 'id', 200), v_at, v_at,
              case when v_direction = 'inbound' then 'patient' else 'agent_app' end, 'history'
            )
            on conflict (clinic_id, wa_message_id) where wa_message_id is not null do nothing;
            get diagnostics v_inserted = row_count;
            v_messages := v_messages + v_inserted;
          end loop;
        end loop;
      elsif v_event.kind = 'media' then
        -- Anexos que a Meta manda depois (só dos últimos 14 dias): ligados à mensagem do histórico pelo mesmo id.
        for v_msg in select * from jsonb_array_elements(coalesce(v_event.payload -> 'messages', '[]'::jsonb)) loop
          v_type := v_msg ->> 'type';
          continue when v_type not in ('image', 'audio', 'document', 'video', 'sticker') or coalesce(v_msg -> v_type ->> 'id', '') = '';
          select m.id into v_message from public.whatsapp_messages m
           where m.clinic_id = p_clinic_id and m.wa_message_id = v_msg ->> 'id' and m.media_id is null;
          if v_message is null then
            -- O bloco com a mensagem ainda não chegou (ou já tem o anexo): tenta de novo depois.
            if not exists (select 1 from public.whatsapp_messages m where m.clinic_id = p_clinic_id and m.wa_message_id = v_msg ->> 'id') then
              v_waiting := true;
            end if;
            continue;
          end if;
          insert into public.whatsapp_media (clinic_id, message_id, direction, meta_media_id, mime_type, file_name, status)
          values (
            p_clinic_id, v_message,
            (select m.direction from public.whatsapp_messages m where m.id = v_message),
            left(v_msg -> v_type ->> 'id', 200), left(v_msg -> v_type ->> 'mime_type', 120), left(v_msg -> v_type ->> 'filename', 255),
            case when v_type = 'sticker' then 'unsupported' else 'pending' end
          )
          returning id into v_media;
          update public.whatsapp_messages m
             set media_id = v_media, message_type = v_type,
                 body = coalesce(m.body, left(v_msg -> v_type ->> 'caption', 4096))
           where m.id = v_message;
          v_media_count := v_media_count + 1;
          v_message := null;
        end loop;
      end if;

      if v_waiting and v_event.attempts < 19 then
        update public.whatsapp_history_events e set attempts = e.attempts + 1 where e.id = v_event.id;
      else
        update public.whatsapp_history_events e
           set status = 'done', processed_at = now(), attempts = e.attempts + 1, error = null
         where e.id = v_event.id;
      end if;
    exception when others then
      update public.whatsapp_history_events e
         set attempts = least(e.attempts + 1, 20),
             status = case when e.attempts + 1 >= 3 then 'failed' else 'pending' end,
             error = left(sqlerrm, 300)
       where e.id = v_event.id;
    end;
  end loop;

  return jsonb_build_object('events', v_events, 'messages', v_messages, 'media', v_media_count);
end
$$;
revoke execute on function public.central_history_process(uuid, integer) from public, anon, authenticated;
grant execute on function public.central_history_process(uuid, integer) to clinic_service;
revoke execute on function app.history_status(text, text) from public, anon, authenticated, clinic_service;

-- ---------------------------------------------------------------------------
-- 4. Guarda: o evento bruto sai 7 dias depois de processado
-- ---------------------------------------------------------------------------
create or replace function public.central_retention(p_clinic_id uuid, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_texts integer;
  v_media integer;
  v_orphans integer;
  v_events integer;
begin
  if app.service_clinic_id() is distinct from p_clinic_id then
    raise exception 'Só a rotina da clínica aplica o prazo de guarda.' using errcode = '42501';
  end if;

  -- Texto: 5 anos.
  update public.whatsapp_messages m set body = null
   where m.clinic_id = p_clinic_id and m.body is not null
     and coalesce(m.sort_at, m.created_at) < p_now - interval '5 years';
  get diagnostics v_texts = row_count;

  -- Anexos: 12 meses da mensagem.
  update public.whatsapp_media w
     set status = 'deleted', deleted_at = p_now
    from public.whatsapp_messages m
   where w.clinic_id = p_clinic_id and w.status <> 'deleted'
     and m.clinic_id = p_clinic_id and m.media_id = w.id
     and coalesce(m.sort_at, m.created_at) < p_now - interval '12 months';
  get diagnostics v_media = row_count;

  -- Anexo sem mensagem (mensagem apagada): pela data do anexo.
  update public.whatsapp_media w
     set status = 'deleted', deleted_at = p_now
   where w.clinic_id = p_clinic_id and w.status <> 'deleted'
     and w.created_at < p_now - interval '12 months'
     and not exists (select 1 from public.whatsapp_messages m where m.clinic_id = p_clinic_id and m.media_id = w.id);
  get diagnostics v_orphans = row_count;

  -- Histórico do app (CN8): o evento bruto sai 7 dias depois de processado (ou recebido, se falhou).
  delete from public.whatsapp_history_events e
   where e.clinic_id = p_clinic_id and e.status <> 'pending'
     and coalesce(e.processed_at, e.received_at) < p_now - interval '7 days';
  get diagnostics v_events = row_count;

  return jsonb_build_object('texts', v_texts, 'media', v_media + v_orphans, 'history_events', v_events);
end
$$;
