-- CN7 — prazo de guarda e anonimização das conversas (plano em docs/planejamento-central-atendimento.md, seção 6 e
-- decisão 8, cliente, 05/nov/2026). Aditiva.
--
-- 1. Guarda (rotina diária `/api/cron/guarda-conversas`): texto das mensagens com mais de 5 anos fica nulo; anexo com
--    mais de 12 meses fica "apagado" (contados da data original da mensagem, inclusive as do histórico do app).
-- 2. Anonimização (`anonymize_patient`, que já apaga o texto e a conversa com o nome do perfil): os anexos do contato
--    ficam "apagados" na hora, as leituras saem e o telefone some do registro de acesso e dos eventos do atendimento.
-- 3. Arquivos: o banco não apaga do Storage. A rotina de cada minuto (`/api/cron/midias`) pede a lista
--    (`central_media_purge_list`: anexos apagados que ainda têm arquivo e arquivos enviados pela Central que não
--    viraram mensagem há mais de 1 hora), remove do bucket e confirma (`central_media_purged`).
--
-- Reversão: drop trigger contacts_drop_conversation_media on public.contacts; drop das funções novas;
-- cron.unschedule('guarda-conversas').

-- ---------------------------------------------------------------------------
-- 2. Anonimização
-- ---------------------------------------------------------------------------
create function app.drop_conversation_media_on_anonymize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.whatsapp_media w
     set status = 'deleted', deleted_at = now(), file_name = null, meta_media_id = null, error = null
   where w.clinic_id = new.clinic_id and w.status <> 'deleted'
     and w.id in (
       select m.media_id from public.whatsapp_messages m
        where m.clinic_id = new.clinic_id and m.media_id is not null
          and (m.contact_id = new.id or m.contact_phone = old.phone)
     );
  if old.phone is not null then
    delete from public.conversation_reads r where r.clinic_id = new.clinic_id and r.contact_phone = old.phone;
    update public.conversation_access_log l set contact_phone = app.anonymized_phone(new.id)
     where l.clinic_id = new.clinic_id and l.contact_phone = old.phone;
    update public.handoff_events e set contact_phone = app.anonymized_phone(new.id)
     where e.clinic_id = new.clinic_id and e.contact_phone = old.phone;
  end if;
  return null;
end
$$;
revoke execute on function app.drop_conversation_media_on_anonymize() from public, anon, authenticated, clinic_service;

create trigger contacts_drop_conversation_media
  after update of anonymized_at on public.contacts
  for each row when (old.anonymized_at is null and new.anonymized_at is not null)
  execute function app.drop_conversation_media_on_anonymize();

-- ---------------------------------------------------------------------------
-- 1. Guarda
-- ---------------------------------------------------------------------------
create function public.central_retention(p_clinic_id uuid, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_texts integer;
  v_media integer;
  v_orphans integer;
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

  return jsonb_build_object('texts', v_texts, 'media', v_media + v_orphans);
end
$$;
revoke execute on function public.central_retention(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.central_retention(uuid, timestamptz) to clinic_service;

-- ---------------------------------------------------------------------------
-- 3. Arquivos a remover do bucket
-- ---------------------------------------------------------------------------
create function public.central_media_purge_list(p_clinic_id uuid, p_limit integer default 100)
returns table (path text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app.service_clinic_id() is distinct from p_clinic_id then
    raise exception 'Só a rotina da clínica remove anexos.' using errcode = '42501';
  end if;
  return query
    (select w.storage_path from public.whatsapp_media w
      where w.clinic_id = p_clinic_id and w.status = 'deleted' and w.storage_path is not null
      limit p_limit)
    union all
    (select o.name from storage.objects o
      where o.bucket_id = 'whatsapp-media' and o.name like p_clinic_id::text || '/%/env-%'
        and o.created_at < now() - interval '1 hour'
        and not exists (select 1 from public.whatsapp_media w where w.clinic_id = p_clinic_id and w.storage_path = o.name)
      limit p_limit);
end
$$;
revoke execute on function public.central_media_purge_list(uuid, integer) from public, anon, authenticated;
grant execute on function public.central_media_purge_list(uuid, integer) to clinic_service;

-- Arquivos removidos: o anexo apagado perde o caminho.
create function public.central_media_purged(p_clinic_id uuid, p_paths text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if app.service_clinic_id() is distinct from p_clinic_id then
    raise exception 'Só a rotina da clínica remove anexos.' using errcode = '42501';
  end if;
  update public.whatsapp_media w set storage_path = null
   where w.clinic_id = p_clinic_id and w.status = 'deleted' and w.storage_path = any (coalesce(p_paths, '{}'::text[]));
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke execute on function public.central_media_purged(uuid, text[]) from public, anon, authenticated;
grant execute on function public.central_media_purged(uuid, text[]) to clinic_service;

select cron.schedule('guarda-conversas', '40 3 * * *', $$ select app.call_system_route('/api/cron/guarda-conversas') $$);
