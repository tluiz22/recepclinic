-- Fase 20 · etapa 1: saída do Google Calendar — modelo de dados.
--
-- O sistema (Supabase) passa a ser a única agenda. Duas coisas que hoje só
-- existem no Google ganham lugar no banco:
--   1. os bloqueios de agenda da Fase 13 (eram só eventos `admin_block`);
--   2. a garantia de que dois atendimentos não ocupam o mesmo horário (era o
--      `freeBusy`, que não segura duas marcações simultâneas — bot + tela).
--
-- Os bloqueios que estão hoje no Google são de teste e não são migrados.

-- ---------------------------------------------------------------------
-- schedule_blocks
-- ---------------------------------------------------------------------
-- Um intervalo único, vale para todos os locais (decisões da Fase 13).
-- `ends_at` é exclusivo: "dia inteiro" de 10/10 a 12/10 = 10/10 00h até
-- 13/10 00h, como já era gravado no Google.
create table schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz,
  updated_by uuid references auth.users (id) on delete set null,
  -- Remover não apaga a linha (histórico para a trilha de auditoria da
  -- Fase 22): só bloqueios com `removed_at` nulo ocupam a agenda.
  removed_at timestamptz,
  removed_by uuid references auth.users (id) on delete set null,
  constraint schedule_blocks_valid_range check (ends_at > starts_at)
);

create index schedule_blocks_active_period_idx
  on schedule_blocks (starts_at, ends_at)
  where removed_at is null;

alter table schedule_blocks enable row level security;

create policy "authenticated full access" on schedule_blocks
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- ---------------------------------------------------------------------
-- appointments.is_group_session
-- ---------------------------------------------------------------------
-- Turmas de exame (Fase 11, `exam_types.scheduling_mode = 'group'`)
-- compartilham o mesmo horário de propósito e ficam fora da trava abaixo —
-- a lotação delas já é garantida por `book_group_exam_session` (0012).
-- A trava não pode consultar `exam_types`, então a informação é copiada
-- para a linha do atendimento por um trigger (vale o modo do exame no
-- momento da marcação).
alter table appointments
  add column is_group_session boolean not null default false;

update appointments a
  set is_group_session = true
  from exam_types e
  where e.id = a.exam_type_id
    and a.appointment_type = 'exam'
    and e.scheduling_mode = 'group';

create or replace function set_appointment_is_group_session() returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.is_group_session := new.appointment_type = 'exam' and exists (
    select 1 from exam_types
      where id = new.exam_type_id
        and scheduling_mode = 'group'
  );
  return new;
end;
$$;

create trigger appointments_set_is_group_session
  before insert or update of exam_type_id, appointment_type on appointments
  for each row execute function set_appointment_is_group_session();

-- ---------------------------------------------------------------------
-- Trava contra dois atendimentos ativos no mesmo horário
-- ---------------------------------------------------------------------
-- `timestamptz + interval` é só STABLE para o Postgres (intervalos em dias/
-- meses dependem do fuso), e índice exige IMMUTABLE. Aqui o intervalo é
-- sempre em minutos, que não depende de fuso — por isso a função pode ser
-- declarada IMMUTABLE com segurança.
create or replace function appointment_period(p_scheduled_at timestamptz, p_duration_minutes integer)
returns tstzrange
language sql
immutable
parallel safe
as $$
  select tstzrange(p_scheduled_at, p_scheduled_at + make_interval(mins => p_duration_minutes), '[)');
$$;

-- Só a sobreposição real (sem o intervalo entre atendimentos, que é regra
-- de oferta de horários, aplicada no cálculo de slots). Violação = SQLSTATE
-- 23P01 (`exclusion_violation`).
alter table appointments
  add constraint appointments_no_overlap
  exclude using gist (appointment_period(scheduled_at, duration_minutes) with &&)
  where (status in ('scheduled', 'confirmed') and not is_group_session);
