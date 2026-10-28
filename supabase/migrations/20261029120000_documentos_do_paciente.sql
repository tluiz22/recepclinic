-- CRM P1 (aprovada pelo cliente em 28/out/2026): documentos do paciente
-- (foto ou PDF da carteirinha, identidade, pedido de exame ou médico) para a
-- secretária encaminhar ao plano de saúde (Q18 a Q24, seção 19 do plano de
-- Relacionamento).
--
-- Q19: a equipe toda vê; Administrador e Recepção anexam e apagam; Suporte com
-- auditoria; o bot não tem acesso. Q23: JPG, PNG, HEIC e PDF até 10 MB, direto
-- do aparelho ao armazenamento privado "<clínica>/<paciente>/<documento>.<ext>".
-- A anonimização apaga as linhas (gatilho abaixo) e o código apaga os arquivos.
--
-- Reversão: drop table public.patient_documents; drop das políticas
-- patient_documents_files_* de storage.objects; drop function
-- app.patient_document_rules(), app.drop_documents_on_anonymize() e
-- app.storage_folder_clinic(text); esvaziar e apagar o bucket patient-documents.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('patient-documents', 'patient-documents', false, 10485760,
        array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/pdf']);

create table public.patient_documents (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null,
  kind text not null check (kind in ('insurance_card', 'identity', 'exam_request', 'medical_request', 'other')),
  description text check (char_length(description) <= 120),
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (clinic_id, patient_id) references public.patients (clinic_id, id) on delete cascade
);

create index patient_documents_patient_idx on public.patient_documents (clinic_id, patient_id, created_at desc);

-- Clínica da primeira pasta do caminho ("<clinic_id>/…"); null se não for um id.
create function app.storage_folder_clinic(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_folder text := split_part(p_name, '/', 1);
begin
  if v_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return v_folder::uuid;
end
$$;

revoke execute on function app.storage_folder_clinic(text) from public, anon;
grant execute on function app.storage_folder_clinic(text) to authenticated;

-- Na gravação: autor e hora de quem grava; o caminho é o da clínica e do
-- paciente; o arquivo já está no armazenamento, e o tipo e o tamanho vêm de lá.
create function app.patient_document_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_metadata jsonb;
begin
  new.created_by := auth.uid();
  new.created_at := now();
  if new.storage_path not like new.clinic_id::text || '/' || new.patient_id::text || '/%' then
    raise exception 'documento fora da pasta do paciente' using errcode = '23514';
  end if;
  select o.metadata into v_metadata
    from storage.objects o
   where o.bucket_id = 'patient-documents' and o.name = new.storage_path;
  if v_metadata is null then
    raise exception 'arquivo do documento não encontrado' using errcode = '23514';
  end if;
  new.mime_type := coalesce(v_metadata ->> 'mimetype', new.mime_type);
  new.size_bytes := coalesce((v_metadata ->> 'size')::integer, new.size_bytes);
  return new;
end
$$;

create trigger patient_documents_rules
  before insert on public.patient_documents
  for each row execute function app.patient_document_rules();

alter table public.patient_documents enable row level security;

create policy patient_documents_select on public.patient_documents
  for select to authenticated using (app.is_clinic_member(clinic_id));
create policy patient_documents_insert on public.patient_documents
  for insert to authenticated with check (app.has_clinic_role(clinic_id, array['admin', 'reception']::public.clinic_role[]));
create policy patient_documents_delete on public.patient_documents
  for delete to authenticated using (app.has_clinic_role(clinic_id, array['admin', 'reception']::public.clinic_role[]));

revoke all on public.patient_documents from anon;
revoke update, truncate on public.patient_documents from authenticated;

create trigger patient_documents_audit_platform_staff
  after insert or delete on public.patient_documents
  for each row execute function app.audit_platform_staff_write();

-- As mesmas regras nos arquivos, pela pasta da clínica.
create policy patient_documents_files_select on storage.objects
  for select to authenticated
  using (bucket_id = 'patient-documents' and app.is_clinic_member(app.storage_folder_clinic(name)));
create policy patient_documents_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'patient-documents' and app.has_clinic_role(app.storage_folder_clinic(name), array['admin', 'reception']::public.clinic_role[]));
create policy patient_documents_files_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'patient-documents' and app.has_clinic_role(app.storage_folder_clinic(name), array['admin', 'reception']::public.clinic_role[]));

-- Anonimização: os documentos do paciente saem junto (o código apaga os
-- arquivos pelo armazenamento, com os caminhos lidos antes).
create function app.drop_documents_on_anonymize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.patient_documents where clinic_id = new.clinic_id and patient_id = new.id;
  return null;
end
$$;

create trigger patients_drop_documents
  after update of anonymized_at on public.patients
  for each row when (old.anonymized_at is null and new.anonymized_at is not null)
  execute function app.drop_documents_on_anonymize();

revoke execute on function app.patient_document_rules() from public, anon, authenticated, clinic_service;
revoke execute on function app.drop_documents_on_anonymize() from public, anon, authenticated, clinic_service;
