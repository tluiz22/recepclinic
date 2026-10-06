-- F5.1 — Marca da clínica nas páginas públicas (cliente, 05/out/2026):
--   - site da clínica: o botão "Voltar para o site" só aparece quando existe;
--   - logo no Storage, bucket público "clinic-logos", um arquivo por clínica em
--     "<clinic_id>/…"; PNG, JPG ou WebP até 1 MB. Quem edita os dados da
--     clínica (Administrador e Suporte) envia e remove; a leitura é pelo
--     endereço público, usado em /agendar e /preparo.
alter table public.clinic_settings
  add column website_url text
    check (website_url ~ '^https?://[^[:space:]]+$' and length(website_url) <= 300);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clinic-logos', 'clinic-logos', true, 1048576, array['image/png', 'image/jpeg', 'image/webp']);

-- Pode mexer no logo da pasta da clínica (primeiro nível do caminho).
create function app.can_edit_clinic_logo(p_name text)
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
  return app.has_clinic_role(v_folder::uuid, array['admin']::public.clinic_role[]);
end;
$$;

grant execute on function app.can_edit_clinic_logo(text) to authenticated;

create policy clinic_logos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'clinic-logos' and app.can_edit_clinic_logo(name));

create policy clinic_logos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'clinic-logos' and app.can_edit_clinic_logo(name));

create policy clinic_logos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'clinic-logos' and app.can_edit_clinic_logo(name))
  with check (bucket_id = 'clinic-logos' and app.can_edit_clinic_logo(name));

create policy clinic_logos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'clinic-logos' and app.can_edit_clinic_logo(name));
