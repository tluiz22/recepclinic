-- Ajuste da F4.4b (cliente, 05/out/2026): um local domiciliar (ou serviço de
-- exame) criado com o item liberado continua ativo quando o item é desligado
-- na matriz (D11). A trava agora vale também ao ligar o serviço ao local e
-- ao cadastrar ou reativar um horário; o que já está gravado fica como está.

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
    when 'professional_insurance_exclusions' then
      perform app.require_feature(new.clinic_id, 'insurance');
    when 'patients' then
      if new.insurance_plan_id is not null then perform app.require_feature(new.clinic_id, 'insurance'); end if;
    when 'notification_recipients' then
      if new.is_active then perform app.require_feature(new.clinic_id, 'daily_summary'); end if;
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

create trigger service_locations_feature_rules before insert or update of location_id on public.service_locations
  for each row execute function app.feature_rules();
create trigger availability_windows_feature_rules before insert or update of is_active, location_id, service_id on public.availability_windows
  for each row execute function app.feature_rules();
