-- CN5 — mídia recebida na Central (plano em docs/planejamento-central-atendimento.md, seção 6 e decisões 8b e 8c,
-- cliente, 05/nov/2026). Aditiva.
--
-- 1. O anexo do paciente só é guardado com a Central valendo (D12 revista, como o texto): a linha em `whatsapp_media`
--    nem entra com a Central desligada. O webhook só grava "pendente"; a rotina `/api/cron/midias` (a cada minuto)
--    baixa da Meta, confere tipo e tamanho e sobe ao bucket `whatsapp-media`.
-- 2. A tela lê os dados dos anexos da conversa por `central_conversation_media` (mesmo acesso da conversa); o arquivo
--    sai por URL assinada curta, depois da `central_media_access` (que registra a abertura).
--
-- Reversão: cron.unschedule('midias'); drop das funções e do gatilho novos.

create function app.whatsapp_media_guard()
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
create trigger whatsapp_media_guard before insert on public.whatsapp_media
  for each row execute function app.whatsapp_media_guard();

-- Anexos de mensagens da conversa (ids vindos do histórico já lido): situação, tipo, tamanho e nome.
create function public.central_conversation_media(p_clinic_id uuid, p_contact_phone text, p_media_ids uuid[])
returns table (id uuid, status text, mime_type text, size_bytes bigint, file_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_conversation_access(p_clinic_id, p_contact_phone);
  return query
    select w.id, w.status, w.mime_type, w.size_bytes, w.file_name
      from public.whatsapp_media w
     where w.clinic_id = p_clinic_id and w.id = any(coalesce(p_media_ids, '{}'::uuid[]))
       and exists (
         select 1 from public.whatsapp_messages m
          where m.clinic_id = p_clinic_id and m.media_id = w.id and m.contact_phone = p_contact_phone
       );
end
$$;
revoke execute on function public.central_conversation_media(uuid, text, uuid[]) from public, anon, clinic_service;
grant execute on function public.central_conversation_media(uuid, text, uuid[]) to authenticated;

-- A rotina lê o bucket para gerar a URL assinada (a política de leitura do serviço já existe, CN1).
select cron.schedule('midias', '* * * * *', $$ select app.call_system_route('/api/cron/midias') $$);
