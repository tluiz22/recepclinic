-- F3.2 — Leituras do Suporte (D6, revisão de 04/out/2026).
--
-- As alterações do Suporte já ficam em platform_audit_log (gatilhos, F2.1).
-- Aqui ficam as leituras: cada tela ou consulta que o Suporte abre numa
-- clínica, gravada pela aplicação (middleware) antes de responder.
--
-- Como platform_audit_log, não aponta para a clínica: o registro sobrevive à
-- exclusão dela. Ninguém grava direto pela API; só a função abaixo, que usa o
-- login da requisição como autor e recusa quem não é do Suporte.

create table public.platform_access_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid not null,
  clinic_id uuid not null,
  method text not null check (method ~ '^[A-Z]{3,7}$'),
  path text not null check (length(path) between 1 and 2048)
);

create index platform_access_log_clinic_idx on public.platform_access_log (clinic_id, occurred_at desc);

alter table public.platform_access_log enable row level security;

-- O Suporte vê tudo; o Administrador vê as leituras feitas na sua clínica.
create policy platform_access_log_select on public.platform_access_log
  for select to authenticated
  using (
    app.is_platform_staff()
    or app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[])
  );

create function public.log_platform_access(p_clinic_id uuid, p_method text, p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_platform_staff() then
    raise exception 'Só o Suporte RecepClinic registra leituras' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clinics where id = p_clinic_id) then
    raise exception 'Clínica inexistente' using errcode = '23503';
  end if;
  insert into public.platform_access_log (actor_user_id, clinic_id, method, path)
  values ((select auth.uid()), p_clinic_id, p_method, p_path);
end
$$;

revoke execute on function public.log_platform_access(uuid, text, text) from public, anon;
grant execute on function public.log_platform_access(uuid, text, text) to authenticated;
