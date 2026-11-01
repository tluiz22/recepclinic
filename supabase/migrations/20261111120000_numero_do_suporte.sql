-- Número de WhatsApp do suporte do RecepClinic (cliente, 01/nov/2026).
--
-- Ajuste único da plataforma (uma linha). O Suporte grava; as clínicas e o bot
-- só leem. A conversa entre o WhatsApp da clínica e este número não passa pelo
-- bot nem entra em Atendimento (webhook.ts e attention.ts). A Central de Ajuda
-- mostra o número para o usuário pedir ajuda.

create table public.platform_settings (
  id boolean primary key default true check (id),
  -- E.164 (+5584981880777); vazio = ainda não informado.
  support_whatsapp text check (support_whatsapp is null or support_whatsapp ~ '^\+[1-9][0-9]{9,14}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

insert into public.platform_settings (id) values (true);

alter table public.platform_settings enable row level security;

create policy platform_settings_read on public.platform_settings for select to authenticated, clinic_service using (true);
create policy platform_settings_staff_update on public.platform_settings for update to authenticated
  using (app.is_platform_staff()) with check (app.is_platform_staff());
revoke insert, delete on public.platform_settings from anon, authenticated, clinic_service;
revoke update on public.platform_settings from anon, clinic_service;
