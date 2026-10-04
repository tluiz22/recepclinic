-- Fase 25 · etapa 3: vagas que abriram e saída automática da lista.
--
-- Em vez de mexer em cada caminho que cancela ou remarca (bot, página do
-- link, Agenda, exame em turma), um gatilho no banco registra a vaga
-- (`waitlist_openings`) e chama na hora a rota do motor de ofertas pelo
-- agendador (`internal.call_cron_route`, pg_net — a chamada sai depois do
-- commit). O job de 5 em 5 minutos (0037) é a rede de segurança e vence as
-- ofertas sem resposta.
--
-- Abre vaga: cancelamento individual (não o em massa nem o do bloqueio de
-- agenda, que marcam `mass_canceled`) e remarcação de um atendimento ativo
-- — inclusive a antecipação de alguém da lista (cascata). Só se o horário
-- antigo começa daqui a mais de 2h e há alguém na lista; o resto da regra
-- (tipo/local, horário livre antes, fila) fica na rota.

-- ---------------------------------------------------------------------
-- waitlist_openings — uma linha por vaga aberta
-- ---------------------------------------------------------------------
create table waitlist_openings (
  id uuid primary key default gen_random_uuid(),
  -- Atendimento que saiu do horário (cancelado ou remarcado).
  opened_by_appointment_id uuid references appointments (id) on delete set null,
  reason text not null check (reason in ('canceled', 'rescheduled')),
  appointment_type text not null check (appointment_type in ('first_visit', 'return_visit', 'exam')),
  exam_type_id uuid references exam_types (id),
  is_group_session boolean not null default false,
  slot_scheduled_at timestamptz not null,
  slot_clinic_location_id uuid not null references clinic_locations (id),
  slot_duration_minutes integer not null,
  status text not null default 'open' check (status in (
    'open',       -- aguardando oferta ao próximo da fila
    'offering',   -- oferta em aberto (ou sendo feita agora)
    'filled',     -- alguém da lista aceitou
    'closed'      -- encerrada sem ninguém da lista (motivo em closed_reason)
  )),
  -- 'too_late' (< 2h), 'earlier_free', 'slot_unavailable', 'no_candidates'.
  closed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index waitlist_openings_open_idx on waitlist_openings (created_at) where status = 'open';

alter table waitlist_openings enable row level security;

create policy "authenticated read" on waitlist_openings
  for select to authenticated
  using (auth.uid() is not null);

-- Ofertas passam a apontar para a vaga; "uma oferta em aberto por vaga"
-- vira por `opening_id`.
alter table waitlist_offers
  add column opening_id uuid references waitlist_openings (id) on delete cascade;

drop index waitlist_offers_pending_slot_idx;

create unique index waitlist_offers_pending_opening_idx
  on waitlist_offers (opening_id)
  where status = 'pending';

create index waitlist_offers_opening_idx on waitlist_offers (opening_id);

-- 'skipped': pessoa pulada sem receber a oferta (fora da janela de 24h sem
-- template aprovado, ou falha no envio) — não recebe de novo essa vaga.
alter table waitlist_offers drop constraint waitlist_offers_status_check;
alter table waitlist_offers add constraint waitlist_offers_status_check
  check (status in ('pending', 'accepted', 'declined', 'expired', 'withdrawn', 'skipped'));

-- ---------------------------------------------------------------------
-- Gatilho em appointments
-- ---------------------------------------------------------------------
-- SECURITY DEFINER: quem atualiza pela tela é o usuário logado, que não lê
-- o Vault nem chama `internal.*`.
create or replace function waitlist_on_appointment_change() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  was_active boolean := old.status in ('scheduled', 'confirmed');
  is_active boolean := new.status in ('scheduled', 'confirmed');
  slot_moved boolean := new.scheduled_at is distinct from old.scheduled_at
    or new.clinic_location_id is distinct from old.clinic_location_id;
  ended boolean := was_active and new.status in ('canceled', 'completed', 'no_show');
  call_route boolean := false;
begin
  -- Saída automática: cancelado, realizado ou falta → sai da lista; oferta
  -- em aberto para esse atendimento é retirada e a vaga volta para a fila.
  if ended then
    update waitlist_entries
      set status = 'closed', ended_at = now(), ended_reason = new.status
      where appointment_id = new.id and status = 'active';

    with withdrawn as (
      update waitlist_offers
        set status = 'withdrawn', responded_at = now(),
            details = details || jsonb_build_object('reason', 'appointment_' || new.status)
        where appointment_id = new.id and status = 'pending'
        returning opening_id
    )
    update waitlist_openings
      set status = 'open', updated_at = now()
      where id in (select opening_id from withdrawn) and status = 'offering';
    if found then call_route := true; end if;
  end if;

  -- Vaga aberta pelo horário antigo.
  if was_active
     and old.scheduled_at > now() + interval '2 hours'
     and ((new.status = 'canceled' and not new.mass_canceled) or (is_active and slot_moved))
     and exists (select 1 from waitlist_entries where status = 'active' and appointment_id <> new.id)
  then
    insert into waitlist_openings (
      opened_by_appointment_id, reason, appointment_type, exam_type_id, is_group_session,
      slot_scheduled_at, slot_clinic_location_id, slot_duration_minutes
    ) values (
      new.id,
      case when new.status = 'canceled' then 'canceled' else 'rescheduled' end,
      old.appointment_type, old.exam_type_id, old.is_group_session,
      old.scheduled_at, old.clinic_location_id, old.duration_minutes
    );
    call_route := true;
  end if;

  -- Falha na chamada (ex.: segredo do Vault ausente) nunca pode desfazer o
  -- cancelamento/remarcação — o job de 5 em 5 minutos processa depois.
  if call_route then
    begin
      perform internal.call_cron_route('/api/cron/waitlist-offers?trigger=opening');
    exception when others then
      raise warning 'lista de espera: chamada da rota falhou: %', sqlerrm;
    end;
  end if;

  return null;
end;
$$;

create trigger appointments_waitlist
  after update of status, scheduled_at, clinic_location_id on appointments
  for each row execute function waitlist_on_appointment_change();
