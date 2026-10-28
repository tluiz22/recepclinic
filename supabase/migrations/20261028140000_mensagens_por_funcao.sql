-- CRM B0, passo 1 (aprovado pelo cliente em 28/out/2026): o texto das mensagens
-- do WhatsApp passa a ser lido por funções que conferem o papel na entrada.
-- Hoje qualquer membro da clínica (inclusive o Profissional) lê
-- whatsapp_messages.body pela API do Supabase com o próprio login; esconder a
-- tela não basta (seção 13.1 do plano de Relacionamento).
--
-- Este passo só acrescenta: as duas funções e o código das telas usando-as.
-- O passo 2 (tirar body e retry_payload da leitura direta do login) vem
-- depois, com SQL próprio, quando este estiver publicado no mesmo ambiente.
-- O RLS das linhas, o bot e as rotinas (clinic_service) e as Métricas não mudam.
--
-- Reversão: drop function das duas.

-- Tela Atendimento e Início: última mensagem do paciente e respostas da
-- recepção, só das conversas pausadas. Qualquer membro da clínica (Q5) e o bot;
-- quem não é da clínica recebe a lista vazia.
create function public.attention_last_messages(p_clinic_id uuid, p_phones text[], p_since timestamptz)
returns table (contact_phone text, direction text, message_type text, body text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.contact_phone, m.direction, m.message_type, m.body, m.created_at
    from public.whatsapp_messages m
   where app.is_clinic_member(p_clinic_id)
     and m.clinic_id = p_clinic_id
     and m.contact_phone = any (p_phones)
     and m.created_at >= p_since
     and (m.direction = 'inbound' or m.message_type = 'agent_reply')
     and exists (
       select 1 from public.conversation_state c
        where c.clinic_id = p_clinic_id
          and c.contact_phone = m.contact_phone
          and c.human_handoff
     )
   order by m.created_at desc
   limit 2000
$$;

-- Histórico das mensagens: só Administrador, Recepção e Suporte; os outros
-- recebem erro de acesso. Com contato: as dele, mais as que ficaram sem contato
-- ligado mas vieram do telefone dele. Sem contato: as últimas da clínica
-- (Configurações › WhatsApp, Suporte). No máximo 50 por vez; p_before é o
-- "Carregar mais".
create function public.contact_message_history(
  p_clinic_id uuid,
  p_contact_id uuid,
  p_before timestamptz default null,
  p_limit int default 50
) returns table (
  id uuid,
  direction text,
  message_type text,
  template_name text,
  body text,
  status text,
  contact_phone text,
  contact_id uuid,
  appointment_id uuid,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phone text;
begin
  if not app.has_clinic_role(p_clinic_id, array['admin', 'reception']::public.clinic_role[]) then
    raise exception 'Sem acesso ao histórico de mensagens' using errcode = '42501';
  end if;
  if p_contact_id is not null then
    select c.phone into v_phone
      from public.contacts c
     where c.clinic_id = p_clinic_id and c.id = p_contact_id;
  end if;
  return query
    select m.id, m.direction, m.message_type, m.template_name, m.body, m.status,
           m.contact_phone, m.contact_id, m.appointment_id, m.created_at
      from public.whatsapp_messages m
     where m.clinic_id = p_clinic_id
       and (p_contact_id is null
            or m.contact_id = p_contact_id
            or (m.contact_id is null and m.contact_phone = v_phone))
       and (p_before is null or m.created_at < p_before)
     order by m.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 50);
end
$$;

revoke execute on function public.attention_last_messages(uuid, text[], timestamptz) from public, anon;
grant execute on function public.attention_last_messages(uuid, text[], timestamptz) to authenticated, clinic_service;
revoke execute on function public.contact_message_history(uuid, uuid, timestamptz, int) from public, anon;
grant execute on function public.contact_message_history(uuid, uuid, timestamptz, int) to authenticated;
