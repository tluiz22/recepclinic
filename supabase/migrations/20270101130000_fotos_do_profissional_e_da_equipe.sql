-- ---------------------------------------------------------------------------
-- Fotos do profissional e das pessoas da Equipe (cliente, 08/nov/2026)
-- ---------------------------------------------------------------------------
-- Nesta etapa só o cadastro: a foto é enviada no cadastro do profissional e no
-- da pessoa da Equipe e aparece ali. Mostrar em outras telas fica para depois.
--
-- Arquivos no bucket privado "profile-photos" (PNG, JPG ou WebP até 4 MB):
--   <clinic_id>/profissionais/<professional_id>/<momento>.<ext>
--   <clinic_id>/equipe/<user_id>/<momento>.<ext>
-- Quem lê: qualquer pessoa da clínica (link temporário). Quem envia e remove:
-- o Administrador; a foto do próprio cadastro, também o profissional com login
-- (como o resto do cadastro dele, S1).
--
-- Reversão: drop das políticas e da função; drop do bucket (vazio); drop das colunas.

alter table public.professionals add column photo_path text check (length(photo_path) <= 300);
alter table public.clinic_members add column photo_path text check (length(photo_path) <= 300);

comment on column public.professionals.photo_path is 'Foto no bucket profile-photos (null: sem foto).';
comment on column public.clinic_members.photo_path is 'Foto no bucket profile-photos (null: sem foto).';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 4194304, array['image/png', 'image/jpeg', 'image/webp']);

-- Pode enviar ou remover a foto deste caminho.
create function app.can_edit_profile_photo(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_folder text := split_part(p_name, '/', 1);
  v_kind text := split_part(p_name, '/', 2);
  v_owner text := split_part(p_name, '/', 3);
  v_clinic uuid;
begin
  if v_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or v_kind not in ('profissionais', 'equipe') then
    return false;
  end if;
  v_clinic := v_folder::uuid;
  if app.has_clinic_role(v_clinic, array['admin']::public.clinic_role[]) then
    return true;
  end if;
  return v_kind = 'profissionais' and v_owner = app.own_professional_id(v_clinic)::text;
end;
$$;

-- Pode ver: qualquer pessoa da clínica.
create function app.can_read_profile_photo(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_folder text := split_part(p_name, '/', 1);
begin
  if v_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return app.is_clinic_member(v_folder::uuid);
end;
$$;

grant execute on function app.can_edit_profile_photo(text) to authenticated;
grant execute on function app.can_read_profile_photo(text) to authenticated;

create policy profile_photos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'profile-photos' and app.can_read_profile_photo(name));

create policy profile_photos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'profile-photos' and app.can_edit_profile_photo(name));

create policy profile_photos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'profile-photos' and app.can_edit_profile_photo(name))
  with check (bucket_id = 'profile-photos' and app.can_edit_profile_photo(name));

create policy profile_photos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'profile-photos' and app.can_edit_profile_photo(name));
