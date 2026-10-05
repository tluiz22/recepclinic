-- F4.4a — Nova clínica pelo Suporte, convites e pedido de informações (L47,
-- cliente, 05/out/2026).

-- ---------------------------------------------------------------------------
-- Convites: quem foi chamado para cada clínica, com quais papéis
-- ---------------------------------------------------------------------------
-- O e-mail fica aqui porque a equipe não lê auth.users. Aceito = a pessoa
-- criou a senha (ou já tinha login quando foi incluída).
create table public.clinic_invitations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  email text not null check (email = lower(trim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  user_id uuid references auth.users (id) on delete cascade,
  roles public.clinic_role[] not null check (cardinality(roles) > 0),
  invited_by uuid references auth.users (id) on delete set null,
  invited_at timestamptz not null default now(),
  last_sent_at timestamptz,
  accepted_at timestamptz,
  unique (clinic_id, email)
);

alter table public.clinic_invitations enable row level security;

-- O Suporte e o Administrador da clínica (equipe, F4.4b) veem e gravam.
create policy clinic_invitations_admin on public.clinic_invitations
  for all to authenticated
  using (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]))
  with check (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]));

create trigger clinic_invitations_audit_platform_staff
  after insert or update or delete on public.clinic_invitations
  for each row execute function app.audit_platform_staff_write();

revoke all on public.clinic_invitations from anon, clinic_service;

-- Quem criou a senha marca os próprios convites como aceitos.
create function public.mark_my_invitations_accepted()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.clinic_invitations set accepted_at = now()
  where user_id = (select auth.uid()) and accepted_at is null
$$;

revoke execute on function public.mark_my_invitations_accepted() from public, anon, clinic_service;
grant execute on function public.mark_my_invitations_accepted() to authenticated;

-- Plataforma: login de um e-mail (para incluir quem já tem acesso sem novo convite).
create function public.find_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1
$$;

revoke execute on function public.find_user_id_by_email(text) from public, anon, authenticated, clinic_service;
grant execute on function public.find_user_id_by_email(text) to service_role;

-- ---------------------------------------------------------------------------
-- Pedido de informações (formulário por link)
-- ---------------------------------------------------------------------------
-- O link leva um código aleatório; aqui fica só o hash dele. O Suporte cria,
-- lê e revisa; a página pública (credencial da clínica) só salva as
-- respostas enquanto o pedido está aberto e no prazo.
create table public.onboarding_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  email text not null,
  status text not null default 'sent' check (status in ('sent', 'draft', 'submitted', 'reviewed')),
  answers jsonb not null default '{}'::jsonb,
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  saved_at timestamptz,
  submitted_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz
);

create index onboarding_requests_clinic_idx on public.onboarding_requests (clinic_id, requested_at desc);

alter table public.onboarding_requests enable row level security;

create policy onboarding_requests_staff on public.onboarding_requests
  for all to authenticated
  using (app.is_platform_staff())
  with check (app.is_platform_staff());

create policy onboarding_requests_select_service on public.onboarding_requests
  for select to clinic_service
  using (clinic_id = app.service_clinic_id());

create policy onboarding_requests_update_service on public.onboarding_requests
  for update to clinic_service
  using (clinic_id = app.service_clinic_id())
  with check (clinic_id = app.service_clinic_id());

revoke all on public.onboarding_requests from anon;
revoke insert, delete on public.onboarding_requests from clinic_service;

create trigger onboarding_requests_audit_platform_staff
  after insert or update or delete on public.onboarding_requests
  for each row execute function app.audit_platform_staff_write();

-- A página pública só muda as respostas e a situação (rascunho ou enviado),
-- e só enquanto o pedido está aberto e no prazo.
create function app.guard_onboarding_answer()
returns trigger
language plpgsql
-- Dono do banco: a credencial da clínica não lê o esquema auth (auth.role()).
security definer
set search_path = ''
as $$
begin
  if app.is_platform_staff() or (select auth.role()) = 'service_role' then
    return new;
  end if;
  if old.status not in ('sent', 'draft') or old.expires_at <= now() then
    raise exception 'Este formulário já foi enviado ou venceu.' using errcode = 'P0001', hint = 'onboarding_closed';
  end if;
  if new.status not in ('draft', 'submitted')
     or new.clinic_id <> old.clinic_id or new.token_hash <> old.token_hash or new.email <> old.email
     or new.expires_at <> old.expires_at or new.requested_at <> old.requested_at
     or new.requested_by is distinct from old.requested_by
     or new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at then
    raise exception 'Alteração não permitida no formulário.' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger onboarding_requests_guard before update on public.onboarding_requests
  for each row execute function app.guard_onboarding_answer();

-- Página pública: de qual clínica é o pedido deste link (como o link de
-- agendamento, F3.3). Só a plataforma chama.
create function public.resolve_onboarding_request_clinic(p_token_hash text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select clinic_id from public.onboarding_requests where token_hash = p_token_hash
$$;

revoke execute on function public.resolve_onboarding_request_clinic(text) from public, anon, authenticated, clinic_service;
grant execute on function public.resolve_onboarding_request_clinic(text) to service_role;
