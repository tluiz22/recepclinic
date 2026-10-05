-- F3.9a — Ajustes do WhatsApp para a camada de acesso (conversas, mensagens e
-- funil).

-- ---------------------------------------------------------------------------
-- Funil: atendimento humano
-- ---------------------------------------------------------------------------
-- O piloto grava o fluxo "handoff" (pedido de "Falar com a secretária" e
-- secretária que assume pelo app), e as métricas do funil o contam. A F2.6
-- deixou o valor de fora.
alter table public.bot_funnel_events drop constraint bot_funnel_events_flow_check;
alter table public.bot_funnel_events add constraint bot_funnel_events_flow_check
  check (flow in ('booking', 'return_booking', 'exam', 'cancel', 'reschedule', 'handoff'));

-- ---------------------------------------------------------------------------
-- Mensagens: telefone e eventos repetidos
-- ---------------------------------------------------------------------------
-- A janela de 24h da Meta é por número, e quem escreve pela primeira vez
-- ainda não é contato da clínica: o telefone fica na própria mensagem (no
-- piloto, a janela só via mensagens de responsável cadastrado).
alter table public.whatsapp_messages
  add column contact_phone text check (contact_phone ~ '^\+\d{10,15}$');

create index whatsapp_messages_window_idx
  on public.whatsapp_messages (clinic_id, contact_phone, created_at desc)
  where direction = 'inbound';

-- A Meta repete eventos: além das mensagens recebidas (L23), as enviadas pela
-- recepção no app (coexistência) chegam como eco e também não podem entrar
-- duas vezes. Os ids da Meta não se repetem entre recebidas e enviadas.
drop index public.whatsapp_messages_inbound_wa_id_idx;
create unique index whatsapp_messages_wa_id_unique_idx
  on public.whatsapp_messages (clinic_id, wa_message_id)
  where wa_message_id is not null;

-- ---------------------------------------------------------------------------
-- Conversa: início da pausa da recepção
-- ---------------------------------------------------------------------------
-- O prazo da pausa conta da última mensagem da recepção (no piloto, do
-- updated_at da conversa, que muda também em outras gravações).
-- Pausa sem hora informada começa agora; fim da pausa apaga a hora.
alter table public.conversation_state add column human_handoff_at timestamptz;

create function app.conversation_handoff_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not new.human_handoff then
    new.human_handoff_at := null;
  elsif new.human_handoff_at is null then
    new.human_handoff_at := now();
  end if;
  return new;
end
$$;

create trigger conversation_state_handoff_at before insert or update on public.conversation_state
  for each row execute function app.conversation_handoff_at();

-- ---------------------------------------------------------------------------
-- Matriz de acesso (D11): conversa do bot e funil só com o bot liberado
-- ---------------------------------------------------------------------------
-- Mensagens continuam livres: lembrete e resumo do dia têm itens próprios.
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

create trigger conversation_state_feature_rules before insert on public.conversation_state
  for each row execute function app.feature_rules();
create trigger bot_funnel_events_feature_rules before insert on public.bot_funnel_events
  for each row execute function app.feature_rules();
