-- ---------------------------------------------------------------------------
-- Convênios de cada exame (CE-1; cliente, 10/nov/2026; docs/implementacao-recepcao-digital.md, 15.5.7)
-- ---------------------------------------------------------------------------
-- Antes, todo exame aceitava particular e todos os convênios ativos (F2d). Agora,
-- como o profissional (MC): services.accepts_private e a associação positiva
-- service_insurance_plans (com observação). Sem nenhum convênio = só particular.
-- Os exames de hoje ficam só particular (decisão do cliente: a produção tem uma
-- clínica, só particular). Convênio novo não entra sozinho. Quem mantém: quem
-- mantém os convênios (app.can_manage_insurance), com a trilha insurance_change_log.
--
-- Reversão: drop table public.service_insurance_plans; drop function
-- public.set_service_accepts_private; alter table public.services drop column
-- accepts_private; alter table public.insurance_change_log drop column service_id
-- (e a versão anterior de app.feature_rules e app.log_insurance_change).

alter table public.services add column accepts_private boolean not null default true;

-- 1. Associação positiva
create table public.service_insurance_plans (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  service_id uuid not null,
  insurance_plan_id uuid not null,
  note text check (note is null or (length(btrim(note)) between 1 and 300)),
  created_at timestamptz not null default now(),
  primary key (service_id, insurance_plan_id),
  foreign key (clinic_id, service_id) references public.services (clinic_id, id) on delete cascade,
  foreign key (clinic_id, insurance_plan_id) references public.insurance_plans (clinic_id, id) on delete cascade
);

create index service_insurance_plans_clinic_idx on public.service_insurance_plans (clinic_id);
create index service_insurance_plans_plan_idx on public.service_insurance_plans (insurance_plan_id);

alter table public.service_insurance_plans enable row level security;
create policy service_insurance_plans_select on public.service_insurance_plans for select to authenticated
  using (app.is_clinic_member(clinic_id));
create policy service_insurance_plans_insert on public.service_insurance_plans for insert to authenticated
  with check (app.can_manage_insurance(clinic_id));
create policy service_insurance_plans_update on public.service_insurance_plans for update to authenticated
  using (app.can_manage_insurance(clinic_id)) with check (app.can_manage_insurance(clinic_id));
create policy service_insurance_plans_delete on public.service_insurance_plans for delete to authenticated
  using (app.can_manage_insurance(clinic_id));
create policy service_insurance_plans_select_service on public.service_insurance_plans for select to clinic_service
  using (clinic_id = app.service_clinic_id());
revoke all on public.service_insurance_plans from anon;
revoke update, truncate on public.service_insurance_plans from authenticated;
grant update (note) on public.service_insurance_plans to authenticated;
revoke insert, update, delete, truncate on public.service_insurance_plans from clinic_service;
create trigger service_insurance_plans_audit_platform_staff after insert or update or delete on public.service_insurance_plans
  for each row execute function app.audit_platform_staff_write();
create trigger service_insurance_plans_guard_suspended
  before insert or update or delete on public.service_insurance_plans
  for each row execute function app.guard_suspended_clinic_write();

-- Item "Convênios" desligado na matriz: não associa; e só exame.
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
    when 'service_insurance_plans' then
      perform app.require_feature(new.clinic_id, 'insurance');
      -- Só exame tem convênios próprios (consulta e retorno seguem o profissional).
      select category into v_category from public.services where clinic_id = new.clinic_id and id = new.service_id;
      if v_category is distinct from 'exam' then
        raise exception 'Convênios por serviço só valem para exame.' using errcode = '23514';
      end if;
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

create trigger service_insurance_plans_feature_rules before insert on public.service_insurance_plans
  for each row execute function app.feature_rules();

-- 2. "Particular" do exame: anda com os convênios (quem mantém os convênios muda, sem mexer no resto do cadastro).
create function public.set_service_accepts_private(p_clinic_id uuid, p_service_id uuid, p_accepts boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(app.can_manage_insurance(p_clinic_id), false) then
    raise exception 'Sem permissão para mudar os convênios do exame.' using errcode = '42501';
  end if;
  update public.services set accepts_private = coalesce(p_accepts, true), updated_at = now()
   where clinic_id = p_clinic_id and id = p_service_id and category = 'exam';
  if not found then
    raise exception 'Exame não encontrado.' using errcode = 'P0002';
  end if;
end
$$;

revoke execute on function public.set_service_accepts_private(uuid, uuid, boolean) from public, anon, clinic_service;
grant execute on function public.set_service_accepts_private(uuid, uuid, boolean) to authenticated;

-- Pela tela do serviço (update direto), o "Particular" só muda com a permissão de convênios.
-- Sem security definer: current_user é quem fez o update ("authenticated" pela tela; o dono da função dentro de
-- set_service_accepts_private, que já conferiu a permissão).
create function app.guard_service_accepts_private()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.accepts_private is distinct from old.accepts_private
     and current_user = 'authenticated' and not coalesce(app.can_manage_insurance(new.clinic_id), false) then
    raise exception 'Sem permissão para mudar os convênios do exame.' using errcode = '42501';
  end if;
  return new;
end
$$;

revoke execute on function app.guard_service_accepts_private() from public, anon;

create trigger services_guard_accepts_private before update of accepts_private on public.services
  for each row execute function app.guard_service_accepts_private();

-- 3. Trilha: o exame ao lado do profissional.
alter table public.insurance_change_log add column service_id uuid;

create or replace function app.log_insurance_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record := case when tg_op = 'DELETE' then old else new end;
  v_action text := case tg_op when 'INSERT' then 'linked' when 'UPDATE' then 'note_updated' else 'unlinked' end;
begin
  -- Clínica apagada (a cascata leva tudo junto): não registra.
  if not exists (select 1 from public.clinics where id = v_row.clinic_id) then return null; end if;
  if tg_table_name = 'insurance_plans' then
    insert into public.insurance_change_log (clinic_id, actor_user_id, action, insurance_plan_id)
      values (v_row.clinic_id, (select auth.uid()),
              case tg_op when 'INSERT' then 'plan_created' when 'UPDATE' then 'plan_updated' else 'plan_deleted' end, v_row.id);
  elsif tg_table_name = 'service_insurance_plans' then
    insert into public.insurance_change_log (clinic_id, actor_user_id, action, insurance_plan_id, service_id)
      values (v_row.clinic_id, (select auth.uid()), v_action, v_row.insurance_plan_id, v_row.service_id);
  else
    insert into public.insurance_change_log (clinic_id, actor_user_id, action, insurance_plan_id, professional_id)
      values (v_row.clinic_id, (select auth.uid()), v_action, v_row.insurance_plan_id, v_row.professional_id);
  end if;
  return null;
end
$$;

create trigger service_insurance_plans_change_log after insert or delete on public.service_insurance_plans
  for each row execute function app.log_insurance_change();
create trigger service_insurance_plans_note_log after update of note on public.service_insurance_plans
  for each row when (new.note is distinct from old.note) execute function app.log_insurance_change();
