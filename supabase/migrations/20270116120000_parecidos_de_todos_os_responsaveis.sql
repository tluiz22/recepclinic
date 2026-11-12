-- Fichas parecidas pelos pacientes ligados ao número (D14; /code-review da frente; migração aprovada pelo cliente em
-- 11/nov/2026). Com vários responsáveis, o número que não é o principal também precisa achar a ficha parecida no
-- cadastro (senão nasce uma ficha repetida). Só troca a função; nenhuma tabela ou dado muda.
--
-- Reversão: recriar a função como em 20261206120000 (`p.contact_id = p_contact_id`).

create or replace function public.similar_patient_ids(p_clinic_id uuid, p_name text, p_contact_id uuid default null)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select p.id
  from public.patients p
  where p.clinic_id = p_clinic_id
    and p.is_active
    and (case
           when p_contact_id is null then p.is_contact_self
           else exists (
             select 1 from public.patient_contacts pc
              where pc.clinic_id = p_clinic_id and pc.patient_id = p.id and pc.contact_id = p_contact_id
           )
         end)
    and app.names_look_alike(p_name, p.full_name)
  order by p.full_name, p.id
  limit 10
$$;
