-- IS3 Checklist de implantação (cliente, 03/nov/2026; docs/implantacao-segura.md,
-- seção 5): na Situação da clínica (Sistema › Clínicas), os itens que o sistema
-- confere sozinho e os que o Suporte marca. "Ativar a clínica" só com os
-- obrigatórios: na tela, na rota e aqui no banco.
--
-- Esta tabela guarda só os itens marcados pelo Suporte (desmarcar = apagar a
-- linha). Obrigatórios: contract, facebook_login, whatsapp_business,
-- automations_off, card_default. Recomendados (não bloqueiam): agenda_import,
-- business_verification, support_number.
--
-- O banco confere na ativação (implantação → ativa, por login): os cinco
-- obrigatórios marcados, o convite do Administrador aceito, o WhatsApp conectado
-- e uma mensagem de teste entregue (IS2). Configuração mínima, templates
-- aprovados e o teste do bot ficam na tela e na rota (dependem do catálogo e
-- dos itens liberados). Sem login (service role, migrações, testes): livre.
--
-- Reversão: drop trigger clinics_guard_status_activation; drop function
-- app.guard_clinic_activation, app.clinic_activation_missing; drop table
-- public.clinic_onboarding_checks.

create table public.clinic_onboarding_checks (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  item_key text not null check (item_key in (
    'contract', 'facebook_login', 'whatsapp_business', 'automations_off', 'card_default',
    'agenda_import', 'business_verification', 'support_number'
  )),
  checked_by uuid references auth.users (id) on delete set null,
  checked_at timestamptz not null default now(),
  primary key (clinic_id, item_key)
);

comment on table public.clinic_onboarding_checks is
  'IS3: itens da checklist de implantação marcados pelo Suporte (desmarcar = apagar).';

alter table public.clinic_onboarding_checks enable row level security;

create policy clinic_onboarding_checks_select on public.clinic_onboarding_checks
  for select to authenticated using (app.is_clinic_member(clinic_id));
create policy clinic_onboarding_checks_insert on public.clinic_onboarding_checks
  for insert to authenticated with check (app.is_platform_staff());
create policy clinic_onboarding_checks_update on public.clinic_onboarding_checks
  for update to authenticated using (app.is_platform_staff()) with check (app.is_platform_staff());
create policy clinic_onboarding_checks_delete on public.clinic_onboarding_checks
  for delete to authenticated using (app.is_platform_staff());

revoke all on public.clinic_onboarding_checks from anon;
revoke truncate on public.clinic_onboarding_checks from authenticated;

create trigger clinic_onboarding_checks_audit_platform_staff
  after insert or update or delete on public.clinic_onboarding_checks
  for each row execute function app.audit_platform_staff_write();

-- O que falta para ativar, nos itens que o banco confere (vazio = pode ativar).
create function app.clinic_activation_missing(p_clinic_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_remove(array[
    case when not exists (select 1 from public.clinic_onboarding_checks c where c.clinic_id = p_clinic_id and c.item_key = 'contract')
      then 'contrato e termo assinados' end,
    case when not exists (select 1 from public.clinic_onboarding_checks c where c.clinic_id = p_clinic_id and c.item_key = 'facebook_login')
      then 'login do Facebook do Administrador' end,
    case when not exists (select 1 from public.clinic_onboarding_checks c where c.clinic_id = p_clinic_id and c.item_key = 'whatsapp_business')
      then 'número no WhatsApp Business' end,
    case when not exists (select 1 from public.clinic_onboarding_checks c where c.clinic_id = p_clinic_id and c.item_key = 'automations_off')
      then 'mensagens automáticas do app desligadas' end,
    case when not exists (select 1 from public.clinic_onboarding_checks c where c.clinic_id = p_clinic_id and c.item_key = 'card_default')
      then 'cartão definido como padrão na Meta' end,
    case when not exists (
      select 1 from public.clinic_invitations i
       where i.clinic_id = p_clinic_id and 'admin' = any (i.roles) and i.accepted_at is not null
    ) then 'convite do Administrador aceito' end,
    case when not exists (select 1 from public.whatsapp_connections w where w.clinic_id = p_clinic_id and w.status = 'connected')
      then 'WhatsApp conectado' end,
    case when not exists (
      select 1 from public.whatsapp_messages m
       where m.clinic_id = p_clinic_id and m.direction = 'outbound' and m.message_type = 'connection_test'
         and m.status in ('delivered', 'read')
    ) then 'mensagem de teste entregue' end
  ], null)
$$;

revoke execute on function app.clinic_activation_missing(uuid) from public, anon;
grant execute on function app.clinic_activation_missing(uuid) to authenticated;

create function app.guard_clinic_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  missing text[];
begin
  if old.status = 'onboarding' and new.status = 'active' and (select auth.uid()) is not null then
    missing := app.clinic_activation_missing(new.id);
    if cardinality(missing) > 0 then
      raise exception 'Ativar: falta %.', array_to_string(missing, ', ') using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

-- Depois de clinics_guard_status (ordem alfabética): quem não é do Suporte recebe o 42501 de sempre.
create trigger clinics_guard_status_activation
  before update of status on public.clinics
  for each row execute function app.guard_clinic_activation();
