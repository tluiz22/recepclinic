-- Fase 17 · etapa 6: quem marcou, remarcou e cancelou cada atendimento.

-- Perfis dos 2 logins fixos do admin (antecipa a etapa 1 da Fase 14 — por
-- enquanto só identifica, não restringe telas). O vínculo login ↔ perfil é
-- feito à mão, uma vez, depois de aplicar esta migração (ver seed no fim).
create table staff_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('secretaria', 'medica')),
  created_at timestamptz not null default now()
);

alter table staff_profiles enable row level security;

create policy "authenticated read" on staff_profiles
  for select to authenticated
  using (auth.uid() is not null);

-- Autoria. O canal (tela x WhatsApp) já existe para marcar
-- (`booking_channel`) e cancelar (`canceled_via`); falta o canal da
-- remarcação e, nos 3 casos, qual login fez pela tela. Login nulo com canal
-- 'admin' = registro anterior a esta etapa ("Tela (usuário não registrado)").
alter table appointments
  add column created_by uuid references auth.users (id) on delete set null,
  add column rescheduled_via text check (rescheduled_via in ('admin', 'whatsapp_bot')),
  add column rescheduled_by uuid references auth.users (id) on delete set null,
  add column rescheduled_at timestamptz,
  add column canceled_by uuid references auth.users (id) on delete set null;

-- Seed (rodar à mão, trocando os e-mails pelos logins reais):
--
--   select id, email from auth.users;
--
--   insert into staff_profiles (user_id, full_name, role)
--   select id, 'Dra. Ana Karina', 'medica' from auth.users where email = '<e-mail da médica>'
--   union all
--   select id, '<nome da secretária>', 'secretaria' from auth.users where email = '<e-mail da secretária>';
