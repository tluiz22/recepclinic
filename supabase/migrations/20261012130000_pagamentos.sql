-- F11.2 — Módulo financeiro: pagamentos do atendimento (sem nota ainda).
--
-- Regras do cliente (12/out/2026):
--   1. um atendimento pode ter vários pagamentos (parte no Pix e parte no
--      cartão, ou sinal antes e o restante no dia); cada um terá a sua nota
--      (F11.4);
--   2. só atendimento marcado, confirmado ou que compareceu recebe pagamento
--      novo; cancelado e falta mantêm os já feitos;
--   3. formas fixas: Pix, dinheiro, crédito e débito;
--   4. quem pagou: o contato, o próprio paciente ou outra pessoa; nome e CPF
--      ficam gravados no pagamento (a nota e a DMED não mudam se o cadastro
--      mudar). O CPF não é obrigatório aqui; a nota (F11.4) é que o exige;
--   5. corrigir é excluir e registrar de novo: o pagamento excluído sai das
--      somas mas fica guardado (quem e quando); nada é apagado de verdade;
--   6. privilégio mínimo, como na F11.1: o Administrador e a Recepção
--      registram e excluem; o Suporte só consulta; o Profissional e o bot não
--      veem;
--   7. a anonimização (F9.4) não apaga pagamentos (prazo fiscal).

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  appointment_id uuid not null,
  -- Copiado do atendimento (gatilho), para o histórico do paciente.
  patient_id uuid not null,
  amount_cents integer not null check (amount_cents > 0),
  method text not null check (method in ('pix', 'cash', 'credit_card', 'debit_card')),
  paid_on date not null,
  payer text not null check (payer in ('contact', 'patient', 'other')),
  payer_name text not null check (length(trim(payer_name)) > 0),
  payer_cpf text check (payer_cpf is null or app.is_valid_cpf(payer_cpf)),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null,
  unique (clinic_id, id),
  foreign key (clinic_id, appointment_id) references public.appointments (clinic_id, id),
  foreign key (clinic_id, patient_id) references public.patients (clinic_id, id)
);

create index payments_appointment_idx on public.payments (appointment_id) where deleted_at is null;
create index payments_patient_idx on public.payments (patient_id);
create index payments_clinic_paid_on_idx on public.payments (clinic_id, paid_on);

-- Inclusão: item liberado, atendimento que recebe pagamento (regra 2), data
-- até hoje (no fuso da clínica) e autoria. Alteração: só a exclusão (regra 5),
-- uma vez; o resto não muda.
create function app.payment_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.appointment_status;
  v_patient uuid;
  v_today date;
begin
  perform app.require_feature(new.clinic_id, 'finance');

  if tg_op = 'INSERT' then
    select status, patient_id into v_status, v_patient
      from public.appointments where clinic_id = new.clinic_id and id = new.appointment_id;
    if v_status is null then
      raise exception 'Atendimento não encontrado.' using errcode = 'P0001', hint = 'payment_appointment';
    end if;
    if v_status not in ('scheduled', 'confirmed', 'completed') then
      raise exception 'Atendimento cancelado ou com falta não recebe pagamento novo.' using errcode = 'P0001', hint = 'payment_appointment';
    end if;
    v_today := (now() at time zone (select timezone from public.clinic_settings where clinic_id = new.clinic_id))::date;
    if new.paid_on > v_today then
      raise exception 'A data do pagamento não pode ser futura.' using errcode = 'P0001', hint = 'payment_date';
    end if;
    new.patient_id := v_patient;
    new.payer_name := trim(new.payer_name);
    new.created_by := (select auth.uid());
    new.created_at := now();
    new.deleted_at := null;
    new.deleted_by := null;
    return new;
  end if;

  if old.deleted_at is not null then
    raise exception 'Este pagamento já foi excluído.' using errcode = 'P0001', hint = 'payment_deleted';
  end if;
  if new.deleted_at is null
    or (new.clinic_id, new.appointment_id, new.patient_id, new.amount_cents, new.method, new.paid_on, new.payer, new.payer_name, new.payer_cpf, new.created_by, new.created_at)
       is distinct from
       (old.clinic_id, old.appointment_id, old.patient_id, old.amount_cents, old.method, old.paid_on, old.payer, old.payer_name, old.payer_cpf, old.created_by, old.created_at) then
    raise exception 'Pagamento não se altera: exclua e registre de novo.' using errcode = 'P0001', hint = 'payment_immutable';
  end if;
  new.deleted_at := now();
  new.deleted_by := (select auth.uid());
  return new;
end
$$;

create trigger payments_rules before insert or update on public.payments
  for each row execute function app.payment_rules();

-- Registro do Suporte (F3), como toda tabela da clínica.
create trigger payments_audit_platform_staff
  after insert or update or delete on public.payments
  for each row execute function app.audit_platform_staff_write();

-- ---------------------------------------------------------------------------
-- RLS (regra 6). Sem política de exclusão: pagamento não se apaga (regra 5).
-- ---------------------------------------------------------------------------
alter table public.payments enable row level security;

create policy payments_select on public.payments
  for select to authenticated using (app.can_read_finance(clinic_id));
create policy payments_insert on public.payments
  for insert to authenticated with check (app.can_edit_finance(clinic_id));
create policy payments_update on public.payments
  for update to authenticated using (app.can_edit_finance(clinic_id)) with check (app.can_edit_finance(clinic_id));

revoke delete on public.payments from authenticated;
revoke all on public.payments from anon, clinic_service;
revoke execute on function app.payment_rules() from public, anon, authenticated, clinic_service;
