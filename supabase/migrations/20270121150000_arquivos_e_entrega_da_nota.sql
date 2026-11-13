-- N4 — Arquivos e entrega da nota emitida pelo Asaas (planejamento-nfse-asaas.md,
-- seções 5, 13.6 e 13.8).
--
--   1. o PDF e o XML do Asaas (links abertos sem login) são copiados para os
--      buckets privados da clínica; a tela nunca mostra o link do Asaas;
--   2. a entrega automática (Produção) sai só pelo WhatsApp do contato e dos
--      números com "enviar sempre": o e-mail da nota é o do Asaas ao tomador
--      (decisão de 30/out), sem e-mail próprio;
--   3. saída de entregas: a passagem para "emitida" (pela tela, pelo webhook
--      ou pela conciliação) marca a entrega pendente; a rotina envia, uma vez
--      por destino (índice único), com novas tentativas na falha técnica.
--
-- Reversão: drop das colunas auto_delivery_*, do índice, do bucket nfse-pdf e
-- das políticas.

alter table public.nfse_invoices
  add column auto_delivery_status text check (auto_delivery_status is null or auto_delivery_status in ('pending', 'sending', 'done', 'failed', 'skipped')),
  add column auto_delivery_attempts smallint not null default 0 check (auto_delivery_attempts between 0 and 10),
  add column auto_delivery_at timestamptz;

create index nfse_invoices_auto_delivery_idx on public.nfse_invoices (auto_delivery_status, auto_delivery_at)
  where auto_delivery_status in ('pending', 'sending', 'failed');
create index nfse_invoices_missing_files_idx on public.nfse_invoices (issued_at)
  where provider = 'asaas' and status in ('issued', 'canceling', 'canceled') and pdf_path is null;

-- Um envio automático por nota, canal e destino (regra 3).
create unique index nfse_deliveries_auto_once on public.nfse_deliveries (invoice_id, channel, destination) where automatic and destination <> 'anonimizado';

-- PDF das notas (regra 1): bucket privado, "<clinic_id>/<nota>.pdf".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nfse-pdf', 'nfse-pdf', false, 5242880, array['application/pdf']);

create policy nfse_pdf_select on storage.objects
  for select to authenticated
  using (bucket_id = 'nfse-pdf' and app.can_read_finance(app.nfse_xml_folder_clinic(name)));

-- O servidor (service role) guarda os arquivos e marca a entrega.
create function public.platform_set_invoice_files(p_invoice_id uuid, p_pdf_path text, p_xml_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.nfse_invoices%rowtype;
begin
  select * into v_invoice from public.nfse_invoices where id = p_invoice_id for update;
  if v_invoice.id is null then
    return;
  end if;
  update public.nfse_invoices
     set pdf_path = coalesce(p_pdf_path, pdf_path), xml_path = coalesce(p_xml_path, xml_path),
         -- Entrega automática só em Produção e só uma vez (regra 2).
         auto_delivery_status = case
           when auto_delivery_status is not null then auto_delivery_status
           when v_invoice.status <> 'issued' then 'skipped'
           when v_invoice.environment = 'production' then 'pending'
           else 'skipped' end,
         auto_delivery_at = coalesce(auto_delivery_at, now())
   where id = p_invoice_id;
end
$$;

-- Pega as entregas a fazer (pendentes, ou com falha há 10 minutos, até 3
-- tentativas) e marca "enviando", para duas rotinas não pegarem a mesma.
create function public.platform_claim_auto_deliveries(p_limit integer)
returns table (invoice_id uuid, clinic_id uuid)
language sql
security definer
set search_path = ''
as $$
  update public.nfse_invoices i
     set auto_delivery_status = 'sending', auto_delivery_attempts = auto_delivery_attempts + 1, auto_delivery_at = now()
   where i.id in (
     select id from public.nfse_invoices
      where status = 'issued' and pdf_path is not null
        and (auto_delivery_status = 'pending'
             or (auto_delivery_status = 'failed' and auto_delivery_attempts < 3 and auto_delivery_at < now() - interval '10 minutes')
             or (auto_delivery_status = 'sending' and auto_delivery_at < now() - interval '15 minutes'))
      order by auto_delivery_at
      limit p_limit
      for update skip locked
   )
  returning i.id, i.clinic_id
$$;

create function public.platform_finish_auto_delivery(p_invoice_id uuid, p_ok boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.nfse_invoices set auto_delivery_status = case when p_ok then 'done' else 'failed' end, auto_delivery_at = now()
   where id = p_invoice_id and auto_delivery_status = 'sending'
$$;

revoke execute on function public.platform_set_invoice_files(uuid, text, text) from public, anon, authenticated, clinic_service;
revoke execute on function public.platform_claim_auto_deliveries(integer) from public, anon, authenticated, clinic_service;
revoke execute on function public.platform_finish_auto_delivery(uuid, boolean) from public, anon, authenticated, clinic_service;
grant execute on function public.platform_set_invoice_files(uuid, text, text) to service_role;
grant execute on function public.platform_claim_auto_deliveries(integer) to service_role;
grant execute on function public.platform_finish_auto_delivery(uuid, boolean) to service_role;
