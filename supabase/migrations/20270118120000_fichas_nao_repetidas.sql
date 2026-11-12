-- Possível ficha repetida (cliente, 11/nov/2026, validação da VR): a ficha avisa quando outra ficha ativa tem o mesmo
-- nome e nascimento (ex.: o portal criou a criança de novo pelo número da mãe, porque no portal ninguém se liga
-- sozinho). "Não é a mesma" guarda o par aqui, com quem respondeu, para o aviso não voltar.
--
-- A equipe lê (RLS padrão); só a função grava (Administrador, Recepção e Suporte, como ligar responsável).
--
-- Reversão: drop function public.mark_patients_not_duplicate(uuid, uuid, uuid); drop table public.patient_not_duplicates.

create table public.patient_not_duplicates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  -- O par em ordem (patient_a < patient_b): uma linha por par.
  patient_a uuid not null,
  patient_b uuid not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (patient_a < patient_b),
  unique (clinic_id, patient_a, patient_b),
  foreign key (clinic_id, patient_a) references public.patients (clinic_id, id) on delete cascade,
  foreign key (clinic_id, patient_b) references public.patients (clinic_id, id) on delete cascade
);
create index patient_not_duplicates_b_idx on public.patient_not_duplicates (clinic_id, patient_b);

select app.enable_clinic_data_rls('public.patient_not_duplicates');
revoke insert, update, delete on public.patient_not_duplicates from authenticated, clinic_service;
create trigger patient_not_duplicates_guard_suspended before insert or update or delete on public.patient_not_duplicates
  for each row execute function app.guard_suspended_clinic_write();

create function public.mark_patients_not_duplicate(p_clinic_id uuid, p_patient_id uuid, p_other_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.can_manage_patient_contacts(p_clinic_id) then
    raise exception 'Ficha repetida: sem permissão.' using errcode = '42501';
  end if;
  if p_patient_id = p_other_id
    or (select count(*) from public.patients where clinic_id = p_clinic_id and id in (p_patient_id, p_other_id)) <> 2 then
    raise exception 'Paciente não encontrado.' using errcode = 'P0001', hint = 'patient_not_found';
  end if;
  insert into public.patient_not_duplicates (clinic_id, patient_a, patient_b, created_by)
  values (p_clinic_id, least(p_patient_id, p_other_id), greatest(p_patient_id, p_other_id), (select auth.uid()))
  on conflict (clinic_id, patient_a, patient_b) do nothing;
end
$$;
revoke execute on function public.mark_patients_not_duplicate(uuid, uuid, uuid) from public, anon, clinic_service;
grant execute on function public.mark_patients_not_duplicate(uuid, uuid, uuid) to authenticated;
