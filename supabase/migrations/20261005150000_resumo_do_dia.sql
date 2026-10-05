-- F3.9c — Resumo do dia por profissional (D2 revista pelo cliente, 05/out/2026).

-- ---------------------------------------------------------------------------
-- Profissional: telefone e opção de receber o resumo dos próprios atendimentos
-- ---------------------------------------------------------------------------
alter table public.professionals
  add column phone text check (phone ~ '^\+\d{10,15}$'),
  add column receives_daily_summary boolean not null default false,
  add constraint professionals_daily_summary_phone_check check (not receives_daily_summary or phone is not null);

-- ---------------------------------------------------------------------------
-- Envios do resumo: de quem (lista geral ou profissional) e qual envio
-- ---------------------------------------------------------------------------
-- O agendador decide por aqui se o resumo de cada público já saiu: o da
-- véspera uma vez, o do dia uma vez (e de novo se entrar atendimento antes do
-- horário já avisado). Sem profissional = contatos do resumo (clínica toda).
alter table public.daily_summary_sends
  add column professional_id uuid,
  add column variant text not null default 'final' check (variant in ('preview', 'final')),
  add constraint daily_summary_sends_professional_fk
    foreign key (clinic_id, professional_id) references public.professionals (clinic_id, id) on delete cascade;

drop index public.daily_summary_sends_clinic_idx;
create index daily_summary_sends_clinic_idx
  on public.daily_summary_sends (clinic_id, summary_date, variant, kind, professional_id, sent_at desc);

-- ---------------------------------------------------------------------------
-- Matriz de acesso (D11): o resumo do profissional é do item do resumo do dia
-- ---------------------------------------------------------------------------
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

create trigger professionals_feature_rules before insert or update of receives_daily_summary on public.professionals
  for each row execute function app.feature_rules();
