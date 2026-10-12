-- F11.5 — Módulo financeiro: PDF da nota (DANFSe) e envio pelo WhatsApp e
-- por e-mail.
--
-- Regras do cliente (12/out/2026):
--   1. ao emitir (em Produção), o PDF vai sozinho para o WhatsApp do contato;
--      "Enviar nota" manda para o contato, outro número de WhatsApp e/ou um
--      e-mail;
--   2. o outro número e o e-mail ficam no Financeiro do paciente (só
--      Administrador e Recepção; o bot não), com "enviar sempre" opcional; a
--      anonimização apaga;
--   3. cada envio fica registrado (canal, destino, resultado, quem pediu);
--   4. template novo rc_nota_fiscal_v1 (com o PDF no topo).

alter table public.patient_finance
  add column invoice_phone text check (invoice_phone is null or invoice_phone ~ '^\+[1-9][0-9]{9,14}$'),
  add column invoice_email text check (invoice_email is null or (invoice_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(invoice_email) <= 200)),
  add column invoice_auto_send boolean not null default false;

alter table public.whatsapp_templates drop constraint whatsapp_templates_template_key_check;
alter table public.whatsapp_templates add constraint whatsapp_templates_template_key_check check (template_key in (
  'confirmation',
  'confirmation_return',
  'reschedule',
  'cancellation',
  'clinic_cancellation',
  'reminder',
  'exam_preparation',
  'consultation_guidance',
  'waitlist_offer',
  'daily_summary_consultations',
  'daily_summary_exams',
  'daily_summary_consultations_today',
  'daily_summary_exams_today',
  'nfse_document'
));

-- ---------------------------------------------------------------------------
-- Envios da nota (regra 3)
-- ---------------------------------------------------------------------------
create table public.nfse_deliveries (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  invoice_id uuid not null,
  channel text not null check (channel in ('whatsapp', 'email')),
  -- Telefone (+55…) ou e-mail; "anonimizado" depois da anonimização.
  destination text not null,
  -- contact: o WhatsApp do contato; other: outro número ou e-mail.
  target text not null check (target in ('contact', 'other')),
  status text not null check (status in ('sent', 'failed')),
  error text,
  -- Mensagem registrada em whatsapp_messages (a entrega chega pelo webhook).
  whatsapp_message_id uuid,
  automatic boolean not null default false,
  sent_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (clinic_id, invoice_id) references public.nfse_invoices (clinic_id, id) on delete cascade
);

create index nfse_deliveries_invoice_idx on public.nfse_deliveries (invoice_id, created_at desc);

create function app.nfse_delivery_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_feature(new.clinic_id, 'finance');
  new.sent_by := (select auth.uid());
  new.created_at := now();
  return new;
end
$$;

create trigger nfse_deliveries_rules before insert on public.nfse_deliveries
  for each row execute function app.nfse_delivery_rules();
create trigger nfse_deliveries_audit_platform_staff
  after insert or update or delete on public.nfse_deliveries
  for each row execute function app.audit_platform_staff_write();

alter table public.nfse_deliveries enable row level security;

create policy nfse_deliveries_select on public.nfse_deliveries
  for select to authenticated using (app.can_read_finance(clinic_id));
create policy nfse_deliveries_insert on public.nfse_deliveries
  for insert to authenticated with check (app.can_edit_finance(clinic_id));

revoke update, delete on public.nfse_deliveries from authenticated;
revoke all on public.nfse_deliveries from anon, clinic_service;
revoke execute on function app.nfse_delivery_rules() from public, anon, authenticated, clinic_service;

-- ---------------------------------------------------------------------------
-- Anonimização (regra 2): o Financeiro do paciente já é apagado (F11.1); os
-- destinos dos envios das notas dele também saem. As notas ficam (prazo fiscal).
-- ---------------------------------------------------------------------------
create or replace function app.drop_finance_on_anonymize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'patients' then
    delete from public.patient_finance where patient_id = new.id;
    update public.nfse_deliveries d
       set destination = 'anonimizado'
      from public.nfse_invoices i
      join public.payments p on p.id = i.payment_id
     where d.invoice_id = i.id and p.patient_id = new.id;
  else
    delete from public.contact_finance where contact_id = new.id;
  end if;
  return null;
end
$$;
