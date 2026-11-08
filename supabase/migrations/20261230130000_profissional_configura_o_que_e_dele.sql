-- ---------------------------------------------------------------------------
-- O profissional configura o que é dele (MS, etapa S1; cliente, 07/nov/2026)
-- ---------------------------------------------------------------------------
-- O profissional com login (professionals.user_id) vê e altera em
-- Configurações só o que é dele: o próprio cadastro (dados, especialidades,
-- convênios que atende, informações do bot), a própria agenda (intervalo), os
-- horários dela e os serviços dele (cadastrar, editar, desativar). Desativar o
-- próprio cadastro ou a agenda, o login, os serviços da equipe e o resto da
-- clínica seguem só com o Administrador. As políticas abaixo somam às do
-- Administrador (permissivas); os gatilhos barram o que é só dele.
--
-- Reversão: drop das políticas *_own e dos gatilhos/funções criados aqui.

-- O profissional ativo ligado ao login, na clínica (null: não é profissional com login).
create function app.own_professional_id(p_clinic uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
    from public.professionals p
   where p.clinic_id = p_clinic
     and p.user_id = (select auth.uid())
     and p.is_active
     and app.has_clinic_role(p_clinic, array['professional']::public.clinic_role[])
   limit 1
$$;

grant execute on function app.own_professional_id(uuid) to authenticated;

-- Serviço do próprio profissional.
create function app.owns_service(p_clinic uuid, p_service uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.services s
     where s.id = p_service and s.clinic_id = p_clinic
       and s.professional_id is not null and s.professional_id = app.own_professional_id(p_clinic)
  )
$$;

-- Agenda do próprio profissional.
create function app.owns_agenda(p_clinic uuid, p_agenda uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.agendas a
     where a.id = p_agenda and a.clinic_id = p_clinic
       and a.professional_id is not null and a.professional_id = app.own_professional_id(p_clinic)
  )
$$;

grant execute on function app.owns_service(uuid, uuid) to authenticated;
grant execute on function app.owns_agenda(uuid, uuid) to authenticated;

-- Serviços: só os dele (nunca os da equipe nem de outro profissional).
create policy services_insert_own on public.services for insert to authenticated
  with check (professional_id is not null and professional_id = app.own_professional_id(clinic_id) and not is_team);
create policy services_update_own on public.services for update to authenticated
  using (professional_id is not null and professional_id = app.own_professional_id(clinic_id))
  with check (professional_id is not null and professional_id = app.own_professional_id(clinic_id) and not is_team);

create policy service_locations_insert_own on public.service_locations for insert to authenticated
  with check (app.owns_service(clinic_id, service_id));
create policy service_locations_update_own on public.service_locations for update to authenticated
  using (app.owns_service(clinic_id, service_id)) with check (app.owns_service(clinic_id, service_id));
create policy service_locations_delete_own on public.service_locations for delete to authenticated
  using (app.owns_service(clinic_id, service_id));

-- Horários: só os da agenda dele.
create policy availability_windows_insert_own on public.availability_windows for insert to authenticated
  with check (app.owns_agenda(clinic_id, agenda_id));
create policy availability_windows_update_own on public.availability_windows for update to authenticated
  using (app.owns_agenda(clinic_id, agenda_id)) with check (app.owns_agenda(clinic_id, agenda_id));
create policy availability_windows_delete_own on public.availability_windows for delete to authenticated
  using (app.owns_agenda(clinic_id, agenda_id));

-- Agenda: só a dele (o gatilho deixa mudar só o intervalo).
create policy agendas_update_own on public.agendas for update to authenticated
  using (app.owns_agenda(clinic_id, id)) with check (app.owns_agenda(clinic_id, id));

-- Cadastro: só o dele (o gatilho barra o login e a desativação).
create policy professionals_update_own on public.professionals for update to authenticated
  using (id = app.own_professional_id(clinic_id)) with check (id = app.own_professional_id(clinic_id));

create policy professional_specialties_insert_own on public.professional_specialties for insert to authenticated
  with check (professional_id = app.own_professional_id(clinic_id));
create policy professional_specialties_update_own on public.professional_specialties for update to authenticated
  using (professional_id = app.own_professional_id(clinic_id)) with check (professional_id = app.own_professional_id(clinic_id));
create policy professional_specialties_delete_own on public.professional_specialties for delete to authenticated
  using (professional_id = app.own_professional_id(clinic_id));

create policy professional_insurance_plans_insert_own on public.professional_insurance_plans for insert to authenticated
  with check (professional_id = app.own_professional_id(clinic_id));
create policy professional_insurance_plans_delete_own on public.professional_insurance_plans for delete to authenticated
  using (professional_id = app.own_professional_id(clinic_id));

create policy professional_bot_info_insert_own on public.professional_bot_info for insert to authenticated
  with check (professional_id = app.own_professional_id(clinic_id));
create policy professional_bot_info_update_own on public.professional_bot_info for update to authenticated
  using (professional_id = app.own_professional_id(clinic_id)) with check (professional_id = app.own_professional_id(clinic_id));

-- O que é só do Administrador, mesmo na linha do próprio profissional.
create function app.guard_own_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.is_platform_staff() or (select auth.role()) is distinct from 'authenticated'
     or app.has_clinic_role(new.clinic_id, array['admin']::public.clinic_role[]) then
    return new;
  end if;
  -- Um "if" por tabela: o plpgsql não para no primeiro "and" e leria um campo que a outra tabela não tem.
  if tg_table_name = 'professionals' then
    if new.is_active is distinct from old.is_active or new.user_id is distinct from old.user_id then
      raise exception 'Só o Administrador desativa o profissional ou muda o login dele.'
        using errcode = '42501';
    end if;
  elsif tg_table_name = 'agendas' and pg_trigger_depth() = 1 then
    -- (Dentro de outro gatilho: o nome da agenda acompanha o do profissional, 06/nov/2026.)
    if new.is_active is distinct from old.is_active or new.name is distinct from old.name
       or new.kind is distinct from old.kind or new.professional_id is distinct from old.professional_id then
      raise exception 'Só o Administrador desativa ou muda a agenda; o profissional muda só o intervalo.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

create trigger professionals_guard_own_settings
  before update on public.professionals
  for each row execute function app.guard_own_settings();
create trigger agendas_guard_own_settings
  before update on public.agendas
  for each row execute function app.guard_own_settings();

-- Arquivo do preparo: o profissional com login envia; apaga só arquivo que não é de serviço de outro dono.
create policy service_files_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'service-files' and app.own_professional_id(app.storage_folder_clinic(name)) is not null);
create policy service_files_delete_own on storage.objects for delete to authenticated
  using (
    bucket_id = 'service-files'
    and app.own_professional_id(app.storage_folder_clinic(name)) is not null
    and not exists (
      select 1 from public.services s
       where s.preparation_file_path = name
         and s.professional_id is distinct from app.own_professional_id(app.storage_folder_clinic(name))
    )
  );
