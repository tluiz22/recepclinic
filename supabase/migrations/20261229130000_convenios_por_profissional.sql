-- MC (cliente, 07/nov/2026; docs/planejamento-multiprofissional.md, seção 3):
-- convênios por profissional.
--
--   1. associação positiva: professional_insurance_plans guarda os planos que o
--      profissional ATENDE; sem nenhum = só particular. Começa vazia (M3): as
--      exceções de antes (professional_insurance_exclusions) saem;
--   2. quem mantém (M4): o Administrador sempre; os demais membros com a
--      permissão clinic_members.can_manage_insurance, marcada pelo
--      Administrador em Equipe. Vale para o cadastro de convênios e para a
--      associação;
--   3. trilha: toda mudança nos convênios e na associação, com quem fez.

-- 2. Permissão
alter table public.clinic_members add column can_manage_insurance boolean not null default false;

create function app.can_manage_insurance(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_clinic_role(p_clinic_id, array['admin']::public.clinic_role[])
    or exists (
      select 1 from public.clinic_members
       where clinic_id = p_clinic_id and user_id = (select auth.uid()) and can_manage_insurance
    )
$$;

revoke execute on function app.can_manage_insurance(uuid) from public, anon;
grant execute on function app.can_manage_insurance(uuid) to authenticated, clinic_service;

drop policy insurance_plans_insert on public.insurance_plans;
drop policy insurance_plans_update on public.insurance_plans;
drop policy insurance_plans_delete on public.insurance_plans;
create policy insurance_plans_insert on public.insurance_plans for insert to authenticated
  with check (app.can_manage_insurance(clinic_id));
create policy insurance_plans_update on public.insurance_plans for update to authenticated
  using (app.can_manage_insurance(clinic_id)) with check (app.can_manage_insurance(clinic_id));
create policy insurance_plans_delete on public.insurance_plans for delete to authenticated
  using (app.can_manage_insurance(clinic_id));

-- 1. Associação positiva
create table public.professional_insurance_plans (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  professional_id uuid not null,
  insurance_plan_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (professional_id, insurance_plan_id),
  foreign key (clinic_id, professional_id) references public.professionals (clinic_id, id) on delete cascade,
  foreign key (clinic_id, insurance_plan_id) references public.insurance_plans (clinic_id, id) on delete cascade
);

create index professional_insurance_plans_clinic_idx on public.professional_insurance_plans (clinic_id);
create index professional_insurance_plans_plan_idx on public.professional_insurance_plans (insurance_plan_id);

alter table public.professional_insurance_plans enable row level security;
create policy professional_insurance_plans_select on public.professional_insurance_plans for select to authenticated
  using (app.is_clinic_member(clinic_id));
create policy professional_insurance_plans_insert on public.professional_insurance_plans for insert to authenticated
  with check (app.can_manage_insurance(clinic_id));
create policy professional_insurance_plans_delete on public.professional_insurance_plans for delete to authenticated
  using (app.can_manage_insurance(clinic_id));
create policy professional_insurance_plans_select_service on public.professional_insurance_plans for select to clinic_service
  using (clinic_id = app.service_clinic_id());
revoke all on public.professional_insurance_plans from anon;
revoke update, truncate on public.professional_insurance_plans from authenticated;
revoke insert, update, delete, truncate on public.professional_insurance_plans from clinic_service;
create trigger professional_insurance_plans_audit_platform_staff after insert or update or delete on public.professional_insurance_plans
  for each row execute function app.audit_platform_staff_write();
create trigger professional_insurance_plans_guard_suspended
  before insert or update or delete on public.professional_insurance_plans
  for each row execute function app.guard_suspended_clinic_write();

-- Item "Convênios" desligado na matriz: não associa (como as exceções antes).
create or replace function app.feature_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category public.service_category;
  v_location public.location_type;
begin
  case tg_table_name
    when 'services' then
      if new.category = 'exam' and new.is_active then perform app.require_feature(new.clinic_id, 'exams'); end if;
    when 'locations' then
      if new.type = 'home_visit' and new.is_active then perform app.require_feature(new.clinic_id, 'home_visit'); end if;
    when 'appointment_series' then
      perform app.require_feature(new.clinic_id, 'series');
    when 'insurance_plans' then
      if new.is_active then perform app.require_feature(new.clinic_id, 'insurance'); end if;
    when 'professional_insurance_plans' then
      perform app.require_feature(new.clinic_id, 'insurance');
    when 'patients' then
      if new.insurance_plan_id is not null then perform app.require_feature(new.clinic_id, 'insurance'); end if;
    when 'notification_recipients' then
      if new.is_active then perform app.require_feature(new.clinic_id, 'team_summary'); end if;
    when 'professionals' then
      if new.receives_daily_summary then perform app.require_feature(new.clinic_id, 'daily_summary'); end if;
    when 'waitlist_entries' then
      perform app.require_feature(new.clinic_id, 'waitlist');
    when 'conversation_state', 'bot_funnel_events' then
      perform app.require_feature(new.clinic_id, 'whatsapp_bot');
    when 'service_locations' then
      select type into v_location from public.locations where id = new.location_id;
      if v_location = 'home_visit' then perform app.require_feature(new.clinic_id, 'home_visit'); end if;
    when 'availability_windows' then
      if new.is_active then
        select type into v_location from public.locations where id = new.location_id;
        select category into v_category from public.services where id = new.service_id;
        if v_location = 'home_visit' then perform app.require_feature(new.clinic_id, 'home_visit'); end if;
        if v_category = 'exam' then perform app.require_feature(new.clinic_id, 'exams'); end if;
      end if;
    when 'appointments' then
      select category into v_category from public.services where id = new.service_id;
      select type into v_location from public.locations where id = new.location_id;
      if v_category = 'exam' then perform app.require_feature(new.clinic_id, 'exams'); end if;
      if v_location = 'home_visit' then perform app.require_feature(new.clinic_id, 'home_visit'); end if;
      if tg_op = 'INSERT' and new.series_id is not null then perform app.require_feature(new.clinic_id, 'series'); end if;
  end case;
  return new;
end
$$;

create trigger professional_insurance_plans_feature_rules before insert on public.professional_insurance_plans
  for each row execute function app.feature_rules();

drop table public.professional_insurance_exclusions;

-- 3. Trilha (só leitura para o Administrador; grava o gatilho)
create table public.insurance_change_log (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null check (action in ('plan_created', 'plan_updated', 'plan_deleted', 'linked', 'unlinked')),
  insurance_plan_id uuid,
  professional_id uuid,
  created_at timestamptz not null default now()
);

create index insurance_change_log_clinic_idx on public.insurance_change_log (clinic_id, created_at desc);

alter table public.insurance_change_log enable row level security;
create policy insurance_change_log_select on public.insurance_change_log for select to authenticated
  using (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]));
revoke all on public.insurance_change_log from anon;
revoke insert, update, delete, truncate on public.insurance_change_log from authenticated, clinic_service;
revoke select on public.insurance_change_log from clinic_service;

create function app.log_insurance_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record := case when tg_op = 'DELETE' then old else new end;
begin
  -- Clínica apagada (a cascata leva tudo junto): não registra.
  if not exists (select 1 from public.clinics where id = v_row.clinic_id) then return null; end if;
  if tg_table_name = 'insurance_plans' then
    insert into public.insurance_change_log (clinic_id, actor_user_id, action, insurance_plan_id)
      values (v_row.clinic_id, (select auth.uid()),
              case tg_op when 'INSERT' then 'plan_created' when 'UPDATE' then 'plan_updated' else 'plan_deleted' end, v_row.id);
  else
    insert into public.insurance_change_log (clinic_id, actor_user_id, action, insurance_plan_id, professional_id)
      values (v_row.clinic_id, (select auth.uid()), case tg_op when 'INSERT' then 'linked' else 'unlinked' end,
              v_row.insurance_plan_id, v_row.professional_id);
  end if;
  return null;
end
$$;

revoke execute on function app.log_insurance_change() from public, anon, authenticated, clinic_service;

create trigger insurance_plans_change_log after insert or update or delete on public.insurance_plans
  for each row execute function app.log_insurance_change();
create trigger professional_insurance_plans_change_log after insert or delete on public.professional_insurance_plans
  for each row execute function app.log_insurance_change();

create trigger insurance_change_log_guard_suspended
  before insert or update or delete on public.insurance_change_log
  for each row execute function app.guard_suspended_clinic_write();
create trigger insurance_change_log_audit_platform_staff after insert or update or delete on public.insurance_change_log
  for each row execute function app.audit_platform_staff_write();
