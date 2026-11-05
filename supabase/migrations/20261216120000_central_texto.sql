-- CN2 — texto das conversas e última mensagem (Central de Atendimento; plano em
-- docs/planejamento-central-atendimento.md, seções 3.4, 4.1, 4.3 e 14). Aditiva.
--
-- 1. Guarda do texto (D12 revista, cliente, 05/nov/2026): o texto do paciente e o das respostas pelo app do WhatsApp
--    só fica guardado com a Central valendo para a clínica (item liberado e ligada pelo Administrador). A regra fica
--    aqui, no banco: quem grava manda o texto sempre; com a Central desligada ele não chega à tabela.
-- 2. Última mensagem na conversa (`conversation_state`): hora, autor, prévia (só com a Central) e a hora da última
--    mensagem do paciente (janela de 24 h). Atualizada por gatilho a cada mensagem e quando a conversa nasce.
--    O `updated_at` da conversa fica como estava: o bot mede o tempo parado por ele.
--
-- Reversão: drop dos gatilhos e das funções abaixo; os textos guardados ficam (apagar à parte, se for o caso).

-- ---------------------------------------------------------------------------
-- 1. Guarda do texto
-- ---------------------------------------------------------------------------
create function app.whatsapp_message_body_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.body is not null
     and (new.direction = 'inbound' or new.message_type in ('agent_reply', 'app_auto_reply'))
     and not app.central_active(new.clinic_id) then
    new.body := null;
  end if;
  return new;
end
$$;
create trigger whatsapp_messages_body_guard before insert or update of body on public.whatsapp_messages
  for each row execute function app.whatsapp_message_body_guard();

-- ---------------------------------------------------------------------------
-- 2. Última mensagem na conversa
-- ---------------------------------------------------------------------------
-- Prévia da lista: até 120 caracteres numa linha; só com a Central valendo (mesma regra do texto).
create function app.message_preview(p_clinic_id uuid, p_body text, p_revoked_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_body is null or p_revoked_at is not null or not app.central_active(p_clinic_id) then null
    else left(regexp_replace(btrim(p_body), '\s+', ' ', 'g'), 120)
  end
$$;

-- Mensagem nova: a conversa que já existe passa a mostrar a mais nova (o histórico importado, com data antiga, só
-- entra se for mais novo). Mensagem do paciente ao vivo conta para a janela de 24 h. Sem conversa, nada: ela nasce
-- pelo bot e se preenche no próprio insert (gatilho da seção 3).
create function app.conversation_last_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversation_state c
     set last_message_at = new.sort_at,
         last_message_author = new.author,
         last_message_preview = app.message_preview(new.clinic_id, new.body, new.revoked_at)
   where c.clinic_id = new.clinic_id
     and c.contact_phone = new.contact_phone
     and (c.last_message_at is null or c.last_message_at <= new.sort_at);
  if new.direction = 'inbound' and new.source = 'live' then
    update public.conversation_state c
       set last_patient_at = new.sort_at
     where c.clinic_id = new.clinic_id
       and c.contact_phone = new.contact_phone
       and (c.last_patient_at is null or c.last_patient_at < new.sort_at);
  end if;
  return null;
end
$$;
create trigger whatsapp_messages_last_message after insert on public.whatsapp_messages
  for each row when (new.contact_phone is not null)
  execute function app.conversation_last_message();

-- Editada ou apagada no app (smb_message_echoes): se é a última da conversa, a prévia acompanha.
create function app.conversation_last_message_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversation_state c
     set last_message_preview = app.message_preview(new.clinic_id, new.body, new.revoked_at)
   where c.clinic_id = new.clinic_id
     and c.contact_phone = new.contact_phone
     and c.last_message_at = new.sort_at
     and c.last_message_author = new.author;
  return null;
end
$$;
create trigger whatsapp_messages_last_message_changed after update of body, revoked_at on public.whatsapp_messages
  for each row when (new.contact_phone is not null
                     and (old.body is distinct from new.body or old.revoked_at is distinct from new.revoked_at))
  execute function app.conversation_last_message_changed();

-- ---------------------------------------------------------------------------
-- 3. Conversa nova: já nasce com a última mensagem (a primeira do paciente é gravada antes de o bot criar a linha)
-- ---------------------------------------------------------------------------
create function app.conversation_state_last_message_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last record;
begin
  select m.sort_at, m.author, m.body, m.revoked_at into v_last
    from public.whatsapp_messages m
   where m.clinic_id = new.clinic_id and m.contact_phone = new.contact_phone
   order by m.sort_at desc, m.id desc
   limit 1;
  if found and new.last_message_at is null then
    new.last_message_at := v_last.sort_at;
    new.last_message_author := v_last.author;
    new.last_message_preview := app.message_preview(new.clinic_id, v_last.body, v_last.revoked_at);
  end if;
  if new.last_patient_at is null then
    new.last_patient_at := (
      select max(m.sort_at) from public.whatsapp_messages m
       where m.clinic_id = new.clinic_id and m.contact_phone = new.contact_phone
         and m.direction = 'inbound' and m.source = 'live'
    );
  end if;
  return new;
end
$$;
create trigger conversation_state_last_message_defaults before insert on public.conversation_state
  for each row execute function app.conversation_state_last_message_defaults();

-- O `updated_at` mede o tempo parado do bot (router.ts, isPastIdleTimeout): a última mensagem não mexe nele.
-- Nome com "z": roda depois do `conversation_state_set_updated_at` (os gatilhos rodam em ordem alfabética).
create function app.conversation_state_keep_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cols text[] := array['updated_at', 'last_message_at', 'last_message_author', 'last_message_preview', 'last_patient_at'];
begin
  if (to_jsonb(new) - v_cols) = (to_jsonb(old) - v_cols) then
    new.updated_at := old.updated_at;
  end if;
  return new;
end
$$;
create trigger conversation_state_z_keep_updated_at before update on public.conversation_state
  for each row execute function app.conversation_state_keep_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Carga: conversas que já existem passam a mostrar a última mensagem
-- ---------------------------------------------------------------------------
with last as (
  select distinct on (m.clinic_id, m.contact_phone) m.clinic_id, m.contact_phone, m.sort_at, m.author, m.body, m.revoked_at
    from public.whatsapp_messages m
   where m.contact_phone is not null
   order by m.clinic_id, m.contact_phone, m.sort_at desc, m.id desc
), patient as (
  select m.clinic_id, m.contact_phone, max(m.sort_at) as at
    from public.whatsapp_messages m
   where m.direction = 'inbound' and m.source = 'live' and m.contact_phone is not null
   group by 1, 2
)
update public.conversation_state c
   set last_message_at = l.sort_at,
       last_message_author = l.author,
       last_message_preview = app.message_preview(c.clinic_id, l.body, l.revoked_at),
       last_patient_at = p.at
  from last l
  left join patient p on p.clinic_id = l.clinic_id and p.contact_phone = l.contact_phone
 where c.clinic_id = l.clinic_id
   and c.contact_phone = l.contact_phone
   and c.last_message_at is null;
