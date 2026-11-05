-- CU2 (Central de Atendimento, plano seção 14; tela P1, cliente, 05/nov/2026): tabela de preços da Meta com
-- vigência e contagem das mensagens por categoria.
--
-- Desde 01/out/2026 a Meta cobra cada mensagem que sai pela API: modelos (utilidade, autenticação) e mensagens de
-- serviço (assistente, avisos), estas com uma franquia grátis por mês e por número. Respostas pelo app do WhatsApp
-- (eco) não são cobradas. A fatura oficial fica no Gerenciador do WhatsApp da clínica: aqui é estimativa.
--
-- 1. `meta_price_versions`: cada linha é uma vigência (preços em reais, franquia, câmbio e fonte). Mudou o preço,
--    o Suporte cadastra uma vigência nova; o mês passado usa o preço daquele mês. Vigência já começada não muda
--    (sem UPDATE); só uma futura pode ser apagada. Vigência começa no dia 1º (a Meta muda no 1º dia do mês),
--    do mês atual em diante. Leitura: qualquer login
--    (a medição da clínica, CU4, usa os preços); escrita: só o Suporte.
-- 2. `meta_message_counts`: mensagens que saíram, por clínica e mês (fuso da clínica), em três grupos: modelos,
--    serviço e pelo app. Lida a cada abertura da tela, sem rotina; com a credencial de quem chama (RLS da
--    `whatsapp_messages`: membros da clínica e o Suporte).

create table public.meta_price_versions (
  id uuid primary key default gen_random_uuid(),
  valid_from date not null unique check (extract(day from valid_from) = 1),
  utility_brl numeric(10, 4) not null check (utility_brl >= 0),
  authentication_brl numeric(10, 4) not null check (authentication_brl >= 0),
  service_brl numeric(10, 4) not null check (service_brl >= 0),
  free_service_per_month integer not null check (free_service_per_month >= 0),
  usd_brl numeric(8, 4) not null check (usd_brl > 0),
  source text not null check (length(btrim(source)) between 3 and 300),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

comment on table public.meta_price_versions is
  'Preços da Meta no Brasil, em reais, por vigência (CU2). Estimativa; a fatura oficial é a do Gerenciador do WhatsApp.';

alter table public.meta_price_versions enable row level security;

create policy meta_price_versions_select on public.meta_price_versions for select to authenticated using (true);
create policy meta_price_versions_service on public.meta_price_versions for select to clinic_service using (true);
create policy meta_price_versions_insert on public.meta_price_versions for insert to authenticated
  with check (app.is_platform_staff() and valid_from >= date_trunc('month', now() at time zone 'America/Fortaleza')::date);
create policy meta_price_versions_delete on public.meta_price_versions for delete to authenticated
  using (app.is_platform_staff() and valid_from > (now() at time zone 'America/Fortaleza')::date);

grant select on public.meta_price_versions to authenticated, clinic_service;
grant insert (valid_from, utility_brl, authentication_brl, service_brl, free_service_per_month, usd_brl, source)
  on public.meta_price_versions to authenticated;
grant delete on public.meta_price_versions to authenticated;

-- Vigência inicial (T11, conferida em 05/nov/2026): R$ 0,0350 por mensagem (US$ 0,0068), 1.000 de serviço grátis,
-- câmbio R$ 5,15 (relação das tabelas da Meta; só a calculadora usa).
insert into public.meta_price_versions
  (valid_from, utility_brl, authentication_brl, service_brl, free_service_per_month, usd_brl, source)
values
  ('2026-10-01', 0.0350, 0.0350, 0.0350, 1000, 5.15,
   'Meta, página de preços do WhatsApp Business (USD 0,0068; tabela em reais), conferida em 05/nov/2026');

-- Mensagens que saíram (nem falha, nem pulada), por clínica e mês no fuso da clínica.
--   templates:   modelos (confirmação, lembrete, teste...): cobrados pelo preço de utilidade.
--   service:     texto livre do RecepClinic (assistente, avisos): cobrado acima da franquia.
--   app_replies: respostas pelo app do WhatsApp (eco, `agent_reply`/`app_auto_reply`): grátis.
create function public.meta_message_counts(p_from date, p_clinic_id uuid default null)
returns table (clinic_id uuid, month date, templates integer, service integer, app_replies integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.clinic_id, c.month, c.templates, c.service, c.app_replies
    from (
      select m.clinic_id,
             date_trunc('month', m.created_at at time zone coalesce(s.timezone, 'America/Fortaleza'))::date as month,
             count(*) filter (where m.message_type not in ('agent_reply', 'app_auto_reply') and m.template_name is not null)::integer as templates,
             count(*) filter (where m.message_type not in ('agent_reply', 'app_auto_reply') and m.template_name is null)::integer as service,
             count(*) filter (where m.message_type in ('agent_reply', 'app_auto_reply'))::integer as app_replies
        from public.whatsapp_messages m
        left join public.clinic_settings s on s.clinic_id = m.clinic_id
       where m.direction = 'outbound'
         and m.status is distinct from 'failed'
         and coalesce(m.status, '') not like 'skipped%'
         -- Margem de um dia para o fuso; o corte exato é o do mês, abaixo.
         and m.created_at >= p_from::timestamp - interval '1 day'
         and (p_clinic_id is null or m.clinic_id = p_clinic_id)
       group by 1, 2
    ) c
   where c.month >= p_from
$$;

grant execute on function public.meta_message_counts(date, uuid) to authenticated;
