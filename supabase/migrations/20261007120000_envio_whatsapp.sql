-- F6.2 — Envio pelo WhatsApp da clínica e templates padrão.

-- Nome da clínica nas mensagens (cliente, 07/out/2026): "Aqui é da Clínica
-- Sorriso" ou "Aqui é do Consultório X". O texto fixo dos templates é o mesmo
-- para todas as clínicas; o artigo vai junto do nome, na variável.
alter table public.clinic_settings
  add column message_article text not null default 'da' check (message_article in ('da', 'do'));

-- Motivo da recusa do template pela Meta (mostrado ao Suporte).
alter table public.whatsapp_templates
  add column rejection_reason text;

-- Webhook: mudança de situação dos templates chega pela conta (WABA), não pelo
-- número. Clínicas conectadas daquela conta; só a plataforma (service role)
-- chama, e o resto segue com a credencial de cada clínica (D1).
create function public.resolve_whatsapp_clinics_by_waba(p_waba_id text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select clinic_id from public.whatsapp_connections
  where waba_id = p_waba_id and status <> 'disconnected'
$$;

revoke execute on function public.resolve_whatsapp_clinics_by_waba(text) from public, anon, authenticated, clinic_service;
grant execute on function public.resolve_whatsapp_clinics_by_waba(text) to service_role;
