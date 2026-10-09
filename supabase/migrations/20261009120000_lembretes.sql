-- Lembretes (cliente, 09/out/2026):
-- 1. Um lembrete só em cada público, na véspera ou no dia, no horário escolhido
--    (horas cheias das 6h às 20h): ao paciente (sem o reenvio automático de
--    4h), ao profissional (resumo do dia dele) e à equipe (resumo do dia).
--    Sai o par véspera + dia do resumo.
-- 2. Na matriz, "Envio do resumo do dia" vira "Lembrete ao profissional
--    (resumo do dia)" e entra "Lembrete à equipe (resumo do dia)" (os outros
--    contatos); quem tinha o item fica com os dois.

-- ---------------------------------------------------------------------------
-- Opções da clínica
-- ---------------------------------------------------------------------------
alter table public.clinic_settings drop constraint clinic_settings_reminder_hour_check;
alter table public.clinic_settings
  add constraint clinic_settings_reminder_hour_check check (reminder_hour between 6 and 20),
  -- eve: véspera (atendimentos de amanhã); same_day: no dia (atendimentos de hoje depois do horário).
  add column reminder_timing text not null default 'eve' check (reminder_timing in ('eve', 'same_day')),
  add column professional_summary_enabled boolean not null default true,
  add column professional_summary_timing text not null default 'eve' check (professional_summary_timing in ('eve', 'same_day')),
  add column professional_summary_hour smallint not null default 18 check (professional_summary_hour between 6 and 20),
  add column team_summary_enabled boolean not null default true,
  add column team_summary_timing text not null default 'eve' check (team_summary_timing in ('eve', 'same_day')),
  add column team_summary_hour smallint not null default 18 check (team_summary_hour between 6 and 20);

-- O que a clínica tinha: a véspera ligada vira a véspera no mesmo horário;
-- só o do dia vira o do dia às 7h; nenhum, desligado.
update public.clinic_settings set
  professional_summary_enabled = summary_preview_enabled or summary_today_enabled,
  professional_summary_timing = case when summary_preview_enabled or not summary_today_enabled then 'eve' else 'same_day' end,
  professional_summary_hour = case when summary_preview_enabled or not summary_today_enabled then summary_preview_hour else 7 end,
  team_summary_enabled = summary_preview_enabled or summary_today_enabled,
  team_summary_timing = case when summary_preview_enabled or not summary_today_enabled then 'eve' else 'same_day' end,
  team_summary_hour = case when summary_preview_enabled or not summary_today_enabled then summary_preview_hour else 7 end;

alter table public.clinic_settings
  drop column summary_preview_enabled,
  drop column summary_preview_hour,
  drop column summary_today_enabled,
  drop column summary_today_lead_hours;

-- ---------------------------------------------------------------------------
-- Matriz de acesso
-- ---------------------------------------------------------------------------
update public.features set label = 'Lembrete ao profissional (resumo do dia)' where key = 'daily_summary';
insert into public.features (key, area, label, depends_on, sort_order) values
  ('team_summary', 'whatsapp', 'Lembrete à equipe (resumo do dia)', '{}', 82);

insert into public.clinic_features (clinic_id, feature_key, enabled_by, enabled_at)
  select clinic_id, 'team_summary', enabled_by, enabled_at
  from public.clinic_features
  where feature_key = 'daily_summary';

-- Os outros contatos do resumo passam a depender do item da equipe.
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
