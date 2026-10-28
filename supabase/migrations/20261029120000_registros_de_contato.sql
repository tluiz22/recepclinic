-- CRM C1/C2 (SQL aprovado pelo cliente em 28/out/2026): registro do resultado
-- do contato feito pela equipe e o "Atualizado em … por …" das Observações do
-- paciente (Q6 a Q12, seções 13.2 e 13.3 do plano de Relacionamento).
-- Ajuste aprovado na C2: o registro guarda sempre o telefone; o contato
-- cadastrado é opcional (quem aparece em "Retomar contato" sem cadastro).
--
-- A saída das listas (Q8) é do código (src/lib/data/contactInteractions.ts);
-- a tabela só guarda os registros, que não se alteram nem se apagam (Q9).
--
-- Reversão: drop table public.contact_interactions; drop function
-- app.contact_interaction_rules(), app.clear_interactions_on_anonymize() e
-- app.patient_notes_stamp(); alter table public.patients drop column
-- notes_updated_at, drop column notes_updated_by.

-- ---------------------------------------------------------------------------
-- 1. Registros de contato
-- ---------------------------------------------------------------------------
create table public.contact_interactions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  contact_phone text not null check (contact_phone ~ '^\+\d{10,15}$'),
  contact_id uuid,
  patient_id uuid,
  source text not null check (source in ('retomar_contato', 'retorno', 'faltosos', 'aguardando_remarcacao',
                                         'lembretes', 'lista_espera', 'atendimento', 'ficha_paciente')),
  -- A pendência (a consulta do Retorno, o atendimento do Lembrete) ou, no
  -- "Marcou", o atendimento marcado.
  appointment_id uuid,
  funnel_session_id uuid,
  outcome text not null check (outcome in ('scheduled', 'link_sent', 'call_back', 'no_answer',
                                           'not_interested', 'wrong_number', 'other')),
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  -- "Marcou" exige o atendimento (Q10). "Outro" exige observação (Q7) só na
  -- gravação (gatilho abaixo): a anonimização apaga a observação depois.
  constraint contact_interactions_scheduled_appointment check (outcome <> 'scheduled' or appointment_id is not null),
  foreign key (clinic_id, contact_id) references public.contacts (clinic_id, id) on delete set null (contact_id),
  foreign key (clinic_id, patient_id) references public.patients (clinic_id, id) on delete set null (patient_id),
  foreign key (clinic_id, appointment_id) references public.appointments (clinic_id, id) on delete set null (appointment_id)
);

create index contact_interactions_phone_idx on public.contact_interactions (clinic_id, contact_phone, created_at desc);
create index contact_interactions_patient_idx on public.contact_interactions (clinic_id, patient_id, created_at desc) where patient_id is not null;
create index contact_interactions_appointment_idx on public.contact_interactions (appointment_id) where appointment_id is not null;

-- Na gravação: o autor e a hora são sempre de quem grava; com contato, o
-- telefone é o dele; "Outro" tem observação; o paciente é do contato;
-- "Marcou" aponta para um atendimento ativo de um paciente do contato.
create function app.contact_interaction_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
begin
  new.created_by := auth.uid();
  new.created_at := now();
  if new.outcome = 'other' and length(trim(coalesce(new.note, ''))) = 0 then
    raise exception 'Outro exige observação' using errcode = '23514';
  end if;
  if new.contact_id is not null then
    select c.phone into v_phone from public.contacts c where c.clinic_id = new.clinic_id and c.id = new.contact_id;
    if v_phone is not null then
      new.contact_phone := v_phone;
    end if;
  end if;
  if new.patient_id is not null and not exists (
       select 1 from public.patients p
        where p.clinic_id = new.clinic_id and p.id = new.patient_id
          and new.contact_id is not null and p.contact_id = new.contact_id) then
    raise exception 'paciente não é deste contato' using errcode = '23514';
  end if;
  if new.outcome = 'scheduled' and not exists (
       select 1 from public.appointments a
         join public.patients p on p.id = a.patient_id
        where a.clinic_id = new.clinic_id and a.id = new.appointment_id
          and new.contact_id is not null and p.contact_id = new.contact_id
          and a.status <> 'canceled') then
    raise exception 'Marcou exige um atendimento ativo deste contato' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger contact_interactions_rules
  before insert on public.contact_interactions
  for each row execute function app.contact_interaction_rules();

-- Lê quem é da clínica; grava só Administrador e Recepção (o Suporte vale por
-- todos, com auditoria), com o item "Relacionamento" liberado; ninguém altera
-- nem apaga (Q9); o bot não tem acesso.
alter table public.contact_interactions enable row level security;

create policy contact_interactions_select on public.contact_interactions
  for select to authenticated using (app.is_clinic_member(clinic_id));
create policy contact_interactions_insert on public.contact_interactions
  for insert to authenticated with check (
    app.has_clinic_role(clinic_id, array['admin', 'reception']::public.clinic_role[])
    and app.clinic_has_feature(clinic_id, 'relationship')
  );

revoke all on public.contact_interactions from anon;
revoke update, delete, truncate on public.contact_interactions from authenticated;

create trigger contact_interactions_audit_platform_staff
  after insert on public.contact_interactions
  for each row execute function app.audit_platform_staff_write();

-- Anonimização (Q9): a observação dos registros do contato sai, e o telefone
-- vira o anonimizado, inclusive nos registros feitos antes do cadastro.
create function app.clear_interactions_on_anonymize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.contact_interactions
     set note = null, contact_phone = new.phone
   where clinic_id = new.clinic_id
     and (contact_id = new.id or contact_phone = old.phone);
  return null;
end
$$;

create trigger contacts_clear_interactions
  after update of anonymized_at on public.contacts
  for each row when (old.anonymized_at is null and new.anonymized_at is not null)
  execute function app.clear_interactions_on_anonymize();

revoke execute on function app.contact_interaction_rules() from public, anon, authenticated, clinic_service;
revoke execute on function app.clear_interactions_on_anonymize() from public, anon, authenticated, clinic_service;

-- ---------------------------------------------------------------------------
-- 2. Observações do paciente: "Atualizado em … por …" (Q6, Q12)
-- ---------------------------------------------------------------------------
alter table public.patients
  add column notes_updated_at timestamptz,
  add column notes_updated_by uuid;

-- Grava só quando as observações mudam (o formulário regrava tudo junto com o
-- nome); o valor que vier da tela ou da API é sempre trocado pelo de quem
-- grava. A anonimização zera os dois.
create function app.patient_notes_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.anonymized_at is not null then
    new.notes_updated_at := null;
    new.notes_updated_by := null;
  elsif tg_op = 'INSERT' then
    new.notes_updated_at := case when new.notes is not null then now() end;
    new.notes_updated_by := case when new.notes is not null then auth.uid() end;
  elsif new.notes is distinct from old.notes then
    new.notes_updated_at := now();
    new.notes_updated_by := auth.uid();
  else
    new.notes_updated_at := old.notes_updated_at;
    new.notes_updated_by := old.notes_updated_by;
  end if;
  return new;
end
$$;

create trigger patients_notes_stamp
  before insert or update on public.patients
  for each row execute function app.patient_notes_stamp();
