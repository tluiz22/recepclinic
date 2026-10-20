-- F10.1a (cliente, 19 e 20/out/2026): agenda atual da clínica para a
-- importação na implantação. O Suporte pede pela tela da clínica; a clínica
-- preenche por um link sem login (vale 15 dias), paciente por paciente, com
-- as consultas dentro de cada um, e envia ao Suporte, que confere e autoriza
-- a carga (F10.1b e F10.1c). Como o pedido de informações: o link leva um
-- código aleatório e aqui fica só o hash dele. Um pedido em aberto por
-- clínica; "Mandar link novo" troca o código e o prazo e mantém o rascunho.

create table public.agenda_import_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  email text not null,
  -- sent: ninguém salvou; draft: em preenchimento; submitted: enviada ao
  -- Suporte; returned: devolvida com comentário (F10.1b); loaded: carga
  -- feita (F10.1c); undone: carga desfeita (F10.1d).
  status text not null default 'sent' check (status in ('sent', 'draft', 'submitted', 'returned', 'loaded', 'undone')),
  -- Pacientes e consultas digitados no link (src/lib/agendaImport.ts).
  entries jsonb not null default '[]'::jsonb check (jsonb_typeof(entries) = 'array'),
  return_comment text,
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  link_sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  saved_at timestamptz,
  submitted_at timestamptz,
  returned_by uuid references auth.users (id) on delete set null,
  returned_at timestamptz,
  loaded_by uuid references auth.users (id) on delete set null,
  loaded_at timestamptz
);

create index agenda_import_requests_clinic_idx on public.agenda_import_requests (clinic_id, requested_at desc);
-- Um pedido em andamento por clínica.
create unique index agenda_import_requests_one_open_idx on public.agenda_import_requests (clinic_id)
  where status in ('sent', 'draft', 'submitted', 'returned');

alter table public.agenda_import_requests enable row level security;

create policy agenda_import_requests_staff on public.agenda_import_requests
  for all to authenticated
  using (app.is_platform_staff())
  with check (app.is_platform_staff());

create policy agenda_import_requests_select_service on public.agenda_import_requests
  for select to clinic_service
  using (clinic_id = app.service_clinic_id());

create policy agenda_import_requests_update_service on public.agenda_import_requests
  for update to clinic_service
  using (clinic_id = app.service_clinic_id())
  with check (clinic_id = app.service_clinic_id());

revoke all on public.agenda_import_requests from anon;
revoke insert, delete on public.agenda_import_requests from clinic_service;

create trigger agenda_import_requests_audit_platform_staff
  after insert or update or delete on public.agenda_import_requests
  for each row execute function app.audit_platform_staff_write();

-- A página do link só muda o rascunho e a situação (rascunho ou enviada), e
-- só enquanto o pedido está aberto e no prazo.
create function app.guard_agenda_import_answer()
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
  if old.status not in ('sent', 'draft', 'returned') or old.expires_at <= now() then
    raise exception 'Este link já foi enviado ou venceu.' using errcode = 'P0001', hint = 'agenda_import_closed';
  end if;
  if new.status not in ('draft', 'submitted')
     or new.clinic_id <> old.clinic_id or new.token_hash <> old.token_hash or new.email <> old.email
     or new.expires_at <> old.expires_at or new.requested_at <> old.requested_at or new.link_sent_at <> old.link_sent_at
     or new.requested_by is distinct from old.requested_by
     or new.return_comment is distinct from old.return_comment
     or new.returned_by is distinct from old.returned_by or new.returned_at is distinct from old.returned_at
     or new.loaded_by is distinct from old.loaded_by or new.loaded_at is distinct from old.loaded_at then
    raise exception 'Alteração não permitida no link.' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger agenda_import_requests_guard before update on public.agenda_import_requests
  for each row execute function app.guard_agenda_import_answer();

-- Página do link: de qual clínica é o pedido. Só a plataforma chama.
create function public.resolve_agenda_import_clinic(p_token_hash text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select clinic_id from public.agenda_import_requests where token_hash = p_token_hash
$$;

revoke execute on function public.resolve_agenda_import_clinic(text) from public, anon, authenticated, clinic_service;
grant execute on function public.resolve_agenda_import_clinic(text) to service_role;
