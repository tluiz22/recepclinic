-- F8.2b — Clínica em implantação (cliente, 25/out/2026).
--
-- Situação nova da clínica: tudo se configura (equipe, agendas, importação da
-- agenda atual, WhatsApp conectado e templates aprovados), mas nada sai para
-- os pacientes pelo WhatsApp (bot, avisos e envios automáticos) até o Suporte
-- ativar. Toda clínica nova nasce assim (a tela "Nova clínica" grava a
-- situação); as que já existem continuam ativas. O bloqueio dos envios fica no
-- código (quem envia pela clínica); os envios automáticos já só rodam nas
-- clínicas ativas (`20261007170000`).
--
-- Só o Suporte muda a situação: o Administrador pode alterar a linha da
-- clínica (nome), mas não a situação.

alter type public.clinic_status add value if not exists 'onboarding';

create function app.guard_clinic_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Sem usuário (service role, migrações): livre.
  if new.status is distinct from old.status and (select auth.uid()) is not null and not app.is_platform_staff() then
    raise exception 'Só o Suporte do RecepClinic muda a situação da clínica.' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger clinics_guard_status
  before update of status on public.clinics
  for each row execute function app.guard_clinic_status();

-- Rotinas da agenda (séries sem fim) também na clínica em implantação: não
-- falam com os pacientes. As de envio seguem só nas ativas (list_active_clinics).
create function public.list_clinics_in_service()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.clinics where status <> 'suspended'
$$;

revoke execute on function public.list_clinics_in_service() from public, anon, authenticated, clinic_service;
grant execute on function public.list_clinics_in_service() to service_role;
