-- N3a — Tomador da nota pelo Asaas: e-mail e endereço de quem paga
-- (planejamento-nfse-asaas.md, seção 13.6, decisão do cliente de 29/out/2026).
--
--   1. o Asaas só autoriza a nota com e-mail e endereço completo (CEP, rua,
--      número, bairro) do tomador;
--   2. ficam no Financeiro do contato (contact_finance) e do paciente
--      (patient_finance: do próprio paciente ou da outra pessoa que paga);
--      não são obrigatórios para registrar o pagamento: são pedidos só ao
--      emitir a nota, como o CPF;
--   3. também ficam no pagamento (retrato, como nome e CPF), para a nota não
--      mudar se o cadastro mudar. O pagamento segue sem alteração, fora estes
--      campos, gravados por set_payment_payer_contact enquanto não há nota
--      ativa;
--   4. tudo ou nada no endereço (complemento opcional); a anonimização já
--      apaga as linhas do Financeiro.
--
-- Reversão: drop das colunas novas e da função; restaurar app.payment_rules
-- da 20261012130000.

alter table public.contact_finance
  add column email text check (email is null or (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 200)),
  add column postal_code text check (postal_code is null or postal_code ~ '^[0-9]{8}$'),
  add column street text check (street is null or length(trim(street)) between 1 and 200),
  add column address_number text check (address_number is null or length(trim(address_number)) between 1 and 20),
  add column address_complement text check (address_complement is null or length(address_complement) <= 100),
  add column district text check (district is null or length(trim(district)) between 1 and 100),
  add constraint contact_finance_address_complete check (
    (postal_code is null and street is null and address_number is null and address_complement is null and district is null)
    or (postal_code is not null and street is not null and address_number is not null and district is not null)
  );

alter table public.patient_finance
  add column payer_email text check (payer_email is null or (payer_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(payer_email) <= 200)),
  add column payer_postal_code text check (payer_postal_code is null or payer_postal_code ~ '^[0-9]{8}$'),
  add column payer_street text check (payer_street is null or length(trim(payer_street)) between 1 and 200),
  add column payer_address_number text check (payer_address_number is null or length(trim(payer_address_number)) between 1 and 20),
  add column payer_address_complement text check (payer_address_complement is null or length(payer_address_complement) <= 100),
  add column payer_district text check (payer_district is null or length(trim(payer_district)) between 1 and 100),
  add constraint patient_finance_payer_address_complete check (
    (payer_postal_code is null and payer_street is null and payer_address_number is null and payer_address_complement is null and payer_district is null)
    or (payer_postal_code is not null and payer_street is not null and payer_address_number is not null and payer_district is not null)
  );

alter table public.payments
  add column payer_email text check (payer_email is null or (payer_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(payer_email) <= 200)),
  add column payer_postal_code text check (payer_postal_code is null or payer_postal_code ~ '^[0-9]{8}$'),
  add column payer_street text check (payer_street is null or length(trim(payer_street)) between 1 and 200),
  add column payer_address_number text check (payer_address_number is null or length(trim(payer_address_number)) between 1 and 20),
  add column payer_address_complement text check (payer_address_complement is null or length(payer_address_complement) <= 100),
  add column payer_district text check (payer_district is null or length(trim(payer_district)) between 1 and 100),
  add constraint payments_payer_address_complete check (
    (payer_postal_code is null and payer_street is null and payer_address_number is null and payer_address_complement is null and payer_district is null)
    or (payer_postal_code is not null and payer_street is not null and payer_address_number is not null and payer_district is not null)
  );

-- O pagamento segue imutável, fora o contato do tomador gravado pela função
-- abaixo (marca local da transação).
create or replace function app.payment_rules()
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
  -- Contato do tomador (N3a): só pela função, sem mexer no resto.
  if new.deleted_at is null and coalesce(current_setting('app.payer_contact_edit', true), '') = 'on'
     and (new.clinic_id, new.appointment_id, new.patient_id, new.amount_cents, new.method, new.paid_on, new.payer, new.payer_name, new.payer_cpf, new.created_by, new.created_at)
         is not distinct from
         (old.clinic_id, old.appointment_id, old.patient_id, old.amount_cents, old.method, old.paid_on, old.payer, old.payer_name, old.payer_cpf, old.created_by, old.created_at) then
    return new;
  end if;
  if new.deleted_at is null
    or (new.clinic_id, new.appointment_id, new.patient_id, new.amount_cents, new.method, new.paid_on, new.payer, new.payer_name, new.payer_cpf, new.created_by, new.created_at,
        new.payer_email, new.payer_postal_code, new.payer_street, new.payer_address_number, new.payer_address_complement, new.payer_district)
       is distinct from
       (old.clinic_id, old.appointment_id, old.patient_id, old.amount_cents, old.method, old.paid_on, old.payer, old.payer_name, old.payer_cpf, old.created_by, old.created_at,
        old.payer_email, old.payer_postal_code, old.payer_street, old.payer_address_number, old.payer_address_complement, old.payer_district) then
    raise exception 'Pagamento não se altera: exclua e registre de novo.' using errcode = 'P0001', hint = 'payment_immutable';
  end if;
  new.deleted_at := now();
  new.deleted_by := (select auth.uid());
  return new;
end
$$;

-- Grava o e-mail e o endereço de quem pagou no pagamento (antes de emitir) e
-- no Financeiro de onde ele veio (contato ou paciente).
create function public.set_payment_payer_contact(
  p_payment_id uuid, p_email text, p_postal_code text, p_street text, p_number text, p_complement text, p_district text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_contact uuid;
  v_email text := lower(trim(p_email));
  v_cep text := regexp_replace(coalesce(p_postal_code, ''), '\D', '', 'g');
  v_complement text := nullif(trim(coalesce(p_complement, '')), '');
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if v_payment.id is null or not app.can_edit_finance(v_payment.clinic_id) then
    raise exception 'Pagamento não encontrado.' using errcode = '42501';
  end if;
  if v_payment.deleted_at is not null then
    raise exception 'Este pagamento já foi excluído.' using errcode = 'P0001', hint = 'payment_deleted';
  end if;
  if exists (select 1 from public.nfse_invoices where payment_id = p_payment_id and status in ('issuing', 'issued', 'canceling')) then
    raise exception 'Este pagamento já tem nota: o tomador não muda.' using errcode = 'P0001', hint = 'nfse_active';
  end if;

  perform set_config('app.payer_contact_edit', 'on', true);
  update public.payments set
    payer_email = v_email, payer_postal_code = v_cep, payer_street = trim(p_street), payer_address_number = trim(p_number),
    payer_address_complement = v_complement, payer_district = trim(p_district)
   where id = p_payment_id;
  perform set_config('app.payer_contact_edit', 'off', true);

  if v_payment.payer = 'contact' then
    select contact_id into v_contact from public.patients where id = v_payment.patient_id;
    insert into public.contact_finance (clinic_id, contact_id, email, postal_code, street, address_number, address_complement, district)
    values (v_payment.clinic_id, v_contact, v_email, v_cep, trim(p_street), trim(p_number), v_complement, trim(p_district))
    on conflict (contact_id) do update set email = excluded.email, postal_code = excluded.postal_code, street = excluded.street,
      address_number = excluded.address_number, address_complement = excluded.address_complement, district = excluded.district;
  else
    -- Paciente ou outra pessoa: só se o responsável cadastrado ainda é o mesmo do pagamento.
    update public.patient_finance set
      payer_email = v_email, payer_postal_code = v_cep, payer_street = trim(p_street), payer_address_number = trim(p_number),
      payer_address_complement = v_complement, payer_district = trim(p_district)
     where patient_id = v_payment.patient_id and payer = v_payment.payer
       and (v_payment.payer = 'patient' or payer_cpf is not distinct from v_payment.payer_cpf);
  end if;
end
$$;

revoke execute on function public.set_payment_payer_contact(uuid, text, text, text, text, text, text) from public, anon, clinic_service;
grant execute on function public.set_payment_payer_contact(uuid, text, text, text, text, text, text) to authenticated;
