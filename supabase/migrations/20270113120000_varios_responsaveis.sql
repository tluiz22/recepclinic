-- VR1 — Vários responsáveis por paciente (D14; decisões VR-1 a VR-7 em docs/planejamento-varios-responsaveis.md,
-- cliente, 10/nov/2026). Só banco: nada muda para o usuário até a VR2 e a VR3.
--
-- 1. patient_contacts: uma linha por responsável do paciente (parentesco opcional, quem ligou e quando). A equipe e o
--    bot leem; só as funções gravam. patients.contact_id continua e é o responsável principal (sempre na tabela: o
--    gatilho do paciente liga o principal). is_self marca o número do próprio paciente (patients.is_contact_self passa
--    a acompanhar o principal).
-- 2. patient_contact_events: registro de ligar, desligar e tornar principal (quem e quando).
-- 3. contact_patient_ids(clínica, contato): "pacientes deste número", para todo o código (VR3).
-- 4. Ligar, desligar e tornar principal: Administrador, Recepção e Suporte. Desligar quem marcou consultas futuras
--    devolve os avisos delas ao principal.
-- 5. appointments.booked_by_contact_id (VR-1, quem marcou): preenchida com o principal nas consultas que já existem e,
--    sem valor, na marcação; precisa ser um responsável ligado ao paciente. Os limites do bot contam por ela (VR-5).
-- 6. anonymize_patient (VR-6): o paciente sai de todos os responsáveis; só quem fica sem paciente é anonimizado.
--
-- Reversão: recriar anonymize_patient como em 20261022120000; drop das funções novas, dos gatilhos, de
-- appointments.booked_by_contact_id e das duas tabelas.

-- ---------------------------------------------------------------------------
-- 1. Responsáveis do paciente
-- ---------------------------------------------------------------------------
create table public.patient_contacts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null,
  contact_id uuid not null,
  -- Parentesco opcional ("Mãe", "Pai", "Avó"…), texto livre e curto.
  kinship text check (kinship is null or length(trim(kinship)) between 1 and 40),
  -- O número é do próprio paciente (vale para patients.is_contact_self quando é o principal).
  is_self boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  unique (patient_id, contact_id),
  foreign key (clinic_id, patient_id) references public.patients (clinic_id, id) on delete cascade,
  foreign key (clinic_id, contact_id) references public.contacts (clinic_id, id) on delete cascade
);
create index patient_contacts_contact_idx on public.patient_contacts (clinic_id, contact_id);
-- Um número é "o próprio paciente" de um paciente só (como patients_one_contact_self_idx).
create unique index patient_contacts_one_self_idx on public.patient_contacts (contact_id) where is_self;

select app.enable_clinic_data_rls('public.patient_contacts');
revoke insert, update, delete on public.patient_contacts from authenticated, clinic_service;
create trigger patient_contacts_guard_suspended before insert or update or delete on public.patient_contacts
  for each row execute function app.guard_suspended_clinic_write();

-- ---------------------------------------------------------------------------
-- 2. Registro
-- ---------------------------------------------------------------------------
create table public.patient_contact_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null,
  contact_id uuid not null,
  event text not null check (event in ('linked', 'unlinked', 'made_primary')),
  kinship text,
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (clinic_id, patient_id) references public.patients (clinic_id, id) on delete cascade,
  foreign key (clinic_id, contact_id) references public.contacts (clinic_id, id) on delete cascade
);
create index patient_contact_events_patient_idx on public.patient_contact_events (clinic_id, patient_id, created_at desc);

select app.enable_clinic_data_rls('public.patient_contact_events');
revoke insert, update, delete on public.patient_contact_events from authenticated, clinic_service;
create trigger patient_contact_events_guard_suspended before insert or update or delete on public.patient_contact_events
  for each row execute function app.guard_suspended_clinic_write();

-- ---------------------------------------------------------------------------
-- O principal sempre na tabela: cadastro novo e troca de patients.contact_id
-- ---------------------------------------------------------------------------
create function app.link_primary_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.anonymized_at is not null then
    return null;
  end if;
  insert into public.patient_contacts (clinic_id, patient_id, contact_id, is_self, created_by)
  values (new.clinic_id, new.id, new.contact_id, new.is_contact_self, (select auth.uid()))
  on conflict (patient_id, contact_id) do nothing;
  return null;
end
$$;
revoke execute on function app.link_primary_contact() from public, anon, authenticated, clinic_service;

create trigger patients_link_primary_contact
  after insert or update of contact_id on public.patients
  for each row execute function app.link_primary_contact();

-- Os pacientes de hoje (menos os anonimizados): o contato de cada um vira o principal.
insert into public.patient_contacts (clinic_id, patient_id, contact_id, is_self, created_at)
select clinic_id, id, contact_id, is_contact_self, created_at
  from public.patients
 where anonymized_at is null;

-- ---------------------------------------------------------------------------
-- 3. Pacientes deste número
-- ---------------------------------------------------------------------------
-- Com as permissões de quem chama (RLS): a equipe e o bot só veem a própria clínica.
create function public.contact_patient_ids(p_clinic_id uuid, p_contact_id uuid)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select patient_id from public.patient_contacts where clinic_id = p_clinic_id and contact_id = p_contact_id
$$;
revoke execute on function public.contact_patient_ids(uuid, uuid) from public, anon;
grant execute on function public.contact_patient_ids(uuid, uuid) to authenticated, clinic_service;

-- ---------------------------------------------------------------------------
-- 4. Ligar, desligar e tornar principal
-- ---------------------------------------------------------------------------
create function app.can_manage_patient_contacts(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_platform_staff() or app.has_clinic_role(p_clinic_id, array['admin', 'reception']::public.clinic_role[])
$$;
revoke execute on function app.can_manage_patient_contacts(uuid) from public, anon, clinic_service;

-- Paciente da clínica, ainda não anonimizado (trava a linha até o fim da operação).
create function app.lock_patient_for_contacts(p_clinic_id uuid, p_patient_id uuid)
returns public.patients
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient public.patients%rowtype;
begin
  select * into v_patient from public.patients where clinic_id = p_clinic_id and id = p_patient_id for update;
  if not found then
    raise exception 'Paciente não encontrado.' using errcode = 'P0001', hint = 'patient_not_found';
  end if;
  if v_patient.anonymized_at is not null then
    raise exception 'Paciente anonimizado.' using errcode = 'P0001', hint = 'anonymized';
  end if;
  return v_patient;
end
$$;
revoke execute on function app.lock_patient_for_contacts(uuid, uuid) from public, anon, authenticated, clinic_service;

create function public.link_patient_contact(p_clinic_id uuid, p_patient_id uuid, p_contact_id uuid, p_kinship text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact public.contacts%rowtype;
  v_kinship text := nullif(trim(coalesce(p_kinship, '')), '');
  v_id uuid;
begin
  if not app.can_manage_patient_contacts(p_clinic_id) then
    raise exception 'Ligar responsável: sem permissão.' using errcode = '42501';
  end if;
  perform app.lock_patient_for_contacts(p_clinic_id, p_patient_id);
  select * into v_contact from public.contacts where clinic_id = p_clinic_id and id = p_contact_id;
  if not found then
    raise exception 'Responsável não encontrado.' using errcode = 'P0001', hint = 'contact_not_found';
  end if;
  if v_contact.anonymized_at is not null or not v_contact.is_active then
    raise exception 'Responsável desativado.' using errcode = 'P0001', hint = 'contact_inactive';
  end if;
  if exists (select 1 from public.patient_contacts where patient_id = p_patient_id and contact_id = p_contact_id) then
    raise exception 'Responsável já ligado ao paciente.' using errcode = 'P0001', hint = 'already_linked';
  end if;

  insert into public.patient_contacts (clinic_id, patient_id, contact_id, kinship, created_by)
  values (p_clinic_id, p_patient_id, p_contact_id, v_kinship, (select auth.uid()))
  returning id into v_id;
  insert into public.patient_contact_events (clinic_id, patient_id, contact_id, event, kinship, actor_id)
  values (p_clinic_id, p_patient_id, p_contact_id, 'linked', v_kinship, (select auth.uid()));
  return v_id;
end
$$;
revoke execute on function public.link_patient_contact(uuid, uuid, uuid, text) from public, anon, clinic_service;
grant execute on function public.link_patient_contact(uuid, uuid, uuid, text) to authenticated;

-- O principal não se desliga (antes, tornar outro principal). Consultas futuras que ele marcou passam ao principal.
create function public.unlink_patient_contact(p_clinic_id uuid, p_patient_id uuid, p_contact_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient public.patients%rowtype;
  v_kinship text;
  v_moved integer;
begin
  if not app.can_manage_patient_contacts(p_clinic_id) then
    raise exception 'Desligar responsável: sem permissão.' using errcode = '42501';
  end if;
  v_patient := app.lock_patient_for_contacts(p_clinic_id, p_patient_id);
  if v_patient.contact_id = p_contact_id then
    raise exception 'O responsável principal não pode ser desligado.' using errcode = 'P0001', hint = 'is_primary';
  end if;
  delete from public.patient_contacts where clinic_id = p_clinic_id and patient_id = p_patient_id and contact_id = p_contact_id
  returning kinship into v_kinship;
  if not found then
    raise exception 'Responsável não ligado ao paciente.' using errcode = 'P0001', hint = 'not_linked';
  end if;

  update public.appointments
     set booked_by_contact_id = v_patient.contact_id
   where clinic_id = p_clinic_id and patient_id = p_patient_id and booked_by_contact_id = p_contact_id
     and status in ('scheduled', 'confirmed') and scheduled_at > now();
  get diagnostics v_moved = row_count;

  insert into public.patient_contact_events (clinic_id, patient_id, contact_id, event, kinship, actor_id)
  values (p_clinic_id, p_patient_id, p_contact_id, 'unlinked', v_kinship, (select auth.uid()));
  return v_moved;
end
$$;
revoke execute on function public.unlink_patient_contact(uuid, uuid, uuid) from public, anon, clinic_service;
grant execute on function public.unlink_patient_contact(uuid, uuid, uuid) to authenticated;

-- O novo principal precisa estar ligado; o anterior continua ligado. is_contact_self acompanha o principal.
create function public.set_patient_primary_contact(p_clinic_id uuid, p_patient_id uuid, p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient public.patients%rowtype;
  v_link public.patient_contacts%rowtype;
begin
  if not app.can_manage_patient_contacts(p_clinic_id) then
    raise exception 'Tornar principal: sem permissão.' using errcode = '42501';
  end if;
  v_patient := app.lock_patient_for_contacts(p_clinic_id, p_patient_id);
  select * into v_link from public.patient_contacts where clinic_id = p_clinic_id and patient_id = p_patient_id and contact_id = p_contact_id;
  if not found then
    raise exception 'Responsável não ligado ao paciente.' using errcode = 'P0001', hint = 'not_linked';
  end if;
  if v_patient.contact_id = p_contact_id then
    return;
  end if;

  update public.patients set contact_id = p_contact_id, is_contact_self = v_link.is_self
   where clinic_id = p_clinic_id and id = p_patient_id;
  insert into public.patient_contact_events (clinic_id, patient_id, contact_id, event, kinship, actor_id)
  values (p_clinic_id, p_patient_id, p_contact_id, 'made_primary', v_link.kinship, (select auth.uid()));
end
$$;
revoke execute on function public.set_patient_primary_contact(uuid, uuid, uuid) from public, anon, clinic_service;
grant execute on function public.set_patient_primary_contact(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Quem marcou a consulta
-- ---------------------------------------------------------------------------
alter table public.appointments add column booked_by_contact_id uuid;
alter table public.appointments add constraint appointments_booked_by_contact_fkey
  foreign key (clinic_id, booked_by_contact_id) references public.contacts (clinic_id, id) on delete set null (booked_by_contact_id);
create index appointments_booked_by_contact_idx on public.appointments (booked_by_contact_id) where booked_by_contact_id is not null;
comment on column public.appointments.booked_by_contact_id is
  'Responsável que marcou (ou remarcou) a consulta: recebe lembrete, confirmação e avisos, e conta nos limites (D14).';

-- As consultas que já existem: o principal de hoje (sem mexer em updated_at).
alter table public.appointments disable trigger appointments_set_updated_at;
update public.appointments a set booked_by_contact_id = p.contact_id
  from public.patients p
 where p.clinic_id = a.clinic_id and p.id = a.patient_id and a.booked_by_contact_id is null;
alter table public.appointments enable trigger appointments_set_updated_at;

-- Sem valor: o principal. Com valor: um responsável ligado ao paciente. Paciente trocado: volta ao principal do novo
-- paciente se quem marcou não cuida dele.
create function app.set_appointment_booked_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_linked boolean;
begin
  if new.booked_by_contact_id is not null then
    select exists (
      select 1 from public.patient_contacts
       where clinic_id = new.clinic_id and patient_id = new.patient_id and contact_id = new.booked_by_contact_id
    ) into v_linked;
  end if;
  if new.booked_by_contact_id is null
    or (not v_linked and tg_op = 'UPDATE' and new.patient_id is distinct from old.patient_id
        and new.booked_by_contact_id is not distinct from old.booked_by_contact_id) then
    select contact_id into new.booked_by_contact_id from public.patients where clinic_id = new.clinic_id and id = new.patient_id;
  elsif not v_linked and (tg_op = 'INSERT' or new.booked_by_contact_id is distinct from old.booked_by_contact_id) then
    -- (Quem marcou e depois foi desligado continua na consulta antiga: só a escolha nova precisa estar ligada.)
    raise exception 'Quem marcou não é responsável pelo paciente.' using errcode = '23514', hint = 'booked_by_not_linked';
  end if;
  return new;
end
$$;
revoke execute on function app.set_appointment_booked_by() from public, anon, authenticated, clinic_service;

create trigger appointments_set_booked_by
  before insert or update of patient_id, booked_by_contact_id on public.appointments
  for each row execute function app.set_appointment_booked_by();

-- ---------------------------------------------------------------------------
-- 6. Anonimização (VR-6): só quem fica sem paciente
-- ---------------------------------------------------------------------------
-- Mantém a versão de 20261022120000 (trilha pelo gatilho), com o passo 2 revisto: o paciente sai de todos os
-- responsáveis; o responsável que não cuida de mais ninguém é anonimizado (telefone, nome, endereço, mensagens,
-- conversa, links e registro do Suporte, como antes); quem cuida de outro paciente continua, e das mensagens dele só
-- as das consultas do paciente perdem o texto.
create or replace function public.anonymize_patient(p_clinic_id uuid, p_patient_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient public.patients%rowtype;
  v_contact public.contacts%rowtype;
  v_actor uuid := (select auth.uid());
  v_appointments uuid[];
  v_contact_ids uuid[];
  v_gone_ids uuid[] := '{}';
  v_gone_phones text[] := '{}';
  v_kept integer := 0;
  v_canceled integer;
  v_others integer;
begin
  if not (app.is_platform_staff() or app.has_clinic_role(p_clinic_id, array['admin']::public.clinic_role[])) then
    raise exception 'anonimizar paciente: sem permissão' using errcode = '42501';
  end if;

  select * into v_patient from public.patients where clinic_id = p_clinic_id and id = p_patient_id for update;
  if not found then
    raise exception 'anonimizar paciente: não encontrado' using errcode = 'P0002';
  end if;
  if v_patient.anonymized_at is not null then
    raise exception 'anonimizar paciente: já anonimizado' using errcode = 'P0001', hint = 'already_anonymized';
  end if;

  -- Todos os responsáveis (o principal, mesmo se faltasse na tabela).
  select array_agg(distinct c) into v_contact_ids from (
    select contact_id as c from public.patient_contacts where clinic_id = p_clinic_id and patient_id = p_patient_id
    union select v_patient.contact_id
  ) s;

  -- Outros pacientes desses responsáveis (continuam com o seu número).
  select count(distinct patient_id) into v_others from public.patient_contacts
   where clinic_id = p_clinic_id and contact_id = any (v_contact_ids) and patient_id <> p_patient_id;

  select coalesce(array_agg(id), '{}') into v_appointments
    from public.appointments where clinic_id = p_clinic_id and patient_id = p_patient_id;

  -- 4. Futuros: cancelados pela clínica, sem aviso (a trilha sai do gatilho da tabela, com o motivo).
  with canceled as (
    update public.appointments
       set status = 'canceled', canceled_at = now(), canceled_via = 'admin', canceled_by = v_actor, mass_canceled = false,
           trail_context = jsonb_build_object('details', jsonb_build_object('reason', 'anonymized'))
     where clinic_id = p_clinic_id and patient_id = p_patient_id
       and status in ('scheduled', 'confirmed') and scheduled_at > now()
    returning id
  )
  select count(*) into v_canceled from canceled;

  -- Inscrições na lista de espera que sobraram (atendimentos passados).
  update public.waitlist_entries
     set status = 'closed', ended_at = now(), ended_reason = 'anonymized', ended_by = v_actor
   where clinic_id = p_clinic_id and status = 'active' and appointment_id = any (v_appointments);

  -- Séries: param de gerar e perdem o endereço.
  update public.appointment_series
     set ended_at = coalesce(ended_at, now()), ended_by = coalesce(ended_by, v_actor), home_visit_address = null
   where clinic_id = p_clinic_id and patient_id = p_patient_id;

  -- 1. Histórico sem endereço; paciente sem identificação e desligado de todos os responsáveis.
  update public.appointments set home_visit_address = null
   where clinic_id = p_clinic_id and patient_id = p_patient_id and home_visit_address is not null;

  update public.patients
     set full_name = 'Paciente anonimizado', birthdate = date '1900-01-01', notes = null,
         insurance_card_number = null, insurance_card_valid_until = null,
         is_active = false, anonymized_at = now()
   where clinic_id = p_clinic_id and id = p_patient_id;

  delete from public.patient_contacts where clinic_id = p_clinic_id and patient_id = p_patient_id;

  -- Mensagens das consultas do paciente: sem texto (de qualquer responsável).
  update public.whatsapp_messages set body = null
   where clinic_id = p_clinic_id and appointment_id = any (v_appointments) and body is not null;

  -- Links de agendamento do paciente: vencidos e sem endereço.
  update public.booking_links
     set home_visit_address = null, expires_at = least(expires_at, now())
   where clinic_id = p_clinic_id and patient_id = p_patient_id;

  -- 2. Cada responsável que ficou sem paciente: anonimizado.
  for v_contact in
    select * from public.contacts where clinic_id = p_clinic_id and id = any (v_contact_ids) order by id for update
  loop
    if exists (select 1 from public.patient_contacts where clinic_id = p_clinic_id and contact_id = v_contact.id) then
      v_kept := v_kept + 1;
      continue;
    end if;
    v_gone_ids := v_gone_ids || v_contact.id;
    v_gone_phones := v_gone_phones || v_contact.phone;

    if v_contact.anonymized_at is null then
      update public.contacts
         set full_name = 'Contato anonimizado', phone = app.anonymized_phone(v_contact.id), default_home_address = null,
             is_active = false, anonymized_at = now()
       where clinic_id = p_clinic_id and id = v_contact.id;
    end if;

    update public.whatsapp_messages
       set body = null, contact_phone = case when contact_phone is null then null else app.anonymized_phone(v_contact.id) end
     where clinic_id = p_clinic_id and (contact_id = v_contact.id or contact_phone = v_contact.phone);

    delete from public.conversation_state
     where clinic_id = p_clinic_id and (contact_id = v_contact.id or contact_phone = v_contact.phone);

    update public.bot_funnel_events
       set contact_phone = app.anonymized_phone(v_contact.id), metadata = app.scrub_personal(metadata)
     where clinic_id = p_clinic_id and (contact_id = v_contact.id or contact_phone = v_contact.phone);

    update public.booking_links
       set contact_phone = app.anonymized_phone(v_contact.id), home_visit_address = null,
           expires_at = least(expires_at, now())
     where clinic_id = p_clinic_id and contact_id = v_contact.id;
  end loop;

  -- 5. Registro do Suporte (inclusive as cópias que as linhas acima acabaram de gerar).
  update public.platform_audit_log
     set old_row = app.scrub_personal(old_row), new_row = app.scrub_personal(new_row)
   where clinic_id = p_clinic_id
     and (
       (table_name = 'patients' and coalesce(new_row, old_row) ->> 'id' = p_patient_id::text)
       or coalesce(new_row, old_row) ->> 'patient_id' = p_patient_id::text
       or (table_name = 'appointments' and coalesce(new_row, old_row) ->> 'id' = any (select unnest(v_appointments)::text))
       or coalesce(new_row, old_row) ->> 'appointment_id' = any (select unnest(v_appointments)::text)
       or (table_name = 'contacts' and coalesce(new_row, old_row) ->> 'id' = any (select unnest(v_gone_ids)::text))
       or coalesce(new_row, old_row) ->> 'contact_id' = any (select unnest(v_gone_ids)::text)
       or coalesce(new_row, old_row) ->> 'contact_phone' = any (v_gone_phones)
     );

  return jsonb_build_object(
    'canceled', v_canceled,
    'other_patients', v_others,
    'contacts_anonymized', coalesce(array_length(v_gone_ids, 1), 0),
    'contacts_kept', v_kept
  );
end
$$;
