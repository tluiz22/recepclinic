-- ME (cliente, 07/nov/2026; docs/arquivo/modulos/planejamento-multiprofissional.md, seção 2):
-- especialidades do profissional.
--
--   1. a lista é a global do Suporte (kb_specialties, decisão M1): a equipe
--      das clínicas e o bot passam a ler (só o Suporte grava, como antes);
--   2. professional_specialties liga o profissional a uma ou mais (N:N); a
--      posição 0 é a principal;
--   3. set_professional_specialties grava a lista inteira de uma vez e exige
--      pelo menos uma (M6: todas as profissões). Profissional já cadastrado
--      sem nenhuma fica pendente, sem bloquear agenda nem bot (M2);
--   4. o texto livre de hoje (professionals.specialty) é ligado à especialidade
--      de mesmo nome ou sinônimo; o que não casar fica pendente. A coluna fica
--      só para leitura do histórico (o app não grava mais nela).

-- 1. Leitura da lista global
create policy kb_specialties_read on public.kb_specialties for select to authenticated using (true);
grant select on public.kb_specialties to clinic_service;
create policy kb_specialties_read_service on public.kb_specialties for select to clinic_service using (true);

-- 2. Ligação
create table public.professional_specialties (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  professional_id uuid not null,
  -- Especialidade em uso não é apagada (o Suporte desativa).
  specialty_id uuid not null references public.kb_specialties (id),
  position smallint not null check (position between 0 and 19),
  created_at timestamptz not null default now(),
  primary key (professional_id, specialty_id),
  unique (professional_id, position),
  foreign key (clinic_id, professional_id) references public.professionals (clinic_id, id) on delete cascade
);

create index professional_specialties_clinic_idx on public.professional_specialties (clinic_id);
create index professional_specialties_specialty_idx on public.professional_specialties (specialty_id);

select app.enable_clinic_config_rls('public.professional_specialties');
revoke all on public.professional_specialties from anon;
revoke insert, update, delete, truncate on public.professional_specialties from clinic_service;

-- Clínica suspensa (F12.3b): o login dela não grava.
create trigger professional_specialties_guard_suspended
  before insert or update or delete on public.professional_specialties
  for each row execute function app.guard_suspended_clinic_write();

-- 3. Gravação da lista inteira (com o RLS de quem chama: só o Administrador)
create function public.set_professional_specialties(p_clinic_id uuid, p_professional_id uuid, p_specialty_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  -- Sem repetição, na ordem recebida (a primeira é a principal).
  select coalesce(array_agg(id order by ord), '{}') into v_ids
    from (select distinct on (id) id, ord from unnest(p_specialty_ids) with ordinality as t (id, ord) where id is not null order by id, ord) s;
  if cardinality(v_ids) = 0 then
    raise exception 'Escolha ao menos uma especialidade' using errcode = 'check_violation';
  end if;
  if cardinality(v_ids) > 20 then
    raise exception 'No máximo 20 especialidades' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.professionals where clinic_id = p_clinic_id and id = p_professional_id) then
    raise exception 'Profissional não encontrado' using errcode = 'no_data_found';
  end if;
  -- Desativada pelo Suporte: só fica se já estava ligada.
  if exists (
    select 1 from unnest(v_ids) as t (id)
     where not exists (select 1 from public.kb_specialties s where s.id = t.id and s.is_active)
       and not exists (select 1 from public.professional_specialties ps where ps.professional_id = p_professional_id and ps.specialty_id = t.id)
  ) then
    raise exception 'Especialidade inexistente ou desativada' using errcode = 'check_violation';
  end if;

  delete from public.professional_specialties where clinic_id = p_clinic_id and professional_id = p_professional_id;
  insert into public.professional_specialties (clinic_id, professional_id, specialty_id, position)
    select p_clinic_id, p_professional_id, id, (ord - 1)::smallint from unnest(v_ids) with ordinality as t (id, ord);
end
$$;

revoke execute on function public.set_professional_specialties(uuid, uuid, uuid[]) from public, anon, clinic_service;
grant execute on function public.set_professional_specialties(uuid, uuid, uuid[]) to authenticated;

-- 4. Texto livre de hoje → lista (texto inteiro; senão, as partes separadas por vírgula, ponto e vírgula ou barra)
create function app.specialty_key(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$ select lower(extensions.unaccent('extensions.unaccent', trim(p_text))) $$;

create function app.link_legacy_specialties()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  with names as (
    select s.id, app.specialty_key(s.name) as k from public.kb_specialties s
    union
    select s.id, app.specialty_key(t) from public.kb_specialties s cross join lateral unnest(s.terms) as t
  ),
  parts as (
    select p.clinic_id, p.id as professional_id, 0 as ord, app.specialty_key(p.specialty) as k
      from public.professionals p where coalesce(trim(p.specialty), '') <> ''
    union all
    select p.clinic_id, p.id, x.ord, app.specialty_key(x.part)
      from public.professionals p
      cross join lateral unnest(regexp_split_to_array(p.specialty, '\s*[,;/]\s*')) with ordinality as x (part, ord)
     where p.specialty ~ '[,;/]'
  ),
  matched as (
    select distinct on (pa.professional_id, n.id) pa.clinic_id, pa.professional_id, n.id as specialty_id, pa.ord
      from parts pa join names n on n.k = pa.k
     where pa.k <> ''
       and not exists (select 1 from public.professional_specialties ps where ps.professional_id = pa.professional_id)
     order by pa.professional_id, n.id, pa.ord
  )
  insert into public.professional_specialties (clinic_id, professional_id, specialty_id, position)
    select clinic_id, professional_id, specialty_id,
           (row_number() over (partition by professional_id order by ord, specialty_id) - 1)::smallint
      from matched;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke execute on function app.link_legacy_specialties() from public, anon, authenticated, clinic_service;
revoke execute on function app.specialty_key(text) from public, anon;

select app.link_legacy_specialties();
