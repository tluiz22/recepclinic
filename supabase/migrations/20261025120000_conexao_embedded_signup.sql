-- F8.1 — Conexão pelo Embedded Signup: o Administrador da clínica (ou o
-- Suporte) conecta o número pela janela da Meta. O servidor troca o código
-- pelo token, confere o número, inscreve o app e, na coexistência, pede as
-- duas sincronizações que a Meta exige em até 24 horas (o conteúdo é
-- descartado; cliente, 24/out). No número novo, só na API, o PIN de 6
-- números é sorteado e fica no cofre, sem ser mostrado (cliente, 25/out).

alter table public.whatsapp_connections
  add column connected_via text not null default 'support'
    check (connected_via in ('support', 'embedded_signup')),
  add column pin_secret_id uuid,
  add column contacts_synced_at timestamptz,
  add column history_synced_at timestamptz;

-- Leitura liberada coluna a coluna (os ids dos segredos ficam de fora).
grant select (connected_via, contacts_synced_at, history_synced_at)
  on public.whatsapp_connections to authenticated, clinic_service;

-- Os segredos (token e PIN) somem junto com a conexão.
create or replace function app.delete_whatsapp_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets
  where id in (old.access_token_secret_id, old.pin_secret_id);
  return null;
end
$$;

-- Grava a conexão feita pela janela da Meta, com o token (e o PIN) no cofre.
-- Só o Administrador da clínica ou o Suporte. O número é único entre as
-- clínicas: ligado a outra clínica, recusa.
create function public.connect_whatsapp(
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
    where phone_number_id = p_phone_number_id and clinic_id <> p_clinic_id
  ) then
    raise exception 'Este número do WhatsApp já está ligado a outra clínica.' using errcode = '23505';
  end if;

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
    history_synced_at = excluded.history_synced_at;
end
$$;

-- Sincronização da coexistência feita depois (nova tentativa dentro das 24 horas).
create function public.mark_whatsapp_synced(p_clinic_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_clinic_role(p_clinic_id, array['admin']::public.clinic_role[]) then
    raise exception 'Só o Administrador da clínica conecta o WhatsApp.' using errcode = '42501';
  end if;
  if p_kind = 'contacts' then
    update public.whatsapp_connections set contacts_synced_at = coalesce(contacts_synced_at, now()) where clinic_id = p_clinic_id;
  elsif p_kind = 'history' then
    update public.whatsapp_connections set history_synced_at = coalesce(history_synced_at, now()) where clinic_id = p_clinic_id;
  else
    raise exception 'Sincronização desconhecida.' using errcode = '22023';
  end if;
end
$$;

revoke execute on function public.connect_whatsapp(uuid, text, text, text, boolean, text, text, boolean, boolean) from public, anon, clinic_service;
revoke execute on function public.mark_whatsapp_synced(uuid, text) from public, anon, clinic_service;
grant execute on function public.connect_whatsapp(uuid, text, text, text, boolean, text, text, boolean, boolean) to authenticated;
grant execute on function public.mark_whatsapp_synced(uuid, text) to authenticated;
