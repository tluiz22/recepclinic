-- CRM P3 (aprovada pelo cliente em 28/out/2026): lembretes da equipe na ficha
-- do paciente, com data (Q22; seção "Anotações, lembretes e documentos" do
-- plano de Relacionamento).
--
-- A equipe toda lê; Administrador, Recepção e Profissional criam e marcam
-- "Feito" (e "Desfazer"); só o autor corrige o texto e a data (fica "editado
-- em …"); só o Administrador apaga; Suporte com auditoria; o bot não tem
-- acesso. Os abertos de hoje e os atrasados vão para a aba "Lembretes da
-- equipe" do Relacionamento; os feitos ficam no histórico da ficha.
--
-- Reversão: drop table public.patient_reminders; drop function
-- app.patient_reminder_rules() e app.drop_reminders_on_anonymize().

create table public.patient_reminders (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null,
  body text not null check (char_length(trim(body)) between 1 and 500),
  due_on date not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  -- "Editado em …" (texto ou data).
  updated_at timestamptz,
  -- "Feito": quando e por quem.
  done_at timestamptz,
  done_by uuid,
  foreign key (clinic_id, patient_id) references public.patients (clinic_id, id) on delete cascade
);

-- Os abertos da clínica por data (Relacionamento e número do menu).
create index patient_reminders_open_idx on public.patient_reminders (clinic_id, due_on) where done_at is null;
create index patient_reminders_patient_idx on public.patient_reminders (clinic_id, patient_id, due_on);

-- Gravação: autor e hora de quem grava; nasce aberto. Edição: clínica,
-- paciente, autor e criação não mudam; texto e data só pelo autor; "Feito"
-- grava quem marcou e quando, "Desfazer" limpa os dois.
create function app.patient_reminder_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := null;
    new.done_at := null;
    new.done_by := null;
    return new;
  end if;

  new.clinic_id := old.clinic_id;
  new.patient_id := old.patient_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if new.body is distinct from old.body or new.due_on is distinct from old.due_on then
    if old.created_by is distinct from auth.uid() then
      raise exception 'só quem escreveu corrige o lembrete' using errcode = '42501';
    end if;
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;

  if new.done_at is null then
    new.done_by := null;
  elsif old.done_at is null then
    new.done_at := now();
    new.done_by := auth.uid();
  else
    new.done_at := old.done_at;
    new.done_by := old.done_by;
  end if;
  return new;
end
$$;

create trigger patient_reminders_rules
  before insert or update on public.patient_reminders
  for each row execute function app.patient_reminder_rules();

alter table public.patient_reminders enable row level security;

create policy patient_reminders_select on public.patient_reminders
  for select to authenticated using (app.is_clinic_member(clinic_id));
create policy patient_reminders_insert on public.patient_reminders
  for insert to authenticated
  with check (app.has_clinic_role(clinic_id, array['admin', 'reception', 'professional']::public.clinic_role[]));
create policy patient_reminders_update on public.patient_reminders
  for update to authenticated
  using (app.has_clinic_role(clinic_id, array['admin', 'reception', 'professional']::public.clinic_role[]))
  with check (app.has_clinic_role(clinic_id, array['admin', 'reception', 'professional']::public.clinic_role[]));
create policy patient_reminders_delete on public.patient_reminders
  for delete to authenticated
  using (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]));

revoke all on public.patient_reminders from anon;
revoke truncate on public.patient_reminders from authenticated;

create trigger patient_reminders_audit_platform_staff
  after insert or update or delete on public.patient_reminders
  for each row execute function app.audit_platform_staff_write();

-- Anonimização: os lembretes do paciente saem junto.
create function app.drop_reminders_on_anonymize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.patient_reminders where clinic_id = new.clinic_id and patient_id = new.id;
  return null;
end
$$;

create trigger patients_drop_reminders
  after update of anonymized_at on public.patients
  for each row when (old.anonymized_at is null and new.anonymized_at is not null)
  execute function app.drop_reminders_on_anonymize();

revoke execute on function app.patient_reminder_rules() from public, anon, authenticated, clinic_service;
revoke execute on function app.drop_reminders_on_anonymize() from public, anon, authenticated, clinic_service;
