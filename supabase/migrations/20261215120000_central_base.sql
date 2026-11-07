-- CN1 (Central de Atendimento, plano seções 3.2, 4, 6 e 8; decisões 1 a 12 e seção 14, cliente, 05/nov/2026): a base
-- de dados da Central, toda aditiva. Nada muda no caminho do bot nem nas telas de hoje; a gravação do texto (CN2) e as
-- telas (CN3 em diante) vêm depois.
--
--  1. Item da matriz "Central de atendimento" (depende do bot) e o liga/desliga pelo Administrador da clínica, com o
--     registro de cada troca (`central_switches`): a Central vale com o item liberado E a última troca ligada.
--  2. `whatsapp_messages`: autor, usuário do painel, atendimento, hora da Meta, ordem do histórico, origem (ao vivo ou
--     histórico importado), edição/exclusão pelo app, anexo e a chave de idempotência do envio pelo painel. Carga do
--     autor e da ordem das mensagens que já existem.
--  3. `whatsapp_media` (anexos) e o bucket privado `whatsapp-media` (só a credencial da clínica lê e grava).
--  4. `conversation_state`: responsável, última mensagem (hora, prévia e autor) e a última do paciente. O responsável
--     sai sozinho quando a conversa volta ao bot.
--  5. `handoff_events`: o tipo do evento (situação, assumida, transferida, liberada, finalizada) e o responsável de
--     antes e de depois.
--  6. Não lidas por pessoa (`conversation_reads`) e o registro de acesso (`conversation_access_log`, LGPD: quem abriu
--     qual conversa e quem baixou qual anexo).
--  7. Leitura: `central_conversation_messages` (histórico paginado, com o texto) e `central_media_access` (anexo),
--     que conferem a Central ligada e quem pode ver (Administrador e Recepção: todas; Profissional: só a que está com
--     ele; Suporte: todas) e registram o acesso. O texto continua fechado ao login direto pela API.

-- ---------------------------------------------------------------------------
-- 1. Item da matriz e o liga/desliga pelo Administrador
-- ---------------------------------------------------------------------------
insert into public.features (key, area, label, depends_on, sort_order)
values ('central_attendance', 'whatsapp', 'Central de atendimento', '{whatsapp_bot}', 77);

create table public.central_switches (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  enabled boolean not null,
  actor_id uuid references auth.users (id) on delete set null,
  occurred_at timestamptz not null default now()
);
create index central_switches_clinic_idx on public.central_switches (clinic_id, occurred_at desc, id desc);

comment on table public.central_switches is
  'Cada vez que o Administrador liga ou desliga a Central (seção 14): o período em que o texto foi guardado.';

alter table public.central_switches enable row level security;
create policy central_switches_select on public.central_switches for select to authenticated
  using (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]) or app.is_platform_staff());
create policy central_switches_service on public.central_switches for select to clinic_service
  using (clinic_id = app.service_clinic_id());
revoke insert, update, delete on public.central_switches from anon, authenticated, clinic_service;
grant select on public.central_switches to authenticated, clinic_service;
create trigger central_switches_audit_platform_staff after insert or update or delete on public.central_switches
  for each row execute function app.audit_platform_staff_write();

-- A Central vale para a clínica: item liberado pelo Suporte e ligada pelo Administrador (última troca).
create function app.central_active(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.clinic_has_feature(p_clinic_id, 'central_attendance')
     and coalesce((
       select s.enabled from public.central_switches s
        where s.clinic_id = p_clinic_id
        order by s.occurred_at desc, s.id desc
        limit 1
     ), false)
$$;
grant execute on function app.central_active(uuid) to authenticated, clinic_service;

-- Ligar exige o item liberado; desligar vale sempre. Sem mudança, sem registro.
create function public.set_central_enabled(p_clinic_id uuid, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current boolean := coalesce((
    select s.enabled from public.central_switches s
     where s.clinic_id = p_clinic_id
     order by s.occurred_at desc, s.id desc
     limit 1
  ), false);
begin
  if not app.has_clinic_role(p_clinic_id, array['admin']::public.clinic_role[]) then
    raise exception 'Só o Administrador da clínica liga ou desliga a Central de atendimento.' using errcode = '42501';
  end if;
  if p_enabled then
    perform app.require_feature(p_clinic_id, 'central_attendance');
  end if;
  if v_current is not distinct from p_enabled then
    return false;
  end if;
  insert into public.central_switches (clinic_id, enabled, actor_id) values (p_clinic_id, p_enabled, (select auth.uid()));
  return true;
end
$$;
revoke execute on function public.set_central_enabled(uuid, boolean) from public, anon, clinic_service;
grant execute on function public.set_central_enabled(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Anexos (antes das colunas das mensagens, que apontam para cá)
-- ---------------------------------------------------------------------------
create table public.whatsapp_media (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  message_id uuid,
  direction text not null check (direction in ('inbound', 'outbound')),
  meta_media_id text,
  mime_type text check (char_length(mime_type) <= 120),
  size_bytes bigint check (size_bytes >= 0),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  file_name text check (char_length(file_name) <= 255),
  storage_path text unique check (storage_path like clinic_id::text || '/%'),
  status text not null default 'pending' check (status in ('pending', 'stored', 'failed', 'too_large', 'unsupported', 'deleted')),
  attempts smallint not null default 0 check (attempts between 0 and 10),
  error text check (char_length(error) <= 300),
  created_at timestamptz not null default now(),
  stored_at timestamptz,
  deleted_at timestamptz,
  unique (clinic_id, id)
);
create index whatsapp_media_pending_idx on public.whatsapp_media (created_at) where status = 'pending';
create index whatsapp_media_message_idx on public.whatsapp_media (message_id);

comment on table public.whatsapp_media is
  'Anexos das conversas (CN1): o arquivo fica no bucket whatsapp-media; leitura pela central_media_access.';

-- Só a credencial da clínica lê e grava; o login (painel) chega pela central_media_access.
alter table public.whatsapp_media enable row level security;
create policy whatsapp_media_service on public.whatsapp_media for all to clinic_service
  using (clinic_id = app.service_clinic_id()) with check (clinic_id = app.service_clinic_id());
create trigger whatsapp_media_audit_platform_staff after insert or update or delete on public.whatsapp_media
  for each row execute function app.audit_platform_staff_write();
revoke all on public.whatsapp_media from anon, authenticated;
grant select, insert, update on public.whatsapp_media to clinic_service;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('whatsapp-media', 'whatsapp-media', false, 16777216, null);

-- Caminho <clinic_id>/<telefone sem +>/<id da mensagem>.<ext>. Só a credencial da clínica, na própria pasta; o painel
-- recebe URL assinada curta, gerada no servidor depois da central_media_access.
create policy whatsapp_media_select_service on storage.objects for select to clinic_service
  using (bucket_id = 'whatsapp-media' and app.storage_folder_clinic(name) = app.service_clinic_id());
create policy whatsapp_media_insert_service on storage.objects for insert to clinic_service
  with check (bucket_id = 'whatsapp-media' and app.storage_folder_clinic(name) = app.service_clinic_id());
create policy whatsapp_media_delete_service on storage.objects for delete to clinic_service
  using (bucket_id = 'whatsapp-media' and app.storage_folder_clinic(name) = app.service_clinic_id());
grant insert, delete on storage.objects to clinic_service;

-- ---------------------------------------------------------------------------
-- 2. Mensagens
-- ---------------------------------------------------------------------------
alter table public.whatsapp_messages
  add column author text check (author in ('patient', 'bot', 'system', 'agent_app', 'agent_panel')),
  add column sent_by uuid references auth.users (id) on delete set null,
  add column handoff_id uuid,
  add column wa_timestamp timestamptz,
  add column sort_at timestamptz,
  add column source text not null default 'live' check (source in ('live', 'history')),
  add column edited_at timestamptz,
  add column revoked_at timestamptz,
  add column media_id uuid,
  add column client_key uuid;

alter table public.whatsapp_messages
  add constraint whatsapp_messages_media_fkey foreign key (clinic_id, media_id)
    references public.whatsapp_media (clinic_id, id) on delete set null (media_id);
create unique index whatsapp_messages_client_key_idx on public.whatsapp_messages (clinic_id, client_key) where client_key is not null;

-- Autor pela direção e pelo tipo (a carga e as gravações de hoje, que não informam o autor).
create function app.message_author(p_direction text, p_message_type text, p_template_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_direction = 'inbound' then 'patient'
    when p_message_type = 'agent_reply' then 'agent_app'
    when p_template_name is not null then 'system'
    when p_message_type in (
      'app_auto_reply', 'connection_test', 'template', 'appointment_reminder', 'appointment_confirmation',
      'appointment_reschedule', 'appointment_cancellation', 'appointment_mass_cancellation', 'consultation_guidance',
      'exam_preparation', 'waitlist_offer', 'nfse_document', 'daily_summary_consultas', 'daily_summary_exames'
    ) then 'system'
    else 'bot'
  end
$$;

-- Ordem do histórico pela hora da Meta (o histórico importado chega com a data original) e autor quando quem grava
-- não informa. A mensagem automática do app (IS4) vira `app_auto_reply` depois de gravada: o autor acompanha.
create function app.whatsapp_message_defaults()
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
  elsif new.message_type is distinct from old.message_type and new.author is distinct from 'agent_panel' then
    new.author := app.message_author(new.direction, new.message_type, new.template_name);
  end if;
  return new;
end
$$;
create trigger whatsapp_messages_defaults before insert or update of message_type on public.whatsapp_messages
  for each row execute function app.whatsapp_message_defaults();

-- Carga das mensagens que já existem (o texto apagado em 28/out não volta: "Mensagem anterior à Central").
update public.whatsapp_messages
   set author = app.message_author(direction, message_type, template_name),
       sort_at = created_at;

alter table public.whatsapp_messages
  alter column author set not null,
  alter column sort_at set not null;

create index whatsapp_messages_history_idx on public.whatsapp_messages (clinic_id, contact_phone, sort_at desc, id desc);

-- O login lê as colunas novas (sem texto); body e retry_payload seguem fechados (20261028150000).
grant select (author, sent_by, handoff_id, wa_timestamp, sort_at, source, edited_at, revoked_at, media_id, client_key)
  on public.whatsapp_messages to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Conversa: responsável e última mensagem
-- ---------------------------------------------------------------------------
alter table public.conversation_state
  add column assigned_to uuid references auth.users (id) on delete set null,
  add column assigned_at timestamptz,
  add column last_message_at timestamptz,
  add column last_message_preview text check (char_length(last_message_preview) <= 120),
  add column last_message_author text check (last_message_author in ('patient', 'bot', 'system', 'agent_app', 'agent_panel')),
  add column last_patient_at timestamptz;

create index conversation_state_inbox_idx on public.conversation_state (clinic_id, human_handoff, last_message_at desc);

-- A prévia é texto do paciente: fora da leitura direta pela API (vem pela função da lista, no CN3).
revoke select on public.conversation_state from anon, authenticated;
grant select (
  id, clinic_id, contact_phone, contact_id, state, context, human_handoff, funnel_session_id, funnel_flow, updated_at,
  human_handoff_at, handoff_reason, handoff_started_at, handoff_notified_at, handoff_reminded_at, not_understood_count,
  handoff_subject, handoff_subject_asked_at, handoff_status, handoff_status_at, handoff_id, handoff_changed_by,
  assigned_to, assigned_at, last_message_at, last_message_author, last_patient_at
) on public.conversation_state to authenticated;

-- De volta ao bot (Finalizar, #bot, 12 h), o responsável sai; trocou o responsável, guarda a hora.
create function app.conversation_assignment_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not new.human_handoff then
    new.assigned_to := null;
  end if;
  if tg_op = 'INSERT' then
    new.assigned_at := case when new.assigned_to is not null then coalesce(new.assigned_at, now()) end;
  elsif new.assigned_to is distinct from old.assigned_to then
    new.assigned_at := case when new.assigned_to is not null then now() end;
  end if;
  return new;
end
$$;
create trigger conversation_state_assignment_defaults before insert or update on public.conversation_state
  for each row execute function app.conversation_assignment_defaults();

-- ---------------------------------------------------------------------------
-- 5. Eventos do atendimento: tipo e responsável
-- ---------------------------------------------------------------------------
alter table public.handoff_events
  add column kind text not null default 'status' check (kind in ('status', 'assigned', 'transferred', 'released', 'finished')),
  add column assigned_from uuid references auth.users (id) on delete set null,
  add column assigned_to uuid references auth.users (id) on delete set null;

-- Os eventos que já existem: voltar ao bot é "finalizada".
update public.handoff_events set kind = 'finished' where to_status = 'bot' and from_status <> 'bot';

create or replace function app.conversation_handoff_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text := case when tg_op = 'INSERT' or not old.human_handoff then 'bot' else old.handoff_status end;
  v_to text := case when new.human_handoff then new.handoff_status else 'bot' end;
  v_old_assigned uuid := case when tg_op = 'UPDATE' then old.assigned_to end;
  v_status_changed boolean := v_from is distinct from v_to;
  v_assignment_changed boolean := v_old_assigned is distinct from new.assigned_to;
  v_kind text;
begin
  if not v_status_changed and not v_assignment_changed then
    return null;
  end if;
  v_kind := case
    when v_status_changed and v_to = 'bot' then 'finished'
    when v_status_changed then 'status'
    when v_old_assigned is null then 'assigned'
    when new.assigned_to is null then 'released'
    else 'transferred'
  end;
  insert into public.handoff_events (
    clinic_id, contact_phone, contact_id, handoff_id, from_status, to_status, origin, actor_id, occurred_at,
    kind, assigned_from, assigned_to
  )
  values (
    new.clinic_id,
    new.contact_phone,
    new.contact_id,
    coalesce(new.handoff_id, case when tg_op = 'UPDATE' then old.handoff_id end),
    coalesce(v_from, 'waiting_clinic'),
    coalesce(v_to, 'waiting_clinic'),
    coalesce(new.handoff_changed_by, 'system'),
    (select auth.uid()),
    case when v_status_changed then coalesce(new.handoff_status_at, now()) else now() end,
    v_kind,
    v_old_assigned,
    new.assigned_to
  );
  return null;
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Não lidas por pessoa e registro de acesso
-- ---------------------------------------------------------------------------
create table public.conversation_reads (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  contact_phone text not null check (contact_phone ~ '^\+\d{10,15}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (clinic_id, contact_phone, user_id)
);
alter table public.conversation_reads enable row level security;
create policy conversation_reads_select on public.conversation_reads for select to authenticated
  using (user_id = (select auth.uid()) and app.is_clinic_member(clinic_id));
revoke insert, update, delete on public.conversation_reads from anon, authenticated;
grant select on public.conversation_reads to authenticated;
create trigger conversation_reads_audit_platform_staff after insert or update or delete on public.conversation_reads
  for each row execute function app.audit_platform_staff_write();

create table public.conversation_access_log (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  contact_phone text not null check (contact_phone ~ '^\+\d{10,15}$'),
  user_id uuid references auth.users (id) on delete set null,
  action text not null check (action in ('open', 'media')),
  media_id uuid,
  occurred_at timestamptz not null default now()
);
create index conversation_access_log_clinic_idx on public.conversation_access_log (clinic_id, occurred_at desc);
comment on table public.conversation_access_log is
  'Quem abriu qual conversa e quem baixou qual anexo (CN1, LGPD: dado de saúde). Gravado pelas funções de leitura.';
alter table public.conversation_access_log enable row level security;
create policy conversation_access_log_select on public.conversation_access_log for select to authenticated
  using (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]) or app.is_platform_staff());
revoke insert, update, delete on public.conversation_access_log from anon, authenticated;
grant select on public.conversation_access_log to authenticated;
create trigger conversation_access_log_audit_platform_staff after insert or update or delete on public.conversation_access_log
  for each row execute function app.audit_platform_staff_write();

-- ---------------------------------------------------------------------------
-- 7. Leitura
-- ---------------------------------------------------------------------------
-- Quem pode ver a conversa (decisão 4): Suporte, Administrador e Recepção, todas; Profissional, só a que está com ele.
create function app.can_view_conversation(p_clinic_id uuid, p_contact_phone text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_platform_staff()
      or app.has_clinic_role(p_clinic_id, array['admin', 'reception']::public.clinic_role[])
      or (
        app.has_clinic_role(p_clinic_id, array['professional']::public.clinic_role[])
        and exists (
          select 1 from public.conversation_state c
           where c.clinic_id = p_clinic_id and c.contact_phone = p_contact_phone
             and c.human_handoff and c.assigned_to = (select auth.uid())
        )
      )
$$;
grant execute on function app.can_view_conversation(uuid, text) to authenticated;

create function app.require_conversation_access(p_clinic_id uuid, p_contact_phone text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.central_active(p_clinic_id) then
    raise exception 'A Central de atendimento não está ligada nesta clínica.'
      using errcode = 'P0001', hint = 'feature_disabled:central_attendance';
  end if;
  if not app.can_view_conversation(p_clinic_id, p_contact_phone) then
    raise exception 'Esta conversa não está com você.' using errcode = '42501';
  end if;
end
$$;

-- Histórico paginado (mais nova primeiro, cursor sort_at + id). A primeira página registra a abertura e marca como
-- lida para quem abriu (decisão 6).
create function public.central_conversation_messages(
  p_clinic_id uuid,
  p_contact_phone text,
  p_before_sort_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50
)
returns table (
  id uuid, direction text, author text, message_type text, template_name text, body text, status text,
  failure_code integer, failure_reason text, sort_at timestamptz, created_at timestamptz, sent_by uuid,
  handoff_id uuid, source text, edited_at timestamptz, revoked_at timestamptz, media_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_conversation_access(p_clinic_id, p_contact_phone);
  if p_before_sort_at is null then
    insert into public.conversation_access_log (clinic_id, contact_phone, user_id, action)
    values (p_clinic_id, p_contact_phone, (select auth.uid()), 'open');
    if not app.is_platform_staff() then
      insert into public.conversation_reads (clinic_id, contact_phone, user_id, last_read_at)
      values (p_clinic_id, p_contact_phone, (select auth.uid()), now())
      on conflict (clinic_id, contact_phone, user_id) do update set last_read_at = excluded.last_read_at;
    end if;
  end if;
  return query
    select m.id, m.direction, m.author, m.message_type, m.template_name,
           case when m.revoked_at is null then m.body end,
           m.status, m.failure_code, m.failure_reason, m.sort_at, m.created_at, m.sent_by, m.handoff_id,
           m.source, m.edited_at, m.revoked_at, m.media_id
      from public.whatsapp_messages m
     where m.clinic_id = p_clinic_id
       and m.contact_phone = p_contact_phone
       and (p_before_sort_at is null or (m.sort_at, m.id) < (p_before_sort_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
     order by m.sort_at desc, m.id desc
     limit greatest(1, least(coalesce(p_limit, 50), 100));
end
$$;
revoke execute on function public.central_conversation_messages(uuid, text, timestamptz, uuid, integer) from public, anon, clinic_service;
grant execute on function public.central_conversation_messages(uuid, text, timestamptz, uuid, integer) to authenticated;

-- Anexo: confere o acesso à conversa, registra e devolve onde está o arquivo (o servidor gera a URL assinada curta).
create function public.central_media_access(p_clinic_id uuid, p_media_id uuid)
returns table (storage_path text, mime_type text, file_name text, size_bytes bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
begin
  select m.contact_phone into v_phone
    from public.whatsapp_messages m
   where m.clinic_id = p_clinic_id and m.media_id = p_media_id
   limit 1;
  if v_phone is null then
    raise exception 'Anexo não encontrado.' using errcode = 'P0002';
  end if;
  perform app.require_conversation_access(p_clinic_id, v_phone);
  insert into public.conversation_access_log (clinic_id, contact_phone, user_id, action, media_id)
  values (p_clinic_id, v_phone, (select auth.uid()), 'media', p_media_id);
  return query
    select w.storage_path, w.mime_type, w.file_name, w.size_bytes
      from public.whatsapp_media w
     where w.clinic_id = p_clinic_id and w.id = p_media_id and w.status = 'stored';
end
$$;
revoke execute on function public.central_media_access(uuid, uuid) from public, anon, clinic_service;
grant execute on function public.central_media_access(uuid, uuid) to authenticated;
