-- Busca por nome parecido (C18; cliente, 03/nov/2026): a secretária buscou
-- "Aurora oliveira Costa" e não achou "Aurora Oliveira da Costa". A busca por
-- nome de pacientes e responsáveis passa a:
--   * ignorar acentos, maiúsculas e sinais ("D'Ávila" = "d avila");
--   * ignorar as partes pequenas do nome: de, da, do, das, dos, e, d, jr,
--     junior, filho, filha, neto, neta, sobrinho, sobrinha;
--   * achar cada palavra digitada em qualquer palavra do nome, em qualquer
--     ordem, pelo começo dela ("Aur Cos") ou com letra errada: 1 erro em
--     palavras de 4 e 5 letras, 2 a partir de 6 ("Aurora Olivera"); duas
--     letras vizinhas trocadas contam como 1 erro ("Sliva" = "Silva");
--   * continuar achando um trecho do nome, como antes ("liveira").
-- Os mais parecidos vêm primeiro. Telefone e data de nascimento seguem como
-- estavam (no código). As funções rodam com as permissões de quem chama: o
-- RLS limita à clínica que a pessoa pode ver.

create extension if not exists fuzzystrmatch with schema extensions;

/** Palavras do nome para a busca: sem acento, minúsculas, sem sinais e sem as partes pequenas. */
create function app.search_name_words(p_text text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(t.w order by t.ord), '{}')
  from unnest(
    regexp_split_to_array(regexp_replace(app.normalize_search_text(coalesce(p_text, '')), '[^a-z0-9]+', ' ', 'g'), ' ')
  ) with ordinality as t(w, ord)
  where t.w <> ''
    and t.w not in ('de', 'da', 'do', 'das', 'dos', 'e', 'd', 'jr', 'junior', 'filho', 'filha', 'neto', 'neta', 'sobrinho', 'sobrinha')
$$;

/** Erros entre a palavra digitada e uma palavra do nome (inteira ou o começo dela); duas vizinhas trocadas = 1. */
create function app.search_typo_distance(p_typed text, p_word text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from generate_series(1, length(p_typed) - 1) as i
      where substr(p_typed, i, 1) <> substr(p_typed, i + 1, 1)
        and overlay(p_typed placing substr(p_typed, i + 1, 1) || substr(p_typed, i, 1) from i for 2) in (p_word, left(p_word, length(p_typed)))
    ) then 1
    else least(
      extensions.levenshtein(p_typed, p_word),
      extensions.levenshtein(p_typed, left(p_word, length(p_typed))),
      extensions.levenshtein(p_typed, left(p_word, length(p_typed) + 1))
    )
  end
$$;

/**
 * Nota de uma palavra digitada contra uma palavra do nome: 30 igual, 20 começo
 * da palavra, 9 ou 8 com 1 ou 2 erros (só com 4 letras ou mais), 0 não combina.
 */
create function app.search_word_score(p_typed text, p_word text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_typed = p_word then 30
    when left(p_word, length(p_typed)) = p_typed then 20
    when length(p_typed) < 4 then 0
    else (
      select case when d <= case when length(p_typed) >= 6 then 2 else 1 end then 10 - d else 0 end
      from (select app.search_typo_distance(p_typed, p_word) as d) as typo
    )
  end
$$;

/**
 * Nota do nome para a busca: cada palavra digitada precisa combinar com
 * alguma palavra do nome (soma das melhores notas); sem isso, o trecho do nome
 * inteiro (como antes) vale 1. Não combina: nulo.
 */
create function app.search_name_score(p_query text, p_name text)
returns integer
language sql
immutable
set search_path = ''
as $$
  with typed as (
    select w from unnest(app.search_name_words(p_query)) as w
  ),
  words as (
    select app.search_name_words(p_name) as list
  ),
  best as (
    select t.w, coalesce((select max(app.search_word_score(t.w, n)) from unnest((select list from words)) as n), 0) as score
    from typed t
  )
  select case
    -- Só partes pequenas ("de"): o trecho, como antes.
    when not exists (select 1 from typed) then
      case when position(app.normalize_search_text(coalesce(p_query, '')) in app.normalize_search_text(coalesce(p_name, ''))) > 0 then 1 end
    when (select min(score) from best) > 0 then (select sum(score)::integer from best)
    when position(
      array_to_string(app.search_name_words(p_query), ' ') in array_to_string((select list from words), ' ')
    ) > 0 then 1
    else null
  end
$$;

/** Pacientes da clínica com o nome parecido, os mais parecidos primeiro (até p_limit). */
create function public.search_patient_ids(p_clinic_id uuid, p_query text, p_include_inactive boolean default false, p_limit integer default 200)
returns table (id uuid, score integer)
language sql
stable
set search_path = ''
as $$
  select s.id, s.score
  from (
    select p.id, p.full_name, app.search_name_score(p_query, p.full_name) as score
    from public.patients p
    where p.clinic_id = p_clinic_id and (p_include_inactive or p.is_active)
  ) s
  where s.score is not null
  order by s.score desc, s.full_name, s.id
  limit least(greatest(coalesce(p_limit, 200), 1), 500)
$$;

/** Responsáveis (contatos) da clínica com o nome parecido, os mais parecidos primeiro (até p_limit). */
create function public.search_contact_ids(p_clinic_id uuid, p_query text, p_include_inactive boolean default false, p_limit integer default 200)
returns table (id uuid, score integer)
language sql
stable
set search_path = ''
as $$
  select s.id, s.score
  from (
    select c.id, c.full_name, app.search_name_score(p_query, c.full_name) as score
    from public.contacts c
    where c.clinic_id = p_clinic_id and (p_include_inactive or c.is_active)
  ) s
  where s.score is not null
  order by s.score desc, s.full_name, s.id
  limit least(greatest(coalesce(p_limit, 200), 1), 500)
$$;

grant execute on function app.search_name_words(text) to authenticated, clinic_service;
grant execute on function app.search_typo_distance(text, text) to authenticated, clinic_service;
grant execute on function app.search_word_score(text, text) to authenticated, clinic_service;
grant execute on function app.search_name_score(text, text) to authenticated, clinic_service;
grant execute on function public.search_patient_ids(uuid, text, boolean, integer) to authenticated, clinic_service;
grant execute on function public.search_contact_ids(uuid, text, boolean, integer) to authenticated, clinic_service;
revoke execute on function public.search_patient_ids(uuid, text, boolean, integer) from anon, public;
revoke execute on function public.search_contact_ids(uuid, text, boolean, integer) from anon, public;
