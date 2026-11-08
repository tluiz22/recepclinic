-- ---------------------------------------------------------------------------
-- Perfil, prazo para oferecer horários e idade limite por profissional
-- (cliente, 08/nov/2026; item 4 da validação)
-- ---------------------------------------------------------------------------
-- Saem de Configurações › Clínica e passam a ser de cada profissional (e da
-- Equipe). Ficam na agenda: uma por profissional e no máximo uma da Equipe, e o
-- bot procura horário livre agenda a agenda. Cada agenda começa com os valores
-- que a clínica tinha (nada muda no dia da troca).
--
-- O perfil da clínica (clinic_settings.profile) passa a ser calculado: as
-- palavras das telas da clínica inteira saem dos perfis das agendas ativas
-- (todas iguais: aquele; diferentes: "Mista", paciente/responsável). Sem
-- agenda ativa, fica como estava (clínica nova: o do cadastro da clínica).
--
-- O profissional com login também muda os do próprio cadastro (como o
-- intervalo; app.guard_own_settings só barra nome, tipo, dono e desativação).
--
-- clinic_settings.booking_horizon_days e consultation_age_limit_years ficam sem
-- uso (o código deixa de ler); saem numa migração de limpeza depois da produção.
--
-- Reversão: drop dos 2 gatilhos e das 2 funções; drop das 3 colunas de agendas.

alter table public.agendas
  add column profile public.clinic_profile not null default 'mixed',
  add column booking_horizon_days integer not null default 60 check (booking_horizon_days between 7 and 365),
  add column consultation_age_limit_years integer check (consultation_age_limit_years > 0);

comment on column public.agendas.profile is 'Perfil do profissional (ou da Equipe): palavras do bot e do link de agendar.';
comment on column public.agendas.booking_horizon_days is 'Prazo para oferecer horários, em dias (bot e link de agendar).';
comment on column public.agendas.consultation_age_limit_years is 'Idade limite da Consulta (null: sem limite).';

update public.agendas a
   set profile = s.profile,
       booking_horizon_days = s.booking_horizon_days,
       -- A Equipe só faz exame: sem idade limite da Consulta.
       consultation_age_limit_years = case when a.kind = 'professional' then s.consultation_age_limit_years end
  from public.clinic_settings s
 where s.clinic_id = a.clinic_id;

-- Perfil da clínica pelos perfis das agendas ativas.
create function app.refresh_clinic_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid := coalesce(new.clinic_id, old.clinic_id);
  v_profiles public.clinic_profile[];
  v_profile public.clinic_profile;
begin
  select array_agg(distinct a.profile) into v_profiles
    from public.agendas a
   where a.clinic_id = v_clinic and a.is_active;
  if v_profiles is null or cardinality(v_profiles) = 0 then
    return null;
  end if;
  v_profile := case when cardinality(v_profiles) = 1 then v_profiles[1] else 'mixed'::public.clinic_profile end;
  update public.clinic_settings set profile = v_profile where clinic_id = v_clinic and profile is distinct from v_profile;
  return null;
end
$$;

create trigger agendas_refresh_clinic_profile
  after insert or delete or update of profile, is_active on public.agendas
  for each row execute function app.refresh_clinic_profile();


-- Agenda nova (do profissional ou a da Equipe, que nasce com o item "Exames") começa com o perfil da clínica (o
-- calculado; clínica nova, o do cadastro dela); prazo de 60 dias e sem idade limite, até a clínica ajustar.
create function app.agenda_starts_with_clinic_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select s.profile into new.profile from public.clinic_settings s where s.clinic_id = new.clinic_id;
  new.profile := coalesce(new.profile, 'mixed');
  return new;
end
$$;

create trigger agendas_start_with_clinic_profile
  before insert on public.agendas
  for each row execute function app.agenda_starts_with_clinic_profile();
