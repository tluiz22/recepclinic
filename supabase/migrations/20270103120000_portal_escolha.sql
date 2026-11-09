-- F2a da recepção digital (08/nov/2026): o portal de agendamento mostra a clínica, os profissionais e os horários
-- livres (ainda sem marcar). Esta migração só prepara a leitura pública:
--   1. achar a clínica pelo apelido do endereço (agendar.recepclinic.com.br/{apelido});
--   2. apelidos que não podem existir, porque são passos do portal ou caminhos do sistema;
--   3. a foto do profissional lida pela credencial da clínica (só as dos profissionais, nunca as da equipe).

-- ---------------------------------------------------------------------------
-- 1. Clínica pelo apelido do portal (como resolve_booking_link_clinic): só a plataforma (service role) consulta,
--    e o resto da página usa a credencial limitada à clínica achada.
create function public.resolve_portal_clinic(p_slug text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.clinics where portal_slug = lower(btrim(p_slug))
$$;

revoke execute on function public.resolve_portal_clinic(text) from public, anon, authenticated, clinic_service;
grant execute on function public.resolve_portal_clinic(text) to service_role;

-- ---------------------------------------------------------------------------
-- 2a. Apelidos de profissional que são passos do portal ({clínica}/especialidade, {clínica}/medicos...): o
--     profissional com esse nome ganha o -2, como um nome repetido.
create function app.portal_reserved_professional_slug(p_slug text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_slug = any (array[
    'especialidade', 'medicos', 'recepcao', 'retorno', 'exames', 'exame', 'minhas-consultas', 's', 'link', 'entrar'
  ])
$$;

revoke execute on function app.portal_reserved_professional_slug(text) from public, anon;

create or replace function app.professional_portal_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_slug text;
  v_n integer := 1;
begin
  if tg_op = 'UPDATE' then
    if new.portal_slug is distinct from old.portal_slug then
      raise exception 'O endereço do profissional no portal não muda depois de criado.' using errcode = '42501';
    end if;
    return new;
  end if;
  v_base := app.portal_slug_of(new.display_name);
  v_slug := v_base;
  while app.portal_reserved_professional_slug(v_slug)
    or exists (select 1 from public.professionals where clinic_id = new.clinic_id and portal_slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := rtrim(left(v_base, 56), '-') || '-' || v_n;
  end loop;
  -- Dois cadastros ao mesmo tempo com o mesmo nome: a chave única recusa o segundo, que tenta de novo.
  new.portal_slug := v_slug;
  return new;
end
$$;

-- Algum de hoje com um apelido reservado (só se o nome do cadastro for exatamente um passo): ganha o número.
do $$
declare
  v_row record;
  v_slug text;
  v_n integer;
begin
  for v_row in select id, clinic_id, portal_slug from public.professionals where app.portal_reserved_professional_slug(portal_slug) loop
    v_n := 1;
    v_slug := v_row.portal_slug;
    while app.portal_reserved_professional_slug(v_slug)
      or exists (select 1 from public.professionals where clinic_id = v_row.clinic_id and portal_slug = v_slug) loop
      v_n := v_n + 1;
      v_slug := v_row.portal_slug || '-' || v_n;
    end loop;
    alter table public.professionals disable trigger professionals_portal_slug;
    update public.professionals set portal_slug = v_slug where id = v_row.id;
    alter table public.professionals enable trigger professionals_portal_slug;
  end loop;
end
$$;

-- 2b. Apelidos de clínica que são caminhos do sistema ou do portal.
create or replace function public.set_clinic_portal_slug(p_clinic_id uuid, p_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text := nullif(btrim(lower(coalesce(p_slug, ''))), '');
begin
  if not (app.is_platform_staff() or (select auth.role()) = 'service_role') then
    raise exception 'Só o Administrador do sistema muda o endereço da clínica no portal.' using errcode = '42501';
  end if;
  if v_slug is not null and not (v_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(v_slug) between 3 and 60) then
    raise exception 'Endereço inválido: use de 3 a 60 letras minúsculas, números e hífen.' using errcode = '22023';
  end if;
  if v_slug = any (array[
    'admin', 'api', 'app', 'portal', 'agendar', 'agendar-teste', 'preparo', 'orientacoes', 'formulario', 'guia',
    'importar', 'ajuda', 'teste', 'www', 'suporte', 'recepclinic'
  ]) then
    raise exception 'Esse endereço é reservado pelo sistema. Escolha outro.' using errcode = '22023', hint = 'portal_slug_reserved';
  end if;
  if v_slug is not null and exists (select 1 from public.clinics where portal_slug = v_slug and id <> p_clinic_id) then
    raise exception 'Esse endereço já é de outra clínica.' using errcode = '23505', hint = 'portal_slug_taken';
  end if;
  update public.clinics set portal_slug = v_slug, updated_at = now() where id = p_clinic_id;
  if not found then
    raise exception 'Clínica não encontrada.' using errcode = 'P0002';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Foto do profissional no portal (RD13): a credencial da clínica lê as fotos dos profissionais dela
--    ("<clínica>/profissionais/<id>/..."). As da equipe ("<clínica>/equipe/...") continuam só para quem entra no painel.
create policy profile_photos_select_service on storage.objects
  for select to clinic_service
  using (
    bucket_id = 'profile-photos'
    and app.storage_folder_clinic(name) = app.service_clinic_id()
    and split_part(name, '/', 2) = 'profissionais'
  );
