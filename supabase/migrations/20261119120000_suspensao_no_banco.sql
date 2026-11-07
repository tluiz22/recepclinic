-- F12.3b — Faturamento do SaaS: o banco recusa as gravações operacionais da
-- clínica suspensa.
--
-- Plano em docs/planejamento-faturamento-saas.md, decisão 11.3 (cliente,
-- 28/out/2026): a F12.3 bloqueou no código (painel, páginas públicas, bot e
-- envios); com o login, porém, a pessoa poderia chamar a API do banco direto.
-- Aqui, toda gravação (inclusão, alteração ou exclusão) feita por um login da
-- clínica que não seja o Suporte, numa tabela da clínica suspensa, é recusada.
--   - Seguem livres: o Suporte; a credencial da clínica (`clinic_service`: bot,
--     páginas públicas e rotinas, já calados no código; a mensagem do paciente
--     continua indo para o histórico) e a service role (sem usuário);
--   - seguem livres as tabelas da tela Assinatura e do próprio controle
--     (billing_*, clinic_suspensions), os registros do sistema e do Suporte e
--     as notificações do aparelho (push_subscriptions);
--   - tabela nova com clinic_id ganha o gatilho na migração que a cria
--     (`app.guard_suspended_clinic_write`); o teste da varredura confere.

create function app.clinic_is_suspended(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.clinics where id = p_clinic_id and status = 'suspended')
$$;

-- Login da clínica (não o Suporte) gravando: o caso que a F12.3b barra.
create function app.is_clinic_login_write()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and not app.is_platform_staff()
$$;

create function app.guard_suspended_clinic_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
begin
  if not app.is_clinic_login_write() then
    return coalesce(new, old);
  end if;
  v_clinic := case when tg_op = 'DELETE' then old.clinic_id else new.clinic_id end;
  -- Mudar a linha de uma clínica para outra também conta a de origem.
  if app.clinic_is_suspended(v_clinic) or (tg_op = 'UPDATE' and app.clinic_is_suspended(old.clinic_id)) then
    raise exception 'Clínica suspensa: o painel fica restrito à Assinatura até a regularização.'
      using errcode = 'P0001', hint = 'clinic_suspended';
  end if;
  return coalesce(new, old);
end
$$;

-- A própria linha da clínica (nome e dados): só o Suporte, na suspensão.
create function app.guard_suspended_clinic_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.is_clinic_login_write() and old.status = 'suspended' then
    raise exception 'Clínica suspensa: o painel fica restrito à Assinatura até a regularização.'
      using errcode = 'P0001', hint = 'clinic_suspended';
  end if;
  return coalesce(new, old);
end
$$;

create trigger clinics_guard_suspended
  before update or delete on public.clinics
  for each row execute function app.guard_suspended_clinic_row();

-- Tabelas que não entram (ver o cabeçalho).
create function app.suspension_free_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'billing_accounts', 'billing_audit_log', 'billing_contracts', 'clinic_suspensions',
    'platform_access_log', 'platform_audit_log', 'system_errors', 'job_runs', 'clinic_usage_monthly',
    'push_subscriptions'
  ]
$$;

do $$
declare
  r record;
begin
  for r in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'clinic_id'
       and c.table_name <> all (app.suspension_free_tables())
  loop
    execute format(
      'create trigger %I before insert or update or delete on public.%I for each row execute function app.guard_suspended_clinic_write()',
      r.table_name || '_guard_suspended', r.table_name
    );
  end loop;
end
$$;

revoke execute on function app.clinic_is_suspended(uuid) from public, anon, clinic_service;
revoke execute on function app.is_clinic_login_write() from public, anon, clinic_service;
revoke execute on function app.suspension_free_tables() from public, anon, clinic_service;
