-- Endereço do pagador na conta de cobrança (cliente, 07/nov/2026, validação no staging): o Checkout do Asaas
-- (cartão sem implantação e troca de cartão) exige o endereço do cliente. O Suporte preenche no cadastro e o
-- Administrador da clínica pode corrigir em Configurações › Assinatura (também com a clínica suspensa: a tabela
-- fica fora do bloqueio). O CEP preenche rua, bairro, cidade e UF pela busca (ViaCEP, no servidor); o Asaas
-- completa a cidade pelo CEP. Tudo ou nada: CEP, rua, número, bairro, cidade e UF juntos; complemento opcional.

alter table public.billing_accounts
  add column postal_code text check (postal_code is null or postal_code ~ '^\d{8}$'),
  add column street text check (street is null or length(street) between 1 and 200),
  add column address_number text check (address_number is null or length(address_number) between 1 and 20),
  add column address_complement text check (address_complement is null or length(address_complement) between 1 and 100),
  add column district text check (district is null or length(district) between 1 and 100),
  add column city text check (city is null or length(city) between 1 and 100),
  add column state text check (state is null or state ~ '^[A-Z]{2}$'),
  add constraint billing_accounts_address_complete check (
    (postal_code is null and street is null and address_number is null and address_complement is null
      and district is null and city is null and state is null)
    or (postal_code is not null and street is not null and address_number is not null
      and district is not null and city is not null and state is not null)
  );

-- A trilha guarda o endereço junto com o resto da conta.
create or replace function app.billing_account_snapshot(p_account public.billing_accounts)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_account.clinic_id is null then null else jsonb_build_object(
    'payer_name', p_account.payer_name,
    'payer_document', p_account.payer_document,
    'finance_email', p_account.finance_email,
    'finance_phone', p_account.finance_phone,
    'whatsapp_opt_in_at', p_account.whatsapp_opt_in_at,
    'whatsapp_opt_in_version', p_account.whatsapp_opt_in_version,
    'address', case when p_account.postal_code is null then null else jsonb_build_object(
      'postal_code', p_account.postal_code,
      'street', p_account.street,
      'number', p_account.address_number,
      'complement', p_account.address_complement,
      'district', p_account.district,
      'city', p_account.city,
      'state', p_account.state
    ) end
  ) end
$$;

-- Suporte ou Administrador da clínica: o endereço do pagador.
create function public.save_billing_address(
  p_clinic_id uuid,
  p_postal_code text,
  p_street text,
  p_number text,
  p_complement text,
  p_district text,
  p_city text,
  p_state text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.billing_accounts%rowtype;
  v_saved public.billing_accounts%rowtype;
  v_postal text := regexp_replace(coalesce(p_postal_code, ''), '\D', '', 'g');
  v_street text := trim(coalesce(p_street, ''));
  v_number text := trim(coalesce(p_number, ''));
  v_complement text := nullif(trim(coalesce(p_complement, '')), '');
  v_district text := trim(coalesce(p_district, ''));
  v_city text := trim(coalesce(p_city, ''));
  v_state text := upper(trim(coalesce(p_state, '')));
begin
  if not (app.is_platform_staff() or app.has_clinic_role(p_clinic_id, array['admin']::public.clinic_role[])) then
    raise exception 'Só o Suporte ou o Administrador da clínica altera o endereço do pagador.' using errcode = '42501';
  end if;
  if v_postal !~ '^\d{8}$' then
    raise exception 'Informe o CEP (8 números).' using errcode = 'P0001', hint = 'billing_postal_code';
  end if;
  if length(v_street) = 0 or length(v_street) > 200 then
    raise exception 'Informe a rua.' using errcode = 'P0001', hint = 'billing_street';
  end if;
  if length(v_number) = 0 or length(v_number) > 20 then
    raise exception 'Informe o número (ou S/N).' using errcode = 'P0001', hint = 'billing_address_number';
  end if;
  if length(coalesce(v_complement, '')) > 100 then
    raise exception 'Complemento longo demais (até 100 caracteres).' using errcode = 'P0001', hint = 'billing_address_complement';
  end if;
  if length(v_district) = 0 or length(v_district) > 100 then
    raise exception 'Informe o bairro.' using errcode = 'P0001', hint = 'billing_district';
  end if;
  if length(v_city) = 0 or length(v_city) > 100 then
    raise exception 'Informe a cidade.' using errcode = 'P0001', hint = 'billing_city';
  end if;
  if v_state !~ '^[A-Z]{2}$' then
    raise exception 'Informe a UF (2 letras).' using errcode = 'P0001', hint = 'billing_state';
  end if;

  select * into v_current from public.billing_accounts where clinic_id = p_clinic_id for update;
  if not found then
    raise exception 'A conta de cobrança ainda não foi cadastrada pelo Suporte.' using errcode = 'P0001', hint = 'billing_account_missing';
  end if;

  update public.billing_accounts
     set postal_code = v_postal, street = v_street, address_number = v_number, address_complement = v_complement,
         district = v_district, city = v_city, state = v_state,
         updated_by = (select auth.uid()), updated_at = now()
   where clinic_id = p_clinic_id
   returning * into v_saved;
  if app.billing_account_snapshot(v_saved) is distinct from app.billing_account_snapshot(v_current) then
    perform app.log_billing(p_clinic_id, 'account_updated', app.billing_account_snapshot(v_current), app.billing_account_snapshot(v_saved),
      'Endereço do pagador.');
  end if;
end
$$;
revoke execute on function public.save_billing_address(uuid, text, text, text, text, text, text, text) from public, anon, clinic_service;
grant execute on function public.save_billing_address(uuid, text, text, text, text, text, text, text) to authenticated;
