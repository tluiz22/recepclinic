-- CRM P2 (aprovada pelo cliente em 28/out/2026): anotações datadas do
-- paciente no lugar do campo único "Observações" (Q20, Q21; seção 19 do plano
-- de Relacionamento).
--
-- A equipe toda lê; Administrador, Recepção e Profissional escrevem; só o
-- autor edita (fica "editada em …"); só o Administrador apaga; Suporte com
-- auditoria; o bot não tem acesso. As Observações de hoje viram a 1ª anotação
-- de cada paciente ("Observações anteriores", sem autor) e o campo antigo fica
-- vazio e sem uso (a anonimização continua a zerá-lo).
--
-- Reversão: update public.patients p set notes = n.body from public.patient_notes n
-- where n.patient_id = p.id and n.from_observations; drop table public.patient_notes;
-- drop function app.patient_note_rules() e app.drop_notes_on_anonymize().
-- As anotações novas se perdem na reversão.

create table public.patient_notes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  -- Veio das Observações antigas (sem autor conhecido).
  from_observations boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  -- "Editada em …".
  updated_at timestamptz,
  foreign key (clinic_id, patient_id) references public.patients (clinic_id, id) on delete cascade
);

create index patient_notes_patient_idx on public.patient_notes (clinic_id, patient_id, created_at desc);

-- Gravação: autor e hora sempre de quem grava. Edição: só o texto muda, com a
-- hora da edição. A passagem das Observações (abaixo) roda sem login e marca a
-- origem por fora do gatilho.
create function app.patient_note_rules()
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
    new.from_observations := coalesce(new.from_observations and auth.uid() is null, false);
  else
    new.clinic_id := old.clinic_id;
    new.patient_id := old.patient_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.from_observations := old.from_observations;
    new.updated_at := case when new.body is distinct from old.body then now() else old.updated_at end;
  end if;
  return new;
end
$$;

create trigger patient_notes_rules
  before insert or update on public.patient_notes
  for each row execute function app.patient_note_rules();

alter table public.patient_notes enable row level security;

create policy patient_notes_select on public.patient_notes
  for select to authenticated using (app.is_clinic_member(clinic_id));
create policy patient_notes_insert on public.patient_notes
  for insert to authenticated
  with check (app.has_clinic_role(clinic_id, array['admin', 'reception', 'professional']::public.clinic_role[]));
create policy patient_notes_update on public.patient_notes
  for update to authenticated
  using (created_by = auth.uid() and app.has_clinic_role(clinic_id, array['admin', 'reception', 'professional']::public.clinic_role[]))
  with check (created_by = auth.uid());
create policy patient_notes_delete on public.patient_notes
  for delete to authenticated
  using (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]));

revoke all on public.patient_notes from anon;
revoke truncate on public.patient_notes from authenticated;

create trigger patient_notes_audit_platform_staff
  after insert or update or delete on public.patient_notes
  for each row execute function app.audit_platform_staff_write();

-- Anonimização: as anotações do paciente saem junto.
create function app.drop_notes_on_anonymize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.patient_notes where clinic_id = new.clinic_id and patient_id = new.id;
  return null;
end
$$;

create trigger patients_drop_notes
  after update of anonymized_at on public.patients
  for each row when (old.anonymized_at is null and new.anonymized_at is not null)
  execute function app.drop_notes_on_anonymize();

revoke execute on function app.patient_note_rules() from public, anon, authenticated, clinic_service;
revoke execute on function app.drop_notes_on_anonymize() from public, anon, authenticated, clinic_service;

-- As Observações de hoje viram a 1ª anotação de cada paciente; o campo antigo fica vazio.
insert into public.patient_notes (clinic_id, patient_id, body, from_observations)
  select clinic_id, id, left(trim(notes), 2000), true
    from public.patients
   where nullif(trim(notes), '') is not null and anonymized_at is null;

update public.patients set notes = null where notes is not null and anonymized_at is null;
