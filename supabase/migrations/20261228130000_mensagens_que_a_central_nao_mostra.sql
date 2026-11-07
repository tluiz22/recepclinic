-- EC — mensagens que a Central não mostra (cliente, 07/nov/2026; plano da Central, seção 16).
--
-- A resposta pelo app do WhatsApp (eco) segue gravada como `agent_reply` (a pausa do bot, as métricas e a guarda do
-- texto dependem disso), mas agora guarda também o tipo real do conteúdo em `content_type` (image, audio, location,
-- reaction…); null = texto. Assim a Central mostra o anexo (baixado como o do paciente) ou descreve a mensagem, em vez
-- de cair em "Mensagem anterior à Central".
-- O histórico da conversa diz, para cada mensagem, se ela foi gravada com a Central ligada (`central_on`): sem texto e
-- gravada com a Central ligada, a tela pede para ver no app do WhatsApp; só a gravada antes é "anterior à Central".
--
-- Reversão: recriar central_conversation_messages como na 20261217120000 (drop desta versão antes) e
-- `alter table public.whatsapp_messages drop column content_type`.

alter table public.whatsapp_messages
  add column content_type text check (content_type is null or content_type ~ '^[a-z_]{1,40}$');

comment on column public.whatsapp_messages.content_type is
  'Eco do app (agent_reply): o tipo do conteúdo vindo da Meta (image, audio, location, reaction…); null = texto.';

grant select (content_type) on public.whatsapp_messages to authenticated;

drop function public.central_conversation_messages(uuid, text, timestamptz, uuid, integer);

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
  handoff_id uuid, source text, edited_at timestamptz, revoked_at timestamptz, media_id uuid,
  content_type text, central_on boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_conversation_access(p_clinic_id, p_contact_phone);
  if p_before_sort_at is null then
    if not exists (
      select 1 from public.conversation_access_log l
       where l.clinic_id = p_clinic_id and l.contact_phone = p_contact_phone and l.user_id = (select auth.uid())
         and l.action = 'open' and l.occurred_at > now() - interval '15 minutes'
    ) then
      insert into public.conversation_access_log (clinic_id, contact_phone, user_id, action)
      values (p_clinic_id, p_contact_phone, (select auth.uid()), 'open');
    end if;
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
           m.source, m.edited_at, m.revoked_at, m.media_id, m.content_type,
           -- Gravada com a Central ligada pelo Administrador (a última troca antes da gravação).
           coalesce((
             select s.enabled from public.central_switches s
              where s.clinic_id = m.clinic_id and s.occurred_at <= m.created_at
              order by s.occurred_at desc, s.id desc
              limit 1
           ), false)
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
