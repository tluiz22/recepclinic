-- Redesign R8 (cliente, 17/out/2026): filtro "Falta CPF" em Financeiro ›
-- Quem paga. Os pacientes cujo responsável financeiro (quem paga, em nome de
-- quem sai a nota) ainda não tem CPF, pela mesma regra de resolvePayer
-- (src/lib/data/finance.ts):
--   other   → nunca falta (o CPF é obrigatório nessa opção);
--   patient → o CPF do paciente (patient_finance), exceto quem fala por si;
--   contact → o CPF do contato (contact_finance); é o padrão, sem linha no
--             módulo, e também o "patient" de quem fala por si.
-- Devolve linhas de patients para a tela embutir o contato, buscar, ordenar e
-- paginar como na lista de sempre. Só leitura e com as permissões de quem
-- chama (RLS das tabelas do módulo financeiro).

create function public.finance_patients_missing_payer_cpf(p_clinic_id uuid)
returns setof public.patients
language sql
stable
security invoker
set search_path = ''
as $$
  select p.*
  from public.patients p
  left join public.patient_finance pf on pf.patient_id = p.id and pf.clinic_id = p.clinic_id
  left join public.contact_finance cf on cf.contact_id = p.contact_id and cf.clinic_id = p.clinic_id
  where p.clinic_id = p_clinic_id
    and case
      when pf.payer = 'other' then false
      when pf.payer = 'patient' and not p.is_contact_self then pf.cpf is null
      else cf.cpf is null
    end
$$;

revoke execute on function public.finance_patients_missing_payer_cpf(uuid) from public, anon, clinic_service;
grant execute on function public.finance_patients_missing_payer_cpf(uuid) to authenticated;
