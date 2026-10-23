-- Reenvio automático de envios com falha técnica (cliente, 23/out/2026).
--
-- Envios automáticos (lembrete, avisos, preparo, orientações, resumos, oferta
-- de vaga e nota fiscal automática) que falham por motivo técnico da Meta ou
-- da rede ganham mais duas tentativas, 10 e 30 minutos depois da primeira
-- falha. Cada tentativa é uma mensagem nova, ligada à primeira. O pedido à
-- Meta fica guardado até a mensagem chegar ao celular, para a falha avisada
-- depois pelo webhook também ser reenviada. Bot e telas do painel ficam de fora.

alter table public.whatsapp_messages
  add column attempt smallint not null default 1 check (attempt between 1 and 3),
  add column first_attempt_id uuid references public.whatsapp_messages (id) on delete set null,
  -- Motivo da falha (código da Meta, quando houver) e o texto, sem dados pessoais.
  add column failure_code integer,
  add column failure_reason text check (length(failure_reason) <= 300),
  -- Pedido à Meta e o que conferir antes de reenviar ({ request, context }).
  add column retry_payload jsonb,
  -- Próxima tentativa (null = nenhuma prevista).
  add column retry_at timestamptz;

create index whatsapp_messages_retry_idx
  on public.whatsapp_messages (clinic_id, retry_at)
  where retry_at is not null;

create index whatsapp_messages_first_attempt_idx
  on public.whatsapp_messages (first_attempt_id)
  where first_attempt_id is not null;

-- Guardado só enquanto pode ser preciso: o pedido some quando a mensagem
-- chega ao celular (no código) e, por garantia, depois de 2 dias.
select cron.schedule(
  'limpar-pedidos-de-reenvio',
  '20 3 * * *',
  $$ update public.whatsapp_messages set retry_payload = null
      where retry_payload is not null and retry_at is null and created_at < now() - interval '2 days' $$
);

-- Tentativas previstas: de minuto em minuto.
select cron.schedule('reenvios', '* * * * *', $$ select app.call_system_route('/api/cron/reenvios') $$);

-- ---------------------------------------------------------------------------
-- Nota fiscal pelo WhatsApp (envio automático ao emitir)
-- ---------------------------------------------------------------------------
-- A rotina dos reenvios usa a credencial da clínica (clinic_service), que não
-- lê o Financeiro (F11). Estas duas funções dão só o necessário: se a nota
-- segue emitida e a situação do envio na lista de envios da nota.
create function public.nfse_invoice_issued_for_retry(p_invoice_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.nfse_invoices i
     where i.clinic_id = app.service_clinic_id() and i.id = p_invoice_id and i.status = 'issued'
  )
$$;

create function public.nfse_delivery_follow_retry(p_previous_message_id uuid, p_message_id uuid, p_sent boolean, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.nfse_deliveries d
     set whatsapp_message_id = p_message_id,
         status = case when p_sent then 'sent' else 'failed' end,
         error = case when p_sent then null else left(p_error, 300) end
   where d.clinic_id = app.service_clinic_id() and d.whatsapp_message_id = p_previous_message_id
$$;

revoke execute on function public.nfse_invoice_issued_for_retry(uuid) from public, anon, authenticated;
revoke execute on function public.nfse_delivery_follow_retry(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.nfse_invoice_issued_for_retry(uuid) to clinic_service;
grant execute on function public.nfse_delivery_follow_retry(uuid, uuid, boolean, text) to clinic_service;
