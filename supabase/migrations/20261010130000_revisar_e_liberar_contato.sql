-- F9.6a — Ajustes da validação (cliente, 10/out/2026), na tela do contato:
--   - "Revisado": tira o contato de "Contatos para revisar" até ele atingir
--     um limite de novo (Recepção e Administrador);
--   - "Liberar dos limites do bot": o bot não aplica nenhum dos três limites
--     ao número até alguém desfazer (só o Administrador), para uma empresa com
--     acordo que marca vários pacientes.
-- O Suporte vale pelos dois papéis. Só pelas funções abaixo: a equipe edita o
-- contato, mas não estas colunas.

alter table public.contacts
  add column bot_limits_reviewed_at timestamptz,
  add column bot_limits_reviewed_by uuid references auth.users (id) on delete set null,
  add column bot_limits_exempt_at timestamptz,
  add column bot_limits_exempt_by uuid references auth.users (id) on delete set null;

create function app.guard_contact_bot_limits()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.bot_limits_reviewed_at, new.bot_limits_reviewed_by, new.bot_limits_exempt_at, new.bot_limits_exempt_by)
     is distinct from (old.bot_limits_reviewed_at, old.bot_limits_reviewed_by, old.bot_limits_exempt_at, old.bot_limits_exempt_by)
     and coalesce(current_setting('app.contact_bot_limits', true), '') <> 'on' then
    raise exception 'contato: revisão e liberação dos limites só pelas ações da tela' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger contacts_guard_bot_limits before update on public.contacts
  for each row execute function app.guard_contact_bot_limits();

create function public.mark_contact_bot_limits_reviewed(p_clinic_id uuid, p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_clinic_role(p_clinic_id, array['admin', 'reception']::public.clinic_role[]) then
    raise exception 'revisar contato: sem permissão' using errcode = '42501';
  end if;
  perform set_config('app.contact_bot_limits', 'on', true);
  update public.contacts
     set bot_limits_reviewed_at = now(), bot_limits_reviewed_by = (select auth.uid())
   where clinic_id = p_clinic_id and id = p_contact_id;
  if not found then
    raise exception 'revisar contato: não encontrado' using errcode = 'P0002';
  end if;
  perform set_config('app.contact_bot_limits', '', true);
end
$$;

create function public.set_contact_bot_limits_exempt(p_clinic_id uuid, p_contact_id uuid, p_exempt boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_clinic_role(p_clinic_id, array['admin']::public.clinic_role[]) then
    raise exception 'liberar contato: sem permissão' using errcode = '42501';
  end if;
  perform set_config('app.contact_bot_limits', 'on', true);
  update public.contacts
     set bot_limits_exempt_at = case when p_exempt then now() end,
         bot_limits_exempt_by = case when p_exempt then (select auth.uid()) end
   where clinic_id = p_clinic_id and id = p_contact_id;
  if not found then
    raise exception 'liberar contato: não encontrado' using errcode = 'P0002';
  end if;
  perform set_config('app.contact_bot_limits', '', true);
end
$$;

revoke execute on function public.mark_contact_bot_limits_reviewed(uuid, uuid) from public, anon, clinic_service;
revoke execute on function public.set_contact_bot_limits_exempt(uuid, uuid, boolean) from public, anon, clinic_service;
grant execute on function public.mark_contact_bot_limits_reviewed(uuid, uuid) to authenticated;
grant execute on function public.set_contact_bot_limits_exempt(uuid, uuid, boolean) to authenticated;
