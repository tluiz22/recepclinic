-- F1 da recepção digital integrada (docs/implementacao-recepcao-digital.md, cliente, 08/nov/2026):
-- a base do portal de agendamento, sem tela pública.
--
--   1. Matriz: item "Portal de agendamento" (decide só se a clínica tem os links do portal); o bot passa
--      a depender dele (seção 1.1) e toda clínica que já tem o bot ganha o Portal ligado (I6);
--   2. apelidos do endereço do portal: o da clínica (o Suporte escolhe, RD1) e o do profissional
--      (automático pelo nome, fixo, "-2" se repetido na clínica; cliente, 08/nov);
--   3. "Mostrar no portal" e "Atende particular" (só convênio) no profissional;
--   4. observação por convênio na ligação profissional × convênio (autorização, carteirinha…);
--   5. canal "portal" do atendimento e a entrada/lugar de onde veio (Métricas, R5);
--   6. prazos do portal por clínica: reserva (3 a 10 min, padrão 5; RD4) e antecedência para
--      cancelar/remarcar pelo portal (padrão 24 h; RD10).

-- ---------------------------------------------------------------------------
-- 1. Matriz
-- ---------------------------------------------------------------------------
insert into public.features (key, area, label, depends_on, sort_order)
  values ('portal', 'agenda', 'Portal de agendamento', '{}', 45);

update public.features set depends_on = '{portal}' where key = 'whatsapp_bot';

insert into public.clinic_features (clinic_id, feature_key, enabled_by)
  select clinic_id, 'portal', null from public.clinic_features where feature_key = 'whatsapp_bot'
  on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Apelidos
-- ---------------------------------------------------------------------------
-- "Dra. Ana Lima" → "dra-ana-lima" (sem acento, só letras, números e hífen, até 60).
create function app.portal_slug_of(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(left(trim(both '-' from regexp_replace(lower(extensions.unaccent(coalesce(p_text, ''))), '[^a-z0-9]+', '-', 'g')), 60), ''),
    'profissional')
$$;

revoke execute on function app.portal_slug_of(text) from public, anon;
grant execute on function app.portal_slug_of(text) to authenticated, clinic_service;

alter table public.clinics
  add column portal_slug text unique
    check (portal_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(portal_slug) between 3 and 60);

alter table public.professionals
  add column portal_slug text,
  add column show_in_portal boolean not null default true,
  add column accepts_private boolean not null default true;

-- Os de hoje, na ordem do cadastro: o primeiro nome repetido fica sem número.
with numbered as (
  select id, app.portal_slug_of(display_name) as base,
         row_number() over (partition by clinic_id, app.portal_slug_of(display_name) order by created_at, id) as n
    from public.professionals
)
update public.professionals p
   set portal_slug = case when numbered.n = 1 then numbered.base else left(numbered.base, 56) || '-' || numbered.n end
  from numbered
 where numbered.id = p.id;

-- O padrão vazio só deixa o cadastro sem informar o apelido: o gatilho abaixo sempre o preenche antes da checagem.
alter table public.professionals
  alter column portal_slug set default '',
  alter column portal_slug set not null,
  add constraint professionals_portal_slug_format check (portal_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  add constraint professionals_clinic_portal_slug_key unique (clinic_id, portal_slug);

-- Novo: apelido pelo nome; repetido ganha -2, -3… Depois, ninguém muda (o link nunca quebra).
create function app.professional_portal_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_slug text;
  v_n integer := 1;
begin
  if tg_op = 'UPDATE' then
    if new.portal_slug is distinct from old.portal_slug then
      raise exception 'O endereço do profissional no portal não muda depois de criado.' using errcode = '42501';
    end if;
    return new;
  end if;
  v_base := app.portal_slug_of(new.display_name);
  v_slug := v_base;
  while exists (select 1 from public.professionals where clinic_id = new.clinic_id and portal_slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := left(v_base, 56) || '-' || v_n;
  end loop;
  -- Dois cadastros ao mesmo tempo com o mesmo nome: a chave única recusa o segundo, que tenta de novo.
  new.portal_slug := v_slug;
  return new;
end
$$;

revoke execute on function app.professional_portal_slug() from public, anon, authenticated, clinic_service;

create trigger professionals_portal_slug
  before insert or update of portal_slug on public.professionals
  for each row execute function app.professional_portal_slug();

-- O apelido da clínica: só o Suporte (RD1); vazio tira a clínica do endereço.
create function public.set_clinic_portal_slug(p_clinic_id uuid, p_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text := nullif(btrim(lower(coalesce(p_slug, ''))), '');
begin
  if not (app.is_platform_staff() or (select auth.role()) = 'service_role') then
    raise exception 'Só o Administrador do sistema muda o endereço da clínica no portal.' using errcode = '42501';
  end if;
  if v_slug is not null and not (v_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(v_slug) between 3 and 60) then
    raise exception 'Endereço inválido: use de 3 a 60 letras minúsculas, números e hífen.' using errcode = '22023';
  end if;
  if v_slug is not null and exists (select 1 from public.clinics where portal_slug = v_slug and id <> p_clinic_id) then
    raise exception 'Esse endereço já é de outra clínica.' using errcode = '23505', hint = 'portal_slug_taken';
  end if;
  update public.clinics set portal_slug = v_slug, updated_at = now() where id = p_clinic_id;
  if not found then
    raise exception 'Clínica não encontrada.' using errcode = 'P0002';
  end if;
end
$$;

revoke execute on function public.set_clinic_portal_slug(uuid, text) from public, anon, clinic_service;
grant execute on function public.set_clinic_portal_slug(uuid, text) to authenticated, service_role;

-- "Atende particular" anda com os convênios: quem mantém os convênios (Administrador, quem ele autoriza em Equipe)
-- e o próprio profissional mudam, sem precisar mexer no resto do cadastro.
create function public.set_professional_accepts_private(p_clinic_id uuid, p_professional_id uuid, p_accepts boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- coalesce: quem não é profissional tem own_professional_id nulo, e "not (false or null)" deixaria passar.
  if not coalesce(app.can_manage_insurance(p_clinic_id) or p_professional_id = app.own_professional_id(p_clinic_id), false) then
    raise exception 'Sem permissão para mudar os convênios do profissional.' using errcode = '42501';
  end if;
  update public.professionals set accepts_private = coalesce(p_accepts, true), updated_at = now()
   where clinic_id = p_clinic_id and id = p_professional_id;
  if not found then
    raise exception 'Profissional não encontrado.' using errcode = 'P0002';
  end if;
end
$$;

revoke execute on function public.set_professional_accepts_private(uuid, uuid, boolean) from public, anon, clinic_service;
grant execute on function public.set_professional_accepts_private(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Observação por convênio
-- ---------------------------------------------------------------------------
alter table public.professional_insurance_plans
  add column note text check (note is null or (length(btrim(note)) between 1 and 300));

grant update (note) on public.professional_insurance_plans to authenticated;

create policy professional_insurance_plans_update on public.professional_insurance_plans for update to authenticated
  using (app.can_manage_insurance(clinic_id)) with check (app.can_manage_insurance(clinic_id));
create policy professional_insurance_plans_update_own on public.professional_insurance_plans for update to authenticated
  using (professional_id = app.own_professional_id(clinic_id)) with check (professional_id = app.own_professional_id(clinic_id));

alter table public.insurance_change_log drop constraint insurance_change_log_action_check;
alter table public.insurance_change_log add constraint insurance_change_log_action_check
  check (action in ('plan_created', 'plan_updated', 'plan_deleted', 'linked', 'unlinked', 'note_updated'));

create or replace function app.log_insurance_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record := case when tg_op = 'DELETE' then old else new end;
begin
  -- Clínica apagada (a cascata leva tudo junto): não registra.
  if not exists (select 1 from public.clinics where id = v_row.clinic_id) then return null; end if;
  if tg_table_name = 'insurance_plans' then
    insert into public.insurance_change_log (clinic_id, actor_user_id, action, insurance_plan_id)
      values (v_row.clinic_id, (select auth.uid()),
              case tg_op when 'INSERT' then 'plan_created' when 'UPDATE' then 'plan_updated' else 'plan_deleted' end, v_row.id);
  else
    insert into public.insurance_change_log (clinic_id, actor_user_id, action, insurance_plan_id, professional_id)
      values (v_row.clinic_id, (select auth.uid()),
              case tg_op when 'INSERT' then 'linked' when 'UPDATE' then 'note_updated' else 'unlinked' end,
              v_row.insurance_plan_id, v_row.professional_id);
  end if;
  return null;
end
$$;

create trigger professional_insurance_plans_note_log after update of note on public.professional_insurance_plans
  for each row when (new.note is distinct from old.note) execute function app.log_insurance_change();

-- ---------------------------------------------------------------------------
-- 5. Canal e origem
-- ---------------------------------------------------------------------------
alter type public.action_channel add value if not exists 'portal';

-- Entrada (R5, filtro "Entrada"): link do bot na conversa, link da clínica ou de profissional.
-- Lugar (R7, "?de="): onde o link foi posto; sem marca = não informado.
alter table public.appointments
  add column portal_entry text check (portal_entry in ('whatsapp', 'clinic_link', 'professional_link')),
  add column portal_place text check (portal_place in ('instagram', 'site', 'google', 'message', 'poster', 'other'));

-- ---------------------------------------------------------------------------
-- 6. Prazos do portal
-- ---------------------------------------------------------------------------
alter table public.clinic_settings
  add column portal_hold_minutes smallint not null default 5 check (portal_hold_minutes between 3 and 10),
  add column portal_cancel_lead_hours smallint not null default 24 check (portal_cancel_lead_hours between 0 and 168);
