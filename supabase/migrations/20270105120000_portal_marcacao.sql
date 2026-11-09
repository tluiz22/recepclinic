-- F2c da recepção digital (08/nov/2026): marcar a consulta pelo portal (P8, P8b, P9, P10).
--   1. Paciente cadastrado pelo portal (`created_via = 'portal'`): conta no limite de pacientes novos, como o bot.
--   2. A reserva guarda quem será atendido (paciente escolhido ou os dados do cadastro novo, até a marcação), a
--      marcação em andamento (duplo toque não marca duas vezes) e o atendimento marcado (recarregar mostra a mesma
--      confirmação).
--   3. Data de nascimento a conferir: o paciente disse no portal que é um cadastro existente, com outra data.
--   4. Fila dos avisos do atendimento: chave única por atendimento e tipo (no máximo uma confirmação sai).
-- Tudo pela credencial limitada à clínica (clinic_service); a equipe lê e resolve a data a conferir.
--
-- Reversão: drop das tabelas novas e das colunas novas de `slot_holds`; a restrição de `patients.created_via` sem
-- 'portal' (antes, `update patients set created_via = 'whatsapp' where created_via = 'portal'`).

-- ---------------------------------------------------------------------------
-- 1. Paciente cadastrado pelo portal
alter table public.patients drop constraint patients_created_via_check;
alter table public.patients add constraint patients_created_via_check check (created_via in ('admin', 'whatsapp', 'portal'));
create index patients_contact_portal_created_idx on public.patients (contact_id, created_at) where created_via = 'portal';

-- ---------------------------------------------------------------------------
-- 2. Reserva: quem será atendido, marcação em andamento e o atendimento marcado
alter table public.slot_holds
  add column patient_id uuid references public.patients (id) on delete set null,
  -- Cadastro novo, só gravado na marcação: {"for": "self"|"other", "name", "birthdate", "contactName"?}.
  add column new_patient jsonb check (new_patient is null or jsonb_typeof(new_patient) = 'object'),
  -- O paciente disse que é um cadastro existente, mas com outra data (quadro "Data de nascimento a conferir").
  add column informed_birthdate date,
  add column confirming_at timestamptz,
  add column appointment_id uuid references public.appointments (id) on delete set null;
create index slot_holds_appointment_idx on public.slot_holds (appointment_id) where appointment_id is not null;

-- A credencial da clínica grava só estas colunas, e só nas reservas dela (criar e soltar seguem pelas funções da F2b).
create policy slot_holds_service_update on public.slot_holds for update to clinic_service
  using (clinic_id = app.service_clinic_id()) with check (clinic_id = app.service_clinic_id());
grant update (patient_id, new_patient, informed_birthdate, confirming_at, appointment_id, released_at) on public.slot_holds to clinic_service;

-- ---------------------------------------------------------------------------
-- 3. Data de nascimento a conferir
create table public.portal_birthdate_checks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  appointment_id uuid references public.appointments (id) on delete set null,
  registered_birthdate date not null,
  informed_birthdate date not null check (informed_birthdate <> registered_birthdate),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  resolution text check (resolution in ('corrected', 'kept')),
  check ((resolved_at is null) = (resolution is null))
);
create index portal_birthdate_checks_open_idx on public.portal_birthdate_checks (clinic_id, patient_id) where resolved_at is null;

alter table public.portal_birthdate_checks enable row level security;
create policy portal_birthdate_checks_service on public.portal_birthdate_checks for all to clinic_service
  using (clinic_id = app.service_clinic_id()) with check (clinic_id = app.service_clinic_id());
create policy portal_birthdate_checks_member on public.portal_birthdate_checks for select to authenticated using (app.is_clinic_member(clinic_id));
revoke all on public.portal_birthdate_checks from anon;
revoke insert, update, delete, truncate on public.portal_birthdate_checks from authenticated;
grant select, insert on public.portal_birthdate_checks to clinic_service;
grant select on public.portal_birthdate_checks to authenticated;

-- Corrigir (a data do cadastro passa a ser a informada) ou manter: a equipe da clínica, com a trilha de quem resolveu.
-- Resolve também as outras pendências abertas do mesmo paciente (a data já foi conferida).
create function public.resolve_portal_birthdate_check(p_check_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check public.portal_birthdate_checks%rowtype;
begin
  if p_action not in ('corrected', 'kept') then
    raise exception 'Ação inválida.' using errcode = '22023';
  end if;
  select * into v_check from public.portal_birthdate_checks where id = p_check_id for update;
  -- `is not true`: para quem é de fora, is_clinic_member dá null (não false).
  if v_check.id is null or app.is_clinic_member(v_check.clinic_id) is not true then
    raise exception 'Pendência não encontrada.' using errcode = 'P0002';
  end if;
  if v_check.resolved_at is not null then
    return;
  end if;
  if p_action = 'corrected' then
    update public.patients set birthdate = v_check.informed_birthdate
    where id = v_check.patient_id and clinic_id = v_check.clinic_id;
  end if;
  update public.portal_birthdate_checks
  set resolved_at = now(), resolved_by = (select auth.uid()), resolution = p_action
  where clinic_id = v_check.clinic_id and patient_id = v_check.patient_id and resolved_at is null;
end
$$;
revoke execute on function public.resolve_portal_birthdate_check(uuid, text) from public, anon, clinic_service;
grant execute on function public.resolve_portal_birthdate_check(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Fila dos avisos do atendimento (proposta, seção 4: chave única por atendimento e tipo)
create table public.notice_queue (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  kind text not null check (kind in ('confirmation')),
  -- pending → sending → o resultado do envio (o reenvio do que falhou segue pela rotina de reenvios).
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'skipped_no_template', 'not_connected', 'abandoned')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz,
  unique (appointment_id, kind)
);
create index notice_queue_pending_idx on public.notice_queue (clinic_id, created_at) where status in ('pending', 'sending');

alter table public.notice_queue enable row level security;
create policy notice_queue_service on public.notice_queue for all to clinic_service
  using (clinic_id = app.service_clinic_id()) with check (clinic_id = app.service_clinic_id());
create policy notice_queue_staff on public.notice_queue for select to authenticated using (app.is_platform_staff());
revoke all on public.notice_queue from anon;
revoke insert, update, delete, truncate on public.notice_queue from authenticated;
grant select, insert, update on public.notice_queue to clinic_service;
grant select on public.notice_queue to authenticated;

-- ---------------------------------------------------------------------------
-- Registro do Suporte e clínica suspensa, como em toda tabela da clínica.
create trigger portal_birthdate_checks_audit_platform_staff after insert or update or delete on public.portal_birthdate_checks
  for each row execute function app.audit_platform_staff_write();
create trigger notice_queue_audit_platform_staff after insert or update or delete on public.notice_queue
  for each row execute function app.audit_platform_staff_write();
create trigger portal_birthdate_checks_guard_suspended before insert or update or delete on public.portal_birthdate_checks
  for each row execute function app.guard_suspended_clinic_write();
create trigger notice_queue_guard_suspended before insert or update or delete on public.notice_queue
  for each row execute function app.guard_suspended_clinic_write();

-- Limpeza: a fila resolvida com mais de 30 dias (o envio fica no histórico de mensagens).
select cron.schedule('limpar-fila-avisos', '35 3 * * *', $$
  delete from public.notice_queue where finished_at < now() - interval '30 days';
$$);
