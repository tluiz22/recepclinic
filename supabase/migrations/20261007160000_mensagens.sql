-- F6.6 — Aba "Mensagens": prévia de cada mensagem e, com o item "Mensagens
-- personalizadas" (D11; D3b revista, cliente 05 e 07/out/2026), edição pelo
-- Administrador da clínica.

insert into public.features (key, area, label, depends_on, sort_order) values
  ('custom_messages', 'whatsapp', 'Mensagens personalizadas', '{}', 85);

-- ---------------------------------------------------------------------------
-- Templates com versões: a padrão é a 1 (texto no código, `body` nulo); a
-- proposta da clínica vira outra versão, com o texto próprio. O envio usa a
-- versão aprovada mais nova; recusada, segue a anterior.
-- ---------------------------------------------------------------------------
alter table public.whatsapp_templates drop constraint whatsapp_templates_clinic_id_template_key_key;
alter table public.whatsapp_templates
  add column version integer not null default 1 check (version > 0),
  -- Texto próprio da versão (marcadores já trocados por {{1}}, {{2}}…); nulo = o padrão.
  add column body text,
  -- proposed: aguardando o Suporte; declined: o Suporte recusou; meta: enviada (situação em `status`).
  add column stage text not null default 'meta' check (stage in ('proposed', 'declined', 'meta')),
  add column proposed_by uuid references auth.users (id) on delete set null,
  add column proposed_at timestamptz,
  add column support_note text,
  add unique (clinic_id, template_key, version);

-- O Administrador da clínica (com o item) propõe e retira a proposta; o resto
-- continua do Suporte e do bot (credencial da clínica).
create policy whatsapp_templates_proposal on public.whatsapp_templates
  for insert to authenticated
  with check (
    stage = 'proposed' and version > 1
    and app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[])
    and app.clinic_has_feature(clinic_id, 'custom_messages')
  );

create policy whatsapp_templates_proposal_update on public.whatsapp_templates
  for update to authenticated
  using (
    version > 1
    and app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[])
    and app.clinic_has_feature(clinic_id, 'custom_messages')
  )
  with check (
    version > 1
    and app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[])
    and app.clinic_has_feature(clinic_id, 'custom_messages')
  );

grant insert, update on public.whatsapp_templates to authenticated;

-- ---------------------------------------------------------------------------
-- Mensagens de conversa do bot com texto próprio da clínica (sem linha = padrão).
-- ---------------------------------------------------------------------------
create table public.bot_messages (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  message_key text not null check (message_key in (
    'welcome', 'menu', 'not_understood', 'handoff', 'booking_link', 'cancel_done', 'presence_confirmed', 'idle_closed'
  )),
  body text not null check (length(trim(body)) > 0 and length(body) <= 1024),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (clinic_id, message_key)
);

alter table public.bot_messages enable row level security;

create policy bot_messages_select on public.bot_messages
  for select to authenticated
  using (app.is_clinic_member(clinic_id));

create policy bot_messages_select_service on public.bot_messages
  for select to clinic_service
  using (clinic_id = app.service_clinic_id());

create policy bot_messages_admin on public.bot_messages
  for all to authenticated
  using (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]) and app.clinic_has_feature(clinic_id, 'custom_messages'))
  with check (app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[]) and app.clinic_has_feature(clinic_id, 'custom_messages'));

grant select on public.bot_messages to clinic_service;
grant select, insert, update, delete on public.bot_messages to authenticated;

create trigger bot_messages_set_updated_at before update on public.bot_messages
  for each row execute function app.set_updated_at();

-- Toda tabela com clinic_id registra as alterações do Suporte (isolamento, D6).
create trigger bot_messages_audit_platform_staff
  after insert or update or delete on public.bot_messages
  for each row execute function app.audit_platform_staff_write();
