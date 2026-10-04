-- F2.5 — Lista de espera (portado das migrações 0037/0038 do piloto; D2 revista:
-- a vaga vai só para quem espera na mesma agenda e no mesmo serviço; D9: sessão
-- de série não entra na fila).

-- Eventos da lista de espera na trilha (faltaram na F2.4).
alter table public.appointment_events drop constraint appointment_events_event_type_check;
alter table public.appointment_events add constraint appointment_events_event_type_check check (event_type in (
  'created',
  'rescheduled',           -- details: { from, to }
  'canceled',
  'presence_confirmed',
  'presence_unconfirmed',
  'attendance_recorded',   -- details: { status: 'completed' | 'no_show' }
  'attendance_corrected',  -- details: { from, to }
  'message_not_sent',      -- details: { kind, reason }
  'reminder_resent',
  'preparation_resent',
  'waitlist_joined',
  'waitlist_left',         -- details: { reason }
  'waitlist_advanced'      -- details: { from, to }
));

-- ---------------------------------------------------------------------------
-- Inscrições: um atendimento já marcado esperando para antecipar
-- ---------------------------------------------------------------------------
create table public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  appointment_id uuid not null,
  status text not null default 'active' check (status in (
    'active',     -- na fila
    'advanced',   -- aceitou uma vaga (antecipado)
    'left',       -- saiu pelo bot
    'removed',    -- retirado pela tela
    'closed'      -- saiu sozinho: atendimento aconteceu, foi cancelado etc.
  )),
  created_via text not null default 'whatsapp_bot' check (created_via in ('whatsapp_bot', 'booking_link')),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_reason text,
  ended_by uuid references auth.users (id) on delete set null,
  unique (clinic_id, id),
  foreign key (clinic_id, appointment_id) references public.appointments (clinic_id, id) on delete cascade
);

create unique index waitlist_entries_active_appointment_idx
  on public.waitlist_entries (appointment_id) where status = 'active';
create index waitlist_entries_active_queue_idx
  on public.waitlist_entries (clinic_id, created_at) where status = 'active';

-- Sessão de série tem horário fixo combinado: não entra na fila (D9).
create function app.waitlist_entry_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.appointments where id = new.appointment_id and series_id is not null) then
    raise exception 'Sessão de série não entra na lista de espera.' using errcode = 'P0001', hint = 'series_session';
  end if;
  return new;
end
$$;

create trigger waitlist_entries_rules
  before insert on public.waitlist_entries
  for each row execute function app.waitlist_entry_rules();

-- ---------------------------------------------------------------------------
-- Vagas abertas por cancelamento ou remarcação
-- ---------------------------------------------------------------------------
create table public.waitlist_openings (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  opened_by_appointment_id uuid,
  reason text not null check (reason in ('canceled', 'rescheduled')),
  service_id uuid not null,
  agenda_id uuid not null,
  is_group_session boolean not null default false,
  slot_scheduled_at timestamptz not null,
  slot_location_id uuid not null,
  slot_duration_minutes integer not null check (slot_duration_minutes > 0),
  status text not null default 'open' check (status in (
    'open',       -- aguardando oferta ao próximo da fila
    'offering',   -- oferta em aberto
    'filled',     -- alguém da lista aceitou
    'closed'      -- encerrada sem ninguém da lista (motivo em closed_reason)
  )),
  closed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, opened_by_appointment_id) references public.appointments (clinic_id, id)
    on delete set null (opened_by_appointment_id),
  foreign key (clinic_id, service_id) references public.services (clinic_id, id),
  foreign key (clinic_id, agenda_id) references public.agendas (clinic_id, id),
  foreign key (clinic_id, slot_location_id) references public.locations (clinic_id, id)
);

create index waitlist_openings_open_idx on public.waitlist_openings (clinic_id, created_at) where status = 'open';

-- ---------------------------------------------------------------------------
-- Ofertas da vaga ao próximo da fila (60 min para responder)
-- ---------------------------------------------------------------------------
create table public.waitlist_offers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  entry_id uuid not null,
  appointment_id uuid not null,
  opening_id uuid,
  opened_by_appointment_id uuid,
  slot_scheduled_at timestamptz not null,
  slot_location_id uuid not null,
  slot_duration_minutes integer not null check (slot_duration_minutes > 0),
  status text not null default 'pending' check (status in (
    'pending',    -- aguardando resposta (até expires_at)
    'accepted',   -- "Sim": atendimento remarcado para a vaga
    'declined',   -- "Não"
    'expired',    -- sem resposta no prazo
    'withdrawn',  -- vaga deixou de valer antes da resposta
    'skipped'     -- pessoa pulada (sem janela de conversa, falha no envio)
  )),
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  whatsapp_message_id text,
  details jsonb not null default '{}'::jsonb,
  foreign key (clinic_id, entry_id) references public.waitlist_entries (clinic_id, id) on delete cascade,
  foreign key (clinic_id, appointment_id) references public.appointments (clinic_id, id) on delete cascade,
  foreign key (clinic_id, opening_id) references public.waitlist_openings (clinic_id, id) on delete cascade,
  foreign key (clinic_id, opened_by_appointment_id) references public.appointments (clinic_id, id)
    on delete set null (opened_by_appointment_id),
  foreign key (clinic_id, slot_location_id) references public.locations (clinic_id, id)
);

create unique index waitlist_offers_pending_opening_idx on public.waitlist_offers (opening_id) where status = 'pending';
create unique index waitlist_offers_pending_entry_idx on public.waitlist_offers (entry_id) where status = 'pending';
create index waitlist_offers_pending_expires_idx on public.waitlist_offers (expires_at) where status = 'pending';
create index waitlist_offers_entry_idx on public.waitlist_offers (entry_id, offered_at);
create index waitlist_offers_opening_idx on public.waitlist_offers (opening_id);

create trigger waitlist_openings_set_updated_at before update on public.waitlist_openings
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Gatilho da lista de espera (portado de waitlist_on_appointment_change)
-- ---------------------------------------------------------------------------
-- 1. Atendimento terminou (cancelado, realizado, faltou): encerra a inscrição
--    dele e retira a oferta pendente feita a ele (a vaga volta a 'open').
-- 2. Cancelado (fora de cancelamento em massa) ou movido com mais de 2h de
--    antecedência, e há alguém esperando na MESMA agenda e no MESMO serviço:
--    registra a vaga.
-- A chamada à rota que dispara as ofertas (no piloto, pelo pg_net) entra na
-- F7, com o agendamento das rotinas.
create function app.waitlist_on_appointment_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  was_active boolean := old.status in ('scheduled', 'confirmed');
  is_active boolean := new.status in ('scheduled', 'confirmed');
  slot_moved boolean := new.scheduled_at is distinct from old.scheduled_at
    or new.location_id is distinct from old.location_id
    or new.agenda_id is distinct from old.agenda_id;
  ended boolean := was_active and new.status in ('canceled', 'completed', 'no_show');
begin
  if ended then
    update public.waitlist_entries
      set status = 'closed', ended_at = now(), ended_reason = new.status::text
      where appointment_id = new.id and status = 'active';

    with withdrawn as (
      update public.waitlist_offers
        set status = 'withdrawn', responded_at = now(),
            details = details || jsonb_build_object('reason', 'appointment_' || new.status::text)
        where appointment_id = new.id and status = 'pending'
        returning opening_id
    )
    update public.waitlist_openings
      set status = 'open'
      where id in (select opening_id from withdrawn) and status = 'offering';
  end if;

  if was_active
     and old.scheduled_at > now() + interval '2 hours'
     and ((new.status = 'canceled' and not new.mass_canceled) or (is_active and slot_moved))
     and exists (
       select 1
       from public.waitlist_entries e
       join public.appointments a on a.id = e.appointment_id
       where e.status = 'active'
         and a.id <> new.id
         and a.agenda_id = old.agenda_id
         and a.service_id = old.service_id
     )
  then
    insert into public.waitlist_openings (
      clinic_id, opened_by_appointment_id, reason, service_id, agenda_id, is_group_session,
      slot_scheduled_at, slot_location_id, slot_duration_minutes
    ) values (
      old.clinic_id, new.id,
      case when new.status = 'canceled' then 'canceled' else 'rescheduled' end,
      old.service_id, old.agenda_id, old.is_group_session,
      old.scheduled_at, old.location_id, old.duration_minutes
    );
  end if;

  return null;
end
$$;

create trigger appointments_waitlist
  after update of status, scheduled_at, location_id, agenda_id on public.appointments
  for each row execute function app.waitlist_on_appointment_change();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Inscrições e ofertas seguem o acesso ao atendimento (a subconsulta passa
-- pelo RLS de appointments); vagas seguem o acesso à agenda. Vagas e ofertas
-- são gravadas pelo gatilho e pelo agendador (clinic_service), não pela tela.
alter table public.waitlist_entries enable row level security;
alter table public.waitlist_openings enable row level security;
alter table public.waitlist_offers enable row level security;

create policy waitlist_entries_select on public.waitlist_entries
  for select to authenticated
  using (exists (select 1 from public.appointments a where a.id = appointment_id));

create policy waitlist_entries_insert on public.waitlist_entries
  for insert to authenticated
  with check (
    app.has_clinic_role(clinic_id, array['admin', 'professional', 'reception']::public.clinic_role[])
    and exists (select 1 from public.appointments a where a.id = appointment_id)
  );

create policy waitlist_entries_update on public.waitlist_entries
  for update to authenticated
  using (
    app.has_clinic_role(clinic_id, array['admin', 'professional', 'reception']::public.clinic_role[])
    and exists (select 1 from public.appointments a where a.id = appointment_id)
  )
  with check (
    app.has_clinic_role(clinic_id, array['admin', 'professional', 'reception']::public.clinic_role[])
    and exists (select 1 from public.appointments a where a.id = appointment_id)
  );

create policy waitlist_openings_select on public.waitlist_openings
  for select to authenticated
  using (app.can_access_agenda(agenda_id));

create policy waitlist_offers_select on public.waitlist_offers
  for select to authenticated
  using (exists (select 1 from public.appointments a where a.id = appointment_id));

create policy waitlist_entries_service on public.waitlist_entries
  for all to clinic_service
  using (clinic_id = app.service_clinic_id())
  with check (clinic_id = app.service_clinic_id());

create policy waitlist_openings_service on public.waitlist_openings
  for all to clinic_service
  using (clinic_id = app.service_clinic_id())
  with check (clinic_id = app.service_clinic_id());

create policy waitlist_offers_service on public.waitlist_offers
  for all to clinic_service
  using (clinic_id = app.service_clinic_id())
  with check (clinic_id = app.service_clinic_id());

create trigger waitlist_entries_audit_platform_staff
  after insert or update or delete on public.waitlist_entries
  for each row execute function app.audit_platform_staff_write();
create trigger waitlist_openings_audit_platform_staff
  after insert or update or delete on public.waitlist_openings
  for each row execute function app.audit_platform_staff_write();
create trigger waitlist_offers_audit_platform_staff
  after insert or update or delete on public.waitlist_offers
  for each row execute function app.audit_platform_staff_write();

-- A tela não apaga nada da lista (sai por status); vagas e ofertas não são
-- gravadas pela tela; o bot/agendador não apaga.
revoke delete on public.waitlist_entries, public.waitlist_openings, public.waitlist_offers
  from anon, authenticated, clinic_service;
revoke insert, update on public.waitlist_openings, public.waitlist_offers from anon, authenticated;
