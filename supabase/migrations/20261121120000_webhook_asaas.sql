-- F12.5 — Faturamento do SaaS: webhook do Asaas, fila de eventos e conciliação.
--
-- Plano em docs/planejamento-faturamento-saas.md (seção 5, recomendações 4, 5 e
-- 7; fluxos 5 e 11; decisão 11.2):
--   1. o webhook confere o token, grava o evento (id do Asaas único: repetido é
--      ignorado), responde 200 e processa depois (na hora, em segundo plano, e
--      pela rotina, que pega o que ficou);
--   2. processar = consultar a cobrança na API do Asaas (o estado real, nunca o
--      do aviso) e atualizar o espelho; a ordem dos eventos não importa;
--   3. evento sem cobrança nossa (outra conta, outra integração) fica
--      "ignorado"; erro fica "falhou" e é tentado de novo até 10 vezes;
--   4. conciliação diária: todo contrato automático aceito é sincronizado de
--      novo (corrige o que o webhook perdeu e refaz a criação que falhou);
--   5. só a service role grava e lê a fila; o Suporte lê.

create table public.billing_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  event text not null,
  resource_id text,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'processed', 'ignored', 'failed')),
  attempts integer not null default 0,
  last_error text check (last_error is null or length(last_error) <= 1000)
);

create index billing_provider_events_open_idx on public.billing_provider_events (received_at) where status in ('pending', 'failed');

-- Grava o evento (regra 1); devolve o id interno, ou nulo se já existia.
create function public.billing_record_provider_event(p_provider_event_id text, p_event text, p_resource_id text, p_payload jsonb)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.billing_provider_events (provider_event_id, event, resource_id, payload)
  values (p_provider_event_id, p_event, p_resource_id, coalesce(p_payload, '{}'::jsonb))
  on conflict (provider_event_id) do nothing
  returning id
$$;

-- Eventos a processar (regra 3), os mais antigos primeiro.
create function public.billing_open_provider_events(p_limit integer)
returns setof public.billing_provider_events
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.billing_provider_events
   where status = 'pending' or (status = 'failed' and attempts < 10)
   order by received_at
   limit greatest(1, least(coalesce(p_limit, 50), 500))
$$;

create function public.billing_finish_provider_event(p_id uuid, p_status text, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.billing_provider_events
     set status = p_status,
         attempts = attempts + 1,
         processed_at = case when p_status in ('processed', 'ignored') then now() else processed_at end,
         last_error = left(nullif(trim(coalesce(p_error, '')), ''), 1000)
   where id = p_id and p_status in ('processed', 'ignored', 'failed')
$$;

-- Contrato da cobrança: pela assinatura ou pela referência da implantação ("setup:<contrato>").
create function public.billing_contract_for_payment(p_subscription_id text, p_external_reference text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select id from public.billing_contracts where p_subscription_id is not null and asaas_subscription_id = p_subscription_id),
    (select id from public.billing_contracts
      where p_external_reference ~ '^setup:[0-9a-f-]{36}$' and id = substring(p_external_reference from 7)::uuid)
  )
$$;

-- Contratos da conciliação (regra 4).
create function public.billing_contracts_to_reconcile()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.billing_contracts
   where status = 'active' and billing_mode = 'asaas' and acceptance in ('explicit', 'tacit')
   order by activated_at
$$;

alter table public.billing_provider_events enable row level security;
create policy billing_provider_events_select on public.billing_provider_events
  for select to authenticated using (app.is_platform_staff());
revoke insert, update, delete, truncate on public.billing_provider_events from authenticated;
revoke all on public.billing_provider_events from anon, clinic_service;

revoke execute on function public.billing_record_provider_event(text, text, text, jsonb) from public, anon, authenticated, clinic_service;
revoke execute on function public.billing_open_provider_events(integer) from public, anon, authenticated, clinic_service;
revoke execute on function public.billing_finish_provider_event(uuid, text, text) from public, anon, authenticated, clinic_service;
revoke execute on function public.billing_contract_for_payment(text, text) from public, anon, authenticated, clinic_service;
revoke execute on function public.billing_contracts_to_reconcile() from public, anon, authenticated, clinic_service;
grant execute on function public.billing_record_provider_event(text, text, text, jsonb) to service_role;
grant execute on function public.billing_open_provider_events(integer) to service_role;
grant execute on function public.billing_finish_provider_event(uuid, text, text) to service_role;
grant execute on function public.billing_contract_for_payment(text, text) to service_role;
grant execute on function public.billing_contracts_to_reconcile() to service_role;

-- Rotinas: a fila a cada 10 minutos; a conciliação uma vez por dia, às 6h15 de Brasília (9h15 UTC).
select cron.schedule('faturamento-eventos', '*/10 * * * *', $$ select app.call_system_route('/api/cron/faturamento-eventos') $$);
select cron.schedule('conciliacao-asaas', '15 9 * * *', $$ select app.call_system_route('/api/cron/conciliacao-asaas') $$);
