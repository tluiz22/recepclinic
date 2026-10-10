-- F9.6b — Bloquear contato (cliente, 09 e 10/out/2026).
--
-- Na tela do contato, só o Administrador (e o Suporte): o bot deixa de
-- atender o número (responde neutro, uma vez por dia) e, na mesma
-- confirmação, pode cancelar sem aviso os atendimentos futuros dos pacientes
-- dele (o cancelamento, a saída da lista de espera e o fim das séries ficam
-- no código, com a trilha de cada atendimento). Dá para desbloquear.
-- O bloqueio só muda pela função abaixo; a resposta do dia é gravada pelo bot.

alter table public.contacts
  add column bot_blocked_at timestamptz,
  add column bot_blocked_by uuid references auth.users (id) on delete set null,
  add column bot_blocked_reason text check (length(bot_blocked_reason) <= 300),
  -- Última resposta neutra do bot ao número bloqueado (uma por dia).
  add column bot_blocked_notified_at timestamptz;

create index contacts_blocked_idx on public.contacts (clinic_id) where bot_blocked_at is not null;

create function app.guard_contact_bot_block()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.bot_blocked_at, new.bot_blocked_by, new.bot_blocked_reason)
     is distinct from (old.bot_blocked_at, old.bot_blocked_by, old.bot_blocked_reason)
     and coalesce(current_setting('app.contact_bot_block', true), '') <> 'on' then
    raise exception 'contato: bloqueio só pela ação da tela' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger contacts_guard_bot_block before update on public.contacts
  for each row execute function app.guard_contact_bot_block();

-- p_blocked = false desbloqueia (o motivo é apagado).
create function public.set_contact_bot_blocked(p_clinic_id uuid, p_contact_id uuid, p_blocked boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_clinic_role(p_clinic_id, array['admin']::public.clinic_role[]) then
    raise exception 'bloquear contato: sem permissão' using errcode = '42501';
  end if;
  perform set_config('app.contact_bot_block', 'on', true);
  update public.contacts
     set bot_blocked_at = case when p_blocked then now() end,
         bot_blocked_by = case when p_blocked then (select auth.uid()) end,
         bot_blocked_reason = case when p_blocked then nullif(trim(p_reason), '') end,
         bot_blocked_notified_at = null
   where clinic_id = p_clinic_id and id = p_contact_id;
  if not found then
    raise exception 'bloquear contato: não encontrado' using errcode = 'P0002';
  end if;
  perform set_config('app.contact_bot_block', '', true);
end
$$;

revoke execute on function public.set_contact_bot_blocked(uuid, uuid, boolean, text) from public, anon, clinic_service;
grant execute on function public.set_contact_bot_blocked(uuid, uuid, boolean, text) to authenticated;
