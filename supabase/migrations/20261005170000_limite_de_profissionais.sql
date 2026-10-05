-- Limite de profissionais ativos por clínica (D11, cliente, 05/out/2026):
-- definido pelo Administrador do sistema; clínica nova começa com 1; desativar
-- libera a vaga; baixar o limite não desativa ninguém.

alter table public.clinics
  add column max_professionals integer not null default 1 check (max_professionals > 0);

-- As clínicas que já existem ficam com o que têm.
update public.clinics c
  set max_professionals = greatest(1, (select count(*) from public.professionals p where p.clinic_id = c.id and p.is_active));

-- Só o Suporte (ou a plataforma) muda o limite; o Administrador da clínica
-- continua editando o nome.
create function app.guard_professional_limit_change()
returns trigger
language plpgsql
-- Dono do banco: a credencial da clínica não lê o esquema auth (auth.role()).
security definer
set search_path = ''
as $$
begin
  if new.max_professionals is distinct from old.max_professionals
     and not (app.is_platform_staff() or (select auth.role()) = 'service_role') then
    raise exception 'Só o Suporte muda o limite de profissionais.' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger clinics_guard_professional_limit before update of max_professionals on public.clinics
  for each row execute function app.guard_professional_limit_change();

-- Trava: cadastrar ou reativar profissional além do limite. A linha da
-- clínica fica presa durante a conta, para dois cadastros ao mesmo tempo não
-- passarem juntos.
create function app.check_professional_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer;
  v_active integer;
begin
  if not new.is_active or (tg_op = 'UPDATE' and old.is_active) then
    return new;
  end if;
  select max_professionals into v_max from public.clinics where id = new.clinic_id for update;
  select count(*) into v_active from public.professionals
    where clinic_id = new.clinic_id and is_active and id <> new.id;
  if v_active >= v_max then
    raise exception 'Limite de % profissional(is) ativo(s) da clínica atingido.', v_max
      using errcode = 'P0001', hint = 'professional_limit';
  end if;
  return new;
end
$$;

create trigger professionals_limit before insert or update of is_active on public.professionals
  for each row execute function app.check_professional_limit();

-- Suporte: grava o limite (o registro de alterações do Suporte guarda quem e quando).
create function public.set_clinic_professional_limit(p_clinic_id uuid, p_limit integer)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not app.is_platform_staff() then
    raise exception 'Só o Suporte muda o limite de profissionais.' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 then
    raise exception 'O limite precisa ser de pelo menos 1 profissional.' using errcode = '22023';
  end if;
  update public.clinics set max_professionals = p_limit where id = p_clinic_id;
  if not found then
    raise exception 'Clínica não encontrada.' using errcode = 'P0002';
  end if;
end
$$;

revoke execute on function public.set_clinic_professional_limit(uuid, integer) from public, anon, clinic_service;
grant execute on function public.set_clinic_professional_limit(uuid, integer) to authenticated;
