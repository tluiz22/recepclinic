-- F3.8 — Matriz de acesso por clínica (D11, cliente, 05/out/2026).
--
-- O Administrador do sistema (Suporte RecepClinic, D6) libera, clínica a
-- clínica, as telas, abas e funções além do básico do consultório. Aqui ficam:
--   1. a lista de itens da matriz (igual à de src/lib/features.ts; um teste
--      confere);
--   2. os itens liberados por clínica, gravados só pela função
--      set_clinic_features (quem liberou e quando ficam na linha; o que saiu
--      fica no registro do Suporte, platform_audit_log);
--   3. as travas no banco para as funções que criam dados: com o item
--      desligado, não se cadastra serviço de exame, local domiciliar, série,
--      convênio, contato do resumo, nem se entra na lista de espera, mesmo
--      chamando a API direto. Telas, abas e envios são barrados na aplicação.

-- ---------------------------------------------------------------------------
-- Itens da matriz
-- ---------------------------------------------------------------------------
create table public.features (
  key text primary key,
  area text not null check (area in ('agenda', 'whatsapp', 'metrics')),
  label text not null,
  depends_on text[] not null default '{}',
  sort_order integer not null unique
);

insert into public.features (key, area, label, depends_on, sort_order) values
  ('exams',               'agenda',   'Exames e procedimentos',             '{}', 10),
  ('home_visit',          'agenda',   'Atendimento domiciliar',             '{}', 20),
  ('series',              'agenda',   'Séries recorrentes',                 '{}', 30),
  ('insurance',           'agenda',   'Convênios',                          '{}', 40),
  ('whatsapp_bot',        'whatsapp', 'Bot de WhatsApp',                    '{}', 50),
  ('reminders',           'whatsapp', 'Lembrete automático',                '{}', 60),
  ('waitlist',            'whatsapp', 'Lista de espera',                    '{whatsapp_bot}', 70),
  ('daily_summary',       'whatsapp', 'Envio do resumo do dia',             '{}', 80),
  ('metrics_overview',    'metrics',  'Métricas: Visão geral',              '{}', 90),
  ('metrics_appointments','metrics',  'Métricas: Atendimentos',             '{}', 100),
  ('metrics_no_shows',    'metrics',  'Métricas: Faltosos',                 '{}', 110),
  ('metrics_recall',      'metrics',  'Métricas: Retomar contato',          '{}', 120),
  ('metrics_funnel',      'metrics',  'Métricas: Funil do bot',             '{whatsapp_bot}', 130),
  ('metrics_financial',   'metrics',  'Métricas: Financeiro',               '{}', 140),
  ('metrics_sends',       'metrics',  'Métricas: Envios',                   '{}', 150),
  ('reports',             'metrics',  'Relatórios',                         '{}', 160),
  ('metrics_personal',    'metrics',  'Métricas pessoais do profissional',  '{}', 170);

alter table public.features enable row level security;
create policy features_select on public.features for select to authenticated, clinic_service using (true);
revoke insert, update, delete on public.features from anon, authenticated, clinic_service;

-- ---------------------------------------------------------------------------
-- Itens liberados por clínica (clínica nova: nenhum)
-- ---------------------------------------------------------------------------
create table public.clinic_features (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  feature_key text not null references public.features (key),
  enabled_by uuid references auth.users (id) on delete set null,
  enabled_at timestamptz not null default now(),
  primary key (clinic_id, feature_key)
);

alter table public.clinic_features enable row level security;

create policy clinic_features_select on public.clinic_features
  for select to authenticated
  using (app.is_clinic_member(clinic_id));

create policy clinic_features_select_service on public.clinic_features
  for select to clinic_service
  using (clinic_id = app.service_clinic_id());

-- Só set_clinic_features grava (e a plataforma, pela service role).
revoke insert, update, delete on public.clinic_features from anon, authenticated, clinic_service;

create trigger clinic_features_audit_platform_staff
  after insert or update or delete on public.clinic_features
  for each row execute function app.audit_platform_staff_write();

-- ---------------------------------------------------------------------------
-- Consulta e gravação
-- ---------------------------------------------------------------------------
create function app.clinic_has_feature(p_clinic_id uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.clinic_features where clinic_id = p_clinic_id and feature_key = p_key)
$$;

-- Erro único para "não liberado": a aplicação o reconhece pelo hint.
create function app.require_feature(p_clinic_id uuid, p_key text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.clinic_has_feature(p_clinic_id, p_key) then
    raise exception 'Não liberado para a clínica: %.', (select label from public.features where key = p_key)
      using errcode = 'P0001', hint = 'feature_disabled:' || p_key;
  end if;
end
$$;

grant execute on function app.clinic_has_feature(uuid, text) to authenticated, clinic_service;

-- Troca a lista de itens liberados da clínica (o que não está na lista sai).
create function public.set_clinic_features(p_clinic_id uuid, p_features text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keys text[] := array(select distinct unnest(coalesce(p_features, '{}')));
  v_unknown text;
  v_missing record;
begin
  if not (app.is_platform_staff() or (select auth.role()) = 'service_role') then
    raise exception 'Só o Administrador do sistema muda a matriz de acesso.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clinics where id = p_clinic_id) then
    raise exception 'Clínica não encontrada.' using errcode = 'P0002';
  end if;

  select k into v_unknown from unnest(v_keys) k where not exists (select 1 from public.features f where f.key = k) limit 1;
  if v_unknown is not null then
    raise exception 'Item da matriz desconhecido: %.', v_unknown using errcode = '22023';
  end if;

  select f.label, d.label as needs into v_missing
    from public.features f
    cross join lateral unnest(f.depends_on) dep
    join public.features d on d.key = dep
   where f.key = any (v_keys) and not dep = any (v_keys)
   limit 1;
  if found then
    raise exception '"%" depende de "%".', v_missing.label, v_missing.needs using errcode = 'P0001', hint = 'feature_dependency';
  end if;

  delete from public.clinic_features where clinic_id = p_clinic_id and not feature_key = any (v_keys);
  insert into public.clinic_features (clinic_id, feature_key, enabled_by)
    select p_clinic_id, k, (select auth.uid()) from unnest(v_keys) k
    on conflict do nothing;
end
$$;

revoke execute on function public.set_clinic_features(uuid, text[]) from public, anon, clinic_service;
grant execute on function public.set_clinic_features(uuid, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Travas das funções que criam dados
-- ---------------------------------------------------------------------------
create function app.feature_rules()
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
    when 'waitlist_entries' then
      perform app.require_feature(new.clinic_id, 'waitlist');
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

create trigger services_feature_rules before insert or update of category, is_active on public.services
  for each row execute function app.feature_rules();
create trigger locations_feature_rules before insert or update of type, is_active on public.locations
  for each row execute function app.feature_rules();
create trigger appointment_series_feature_rules before insert on public.appointment_series
  for each row execute function app.feature_rules();
create trigger insurance_plans_feature_rules before insert or update of is_active on public.insurance_plans
  for each row execute function app.feature_rules();
create trigger professional_insurance_exclusions_feature_rules before insert on public.professional_insurance_exclusions
  for each row execute function app.feature_rules();
create trigger patients_feature_rules before insert or update of insurance_plan_id on public.patients
  for each row execute function app.feature_rules();
create trigger notification_recipients_feature_rules before insert or update of is_active on public.notification_recipients
  for each row execute function app.feature_rules();
create trigger waitlist_entries_feature_rules before insert on public.waitlist_entries
  for each row execute function app.feature_rules();
-- Marcar e remarcar (cancelar e registrar comparecimento continuam livres).
create trigger appointments_feature_rules before insert or update of scheduled_at, location_id, service_id on public.appointments
  for each row execute function app.feature_rules();
