-- C7 Arquivo no preparo do exame (cliente, 28/out/2026): o exame pode ter um
-- arquivo com as orientações (PDF, JPG ou PNG, até 10 MB), enviado pelo
-- WhatsApp depois da mensagem do preparo. Com arquivo, o texto do preparo é
-- obrigatório (é a mensagem que vem antes).
--
-- O arquivo vai do aparelho direto ao armazenamento privado
-- "<clínica>/preparo/<id>.<ext>" (link de envio de uso único, como os
-- documentos do paciente). A equipe da clínica vê; só o Administrador grava e
-- apaga; o envio pelo WhatsApp lê com a credencial da clínica.
--
-- Reversão: alter table public.services drop constraint
-- services_preparation_file_needs_text, drop das colunas preparation_file_*;
-- drop das políticas service_files_* de storage.objects; esvaziar e apagar o
-- bucket service-files.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('service-files', 'service-files', false, 10485760, array['image/jpeg', 'image/png', 'application/pdf']);

alter table public.services
  add column preparation_file_path text,
  add column preparation_file_name text check (preparation_file_name is null or char_length(preparation_file_name) between 1 and 200),
  add column preparation_file_type text check (preparation_file_type is null or preparation_file_type in ('image/jpeg', 'image/png', 'application/pdf')),
  add column preparation_file_size integer check (preparation_file_size is null or (preparation_file_size > 0 and preparation_file_size <= 10485760));

-- Arquivo: os quatro dados juntos, dentro da pasta da clínica, e só com o texto do preparo.
alter table public.services add constraint services_preparation_file_complete check (
  (preparation_file_path is null and preparation_file_name is null and preparation_file_type is null and preparation_file_size is null)
  or (preparation_file_path is not null and preparation_file_name is not null and preparation_file_type is not null and preparation_file_size is not null
      and preparation_file_path like clinic_id::text || '/preparo/%')
);
alter table public.services add constraint services_preparation_file_needs_text check (
  preparation_file_path is null or coalesce(btrim(preparation_instructions), '') <> ''
);

create policy service_files_select on storage.objects
  for select to authenticated
  using (bucket_id = 'service-files' and app.is_clinic_member(app.storage_folder_clinic(name)));
create policy service_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'service-files' and app.has_clinic_role(app.storage_folder_clinic(name), array['admin']::public.clinic_role[]));
create policy service_files_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'service-files' and app.has_clinic_role(app.storage_folder_clinic(name), array['admin']::public.clinic_role[]));
-- O envio pelo WhatsApp (credencial da clínica) lê só os arquivos da própria clínica.
create policy service_files_select_service on storage.objects
  for select to clinic_service
  using (bucket_id = 'service-files' and app.storage_folder_clinic(name) = app.service_clinic_id());

-- A credencial da clínica (`clinic_service`) ainda não lia o armazenamento: só a
-- leitura, e as políticas acima limitam ao bucket do preparo da própria clínica.
grant usage on schema storage to clinic_service;
grant select on storage.objects to clinic_service;
grant select on storage.buckets to clinic_service;
grant execute on function app.storage_folder_clinic(text) to clinic_service;
