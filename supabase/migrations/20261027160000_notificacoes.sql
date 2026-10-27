-- F8.5c — Notificações do atendimento humano no celular (Web Push; cliente,
-- 27/out/2026): cada pessoa da equipe ativa no próprio aparelho; o sistema
-- avisa quando uma conversa passa a aguardar a clínica, lembra do "#bot" e
-- manda o resumo ao abrir o horário da recepção.

-- ---------------------------------------------------------------------------
-- Aparelhos inscritos
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Endereço do serviço de notificações do navegador (Apple, Google, Mozilla…).
  endpoint text not null check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  -- Nome do aparelho para a tela (ex.: "iPhone", "Chrome no Mac").
  device text,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  unique (clinic_id, endpoint)
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id, clinic_id);

alter table public.push_subscriptions enable row level security;

-- O próprio login: vê, ativa e desativa os seus aparelhos, nas clínicas de que é membro.
create policy push_subscriptions_own_select on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()) and app.is_clinic_member(clinic_id));
create policy push_subscriptions_own_insert on public.push_subscriptions
  for insert to authenticated with check (user_id = (select auth.uid()) and app.is_clinic_member(clinic_id));
create policy push_subscriptions_own_delete on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

-- Credencial da clínica (bot e rotina): lê para enviar, marca o envio e tira
-- os aparelhos que o serviço do navegador deu como vencidos.
create policy push_subscriptions_service_select on public.push_subscriptions
  for select to clinic_service using (clinic_id = app.service_clinic_id());
create policy push_subscriptions_service_update on public.push_subscriptions
  for update to clinic_service using (clinic_id = app.service_clinic_id()) with check (clinic_id = app.service_clinic_id());
create policy push_subscriptions_service_delete on public.push_subscriptions
  for delete to clinic_service using (clinic_id = app.service_clinic_id());

grant select, insert, delete on public.push_subscriptions to authenticated;

-- Alterações do Suporte ficam registradas, como nas outras tabelas da clínica.
create trigger push_subscriptions_audit_platform_staff after insert or update or delete on public.push_subscriptions
  for each row execute function app.audit_platform_staff_write();

-- ---------------------------------------------------------------------------
-- Conversa: o que já foi avisado na pausa em andamento
-- ---------------------------------------------------------------------------
-- Aviso de "aguardando" (um por vez que a conversa passa a aguardar) e
-- lembrete do "#bot" (um por período sem mensagens).
alter table public.conversation_state
  add column handoff_notified_at timestamptz,
  add column handoff_reminded_at timestamptz;

create or replace function app.conversation_handoff_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not new.human_handoff then
    new.human_handoff_at := null;
    new.handoff_reason := null;
    new.handoff_started_at := null;
    new.handoff_notified_at := null;
    new.handoff_reminded_at := null;
  else
    if new.human_handoff_at is null then
      new.human_handoff_at := now();
    end if;
    if new.handoff_started_at is null then
      new.handoff_started_at := new.human_handoff_at;
    end if;
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Resumo ao abrir o horário da recepção: um por dia
-- ---------------------------------------------------------------------------
alter table public.clinic_settings add column reception_summary_sent_on date;

-- A rotina (credencial da clínica) grava o dia do resumo; as configurações
-- continuam só do Administrador pelas telas.
create function public.mark_reception_summary_sent(p_date date)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.clinic_settings set reception_summary_sent_on = p_date where clinic_id = app.service_clinic_id();
$$;

revoke execute on function public.mark_reception_summary_sent(date) from public, anon, authenticated;
grant execute on function public.mark_reception_summary_sent(date) to clinic_service;

-- ---------------------------------------------------------------------------
-- Rotina: lembrete do "#bot" e resumo da abertura, a cada 5 minutos
-- ---------------------------------------------------------------------------
select cron.schedule('atendimento-humano', '*/5 * * * *', $$ select app.call_system_route('/api/cron/atendimento-humano') $$);
