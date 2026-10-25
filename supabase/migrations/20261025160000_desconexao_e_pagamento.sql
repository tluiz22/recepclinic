-- F8.3 — Conferências da conexão (cliente, 24 e 25/out/2026).
--
-- 1. Forma de pagamento: o Suporte marca "Forma de pagamento conferida"
--    (a Meta não tem API para isso); vale para a conta do WhatsApp (WABA) em
--    que foi conferida: conta nova, confere de novo. Até lá, o Administrador
--    vê o aviso no Início. Não trava nada.
-- 2. Desconectar pelo painel (Administrador ou Suporte): a conexão fica como
--    "Desconectado" e o token e o PIN saem do cofre. Trocar de número =
--    desconectar e conectar de novo.
-- 3. A Meta avisa que a clínica saiu (account_update: PARTNER_REMOVED e
--    afins): o webhook marca "Desconectado" sozinho, e o Início avisa o
--    Administrador até conectar de novo.

alter table public.whatsapp_connections
  add column payment_checked_at timestamptz,
  add column payment_checked_waba text,
  add column disconnected_at timestamptz,
  add column disconnected_via text check (disconnected_via in ('panel', 'meta'));

grant select (payment_checked_at, payment_checked_waba, disconnected_at, disconnected_via)
  on public.whatsapp_connections to authenticated, clinic_service;

-- Desconecta e tira os segredos do cofre (o painel ou a Meta).
create function app.disconnect_whatsapp(p_clinic_id uuid, p_via text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.whatsapp_connections%rowtype;
begin
  select * into v_row from public.whatsapp_connections where clinic_id = p_clinic_id for update;
  if not found or v_row.status = 'disconnected' then
    return false;
  end if;
  update public.whatsapp_connections
     set status = 'disconnected', disconnected_at = now(), disconnected_via = p_via,
         access_token_secret_id = null, pin_secret_id = null
   where clinic_id = p_clinic_id;
  delete from vault.secrets where id in (v_row.access_token_secret_id, v_row.pin_secret_id);
  return true;
end
$$;

revoke execute on function app.disconnect_whatsapp(uuid, text) from public, anon, authenticated, clinic_service;

-- Painel: "Desconectar WhatsApp" (Administrador da clínica ou Suporte).
create function public.disconnect_whatsapp(p_clinic_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_clinic_role(p_clinic_id, array['admin']::public.clinic_role[]) then
    raise exception 'Só o Administrador da clínica desconecta o WhatsApp.' using errcode = '42501';
  end if;
  return app.disconnect_whatsapp(p_clinic_id, 'panel');
end
$$;

-- Webhook (credencial da clínica): a Meta avisou que a clínica saiu.
create function public.mark_whatsapp_disconnected_by_meta()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid := app.service_clinic_id();
begin
  if v_clinic is null then
    raise exception 'Só com a credencial da clínica.' using errcode = '42501';
  end if;
  return app.disconnect_whatsapp(v_clinic, 'meta');
end
$$;

-- Suporte: forma de pagamento conferida (na conta atual) ou desmarcada.
create function public.set_whatsapp_payment_checked(p_clinic_id uuid, p_checked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_platform_staff() then
    raise exception 'Só o Suporte confere a forma de pagamento.' using errcode = '42501';
  end if;
  update public.whatsapp_connections
     set payment_checked_at = case when p_checked then now() end,
         payment_checked_waba = case when p_checked then waba_id end
   where clinic_id = p_clinic_id;
  if not found then
    raise exception 'A clínica não tem conexão do WhatsApp.' using errcode = '22023';
  end if;
end
$$;

revoke execute on function public.disconnect_whatsapp(uuid) from public, anon, clinic_service;
revoke execute on function public.mark_whatsapp_disconnected_by_meta() from public, anon, authenticated;
revoke execute on function public.set_whatsapp_payment_checked(uuid, boolean) from public, anon, clinic_service;
grant execute on function public.disconnect_whatsapp(uuid) to authenticated;
grant execute on function public.mark_whatsapp_disconnected_by_meta() to clinic_service;
grant execute on function public.set_whatsapp_payment_checked(uuid, boolean) to authenticated;

-- Conectar de novo (F8.1): limpa a desconexão; e o número desconectado de
-- outra clínica deixa de prender o número (a conexão antiga sai, com os
-- segredos). Mesmo corpo da F8.1, com essas duas mudanças.
create or replace function public.connect_whatsapp(
  p_clinic_id uuid,
  p_phone_number_id text,
  p_waba_id text,
  p_display_phone text,
  p_coexistence boolean,
  p_token text,
  p_pin text default null,
  p_contacts_synced boolean default false,
  p_history_synced boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.whatsapp_connections%rowtype;
  v_token_id uuid;
  v_pin_id uuid;
begin
  if not app.has_clinic_role(p_clinic_id, array['admin']::public.clinic_role[]) then
    raise exception 'Só o Administrador da clínica conecta o WhatsApp.' using errcode = '42501';
  end if;
  if coalesce(trim(p_phone_number_id), '') = '' or coalesce(trim(p_waba_id), '') = '' or coalesce(trim(p_token), '') = '' then
    raise exception 'Conexão do WhatsApp incompleta.' using errcode = '22023';
  end if;
  if p_pin is not null and p_pin !~ '^\d{6}$' then
    raise exception 'O PIN tem 6 números.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.whatsapp_connections
    where phone_number_id = trim(p_phone_number_id) and clinic_id <> p_clinic_id and status <> 'disconnected'
  ) then
    raise exception 'Este número do WhatsApp já está ligado a outra clínica.' using errcode = '23505';
  end if;
  delete from public.whatsapp_connections
   where phone_number_id = trim(p_phone_number_id) and clinic_id <> p_clinic_id and status = 'disconnected';

  select * into v_row from public.whatsapp_connections where clinic_id = p_clinic_id for update;
  v_token_id := v_row.access_token_secret_id;
  v_pin_id := v_row.pin_secret_id;

  if v_token_id is null then
    v_token_id := vault.create_secret(p_token, 'whatsapp_token_' || p_clinic_id::text || '_' || gen_random_uuid()::text, 'Token da Meta da clínica');
  else
    perform vault.update_secret(v_token_id, p_token);
  end if;

  if p_pin is null then
    if v_pin_id is not null then
      delete from vault.secrets where id = v_pin_id;
      v_pin_id := null;
    end if;
  elsif v_pin_id is null then
    v_pin_id := vault.create_secret(p_pin, 'whatsapp_pin_' || p_clinic_id::text || '_' || gen_random_uuid()::text, 'PIN do número da clínica');
  else
    perform vault.update_secret(v_pin_id, p_pin);
  end if;

  insert into public.whatsapp_connections as c (
    clinic_id, phone_number_id, waba_id, display_phone, status, connected_at, coexistence,
    connected_via, access_token_secret_id, pin_secret_id, contacts_synced_at, history_synced_at
  )
  values (
    p_clinic_id, trim(p_phone_number_id), trim(p_waba_id), nullif(trim(p_display_phone), ''), 'connected', now(),
    coalesce(p_coexistence, false), 'embedded_signup', v_token_id, v_pin_id,
    case when p_contacts_synced then now() end, case when p_history_synced then now() end
  )
  on conflict (clinic_id) do update set
    phone_number_id = excluded.phone_number_id,
    waba_id = excluded.waba_id,
    display_phone = excluded.display_phone,
    status = 'connected',
    connected_at = now(),
    coexistence = excluded.coexistence,
    connected_via = 'embedded_signup',
    access_token_secret_id = excluded.access_token_secret_id,
    pin_secret_id = excluded.pin_secret_id,
    contacts_synced_at = excluded.contacts_synced_at,
    history_synced_at = excluded.history_synced_at,
    disconnected_at = null,
    disconnected_via = null;
end
$$;
