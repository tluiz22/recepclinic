-- F3a da recepção digital (09/nov/2026): o link que o bot manda na conversa abre o portal com o celular da conversa
-- já comprovado (proposta 3.4; especificação P7 "pulada com link do bot"; plano, seção 15).
--   1. portal_links: o token do link (o id, em 22 caracteres no endereço /s/{token}), a finalidade, o escopo
--      (profissional, exame), 30 minutos, uma marcação por link, revogado quando outro é emitido;
--   2. portal_sessions.link_id: a sessão aberta pelo link (a marcação sai com a origem "WhatsApp" e gasta o link);
--   3. a plataforma acha a clínica pelo token (como resolve_booking_link_clinic).

-- ---------------------------------------------------------------------------
-- 1. Links do portal
create table public.portal_links (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  contact_id uuid,
  -- O celular da conversa: a sessão aberta pelo link fica com ele comprovado.
  phone text not null check (phone ~ '^\+\d{10,15}$'),
  -- book: consulta; return: retorno; exam: exame; reschedule: remarcar (F3c); my_appointments: Minhas consultas (F3c).
  purpose text not null check (purpose in ('book', 'return', 'exam', 'reschedule', 'my_appointments')),
  -- Escopo: o profissional escolhido na conversa (abre o início dele) ou o exame.
  professional_id uuid,
  service_id uuid,
  -- Remarcar (F3c) e a remarcação depois do cancelamento pela clínica (F3-3).
  appointment_id uuid,
  canceled_appointment_id uuid,
  origin_appointment_id uuid,
  return_deadline_waived boolean not null default false,
  -- "Encaixe ou antecipar" sem nada marcado (F3-2): ao marcar, entra na lista de espera.
  join_waitlist boolean not null default false,
  -- Funil do bot (pedido não concluído): a marcação pelo link fecha o funil.
  funnel_session_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  foreign key (clinic_id, contact_id) references public.contacts (clinic_id, id) on delete cascade,
  foreign key (clinic_id, professional_id) references public.professionals (clinic_id, id) on delete cascade,
  foreign key (clinic_id, service_id) references public.services (clinic_id, id) on delete cascade,
  foreign key (clinic_id, appointment_id) references public.appointments (clinic_id, id) on delete cascade,
  foreign key (clinic_id, canceled_appointment_id) references public.appointments (clinic_id, id) on delete cascade,
  foreign key (clinic_id, origin_appointment_id) references public.appointments (clinic_id, id) on delete cascade,
  -- Pedido não concluído (PN2): link vencido sem uso recebe a mensagem uma vez.
  not_completed_prompted_at timestamptz,
  check (purpose <> 'reschedule' or appointment_id is not null)
);

-- Revogar o anterior do mesmo celular e finalidade; pedido não concluído; limpeza diária.
create index portal_links_phone_idx on public.portal_links (clinic_id, phone, purpose) where used_at is null and revoked_at is null;
create index portal_links_expires_idx on public.portal_links (expires_at);
create index portal_links_not_completed_idx on public.portal_links (clinic_id, expires_at) where used_at is null and not_completed_prompted_at is null;

select app.enable_clinic_data_rls('public.portal_links');
-- Ninguém apaga pela API (a limpeza diária roda pela plataforma).
revoke delete on public.portal_links from authenticated, clinic_service;

create trigger portal_links_guard_suspended before insert or update or delete on public.portal_links
  for each row execute function app.guard_suspended_clinic_write();

-- ---------------------------------------------------------------------------
-- 2. Sessão aberta pelo link
alter table public.portal_sessions
  add column link_id uuid references public.portal_links (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 3. Clínica pelo token: só a plataforma (service role); o resto da página usa a credencial limitada à clínica.
create function public.resolve_portal_link_clinic(p_link_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select clinic_id from public.portal_links where id = p_link_id
$$;

revoke execute on function public.resolve_portal_link_clinic(uuid) from public, anon, authenticated, clinic_service;
grant execute on function public.resolve_portal_link_clinic(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Limpeza diária: links com mais de 30 dias saem junto (como as sessões).
select cron.schedule('limpar-portal', '25 3 * * *', $$
  delete from public.portal_rate_hits where at < now() - interval '2 days';
  delete from public.portal_blocks where blocked_until < now() - interval '30 days';
  delete from public.portal_sessions where created_at < now() - interval '30 days';
  delete from public.portal_links where created_at < now() - interval '30 days';
$$);
