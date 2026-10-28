-- CRM B0, migração 1 (aprovada pelo cliente em 28/out/2026). Decisão do
-- cliente: as conversas ficam no app do WhatsApp; o RecepClinic não guarda o
-- texto das mensagens recebidas nem das respostas da recepção pelo app (D12).
-- O texto do que o sistema envia continua guardado para o reenvio, mas só o
-- Suporte lê, por esta função (Configurações › WhatsApp).
--
-- Só acrescenta. A migração 2 (20261028150000) apaga o texto já guardado e
-- tira body e retry_payload da leitura do login, depois do código novo
-- publicado no mesmo ambiente.
--
-- Reversão: drop function.

create function public.support_latest_messages(p_clinic_id uuid, p_limit int default 10)
returns table (
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
begin
  if not app.is_platform_staff() then
    raise exception 'Sem acesso às mensagens' using errcode = '42501';
  end if;
  return query
    select m.id, m.direction, m.message_type, m.template_name, m.body, m.status,
           m.contact_phone, m.contact_id, m.appointment_id, m.created_at
      from public.whatsapp_messages m
     where m.clinic_id = p_clinic_id
     order by m.created_at desc
     limit least(greatest(coalesce(p_limit, 10), 1), 50);
end
$$;

revoke execute on function public.support_latest_messages(uuid, int) from public, anon;
grant execute on function public.support_latest_messages(uuid, int) to authenticated;
