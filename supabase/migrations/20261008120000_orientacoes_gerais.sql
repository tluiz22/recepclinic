-- Validação da F6.6 (cliente, 08/out/2026):
-- 1. O item "Mensagens personalizadas" vira dois: "Mensagens do bot" (a
--    conversa, vale na hora) e "Mensagens da Meta (templates)" (proposta,
--    revisão do Suporte e aprovação da Meta). Quem já tinha o item fica com os dois.
-- 2. Orientações gerais depois da marcação de uma consulta: um texto da
--    clínica (fora da matriz, sempre editável pelo Administrador), enviado uma
--    vez quando a confirmação chega ao celular, com a opção de envio em
--    Configurações › WhatsApp (desligada). Janela de 24h aberta: o texto;
--    fechada: o template com o link da página das orientações.

-- ---------------------------------------------------------------------------
-- Matriz de acesso
-- ---------------------------------------------------------------------------
update public.features set label = 'Mensagens do bot' where key = 'custom_messages';
insert into public.features (key, area, label, depends_on, sort_order) values
  ('custom_templates', 'whatsapp', 'Mensagens da Meta (templates)', '{}', 86);

insert into public.clinic_features (clinic_id, feature_key, enabled_by, enabled_at)
  select clinic_id, 'custom_templates', enabled_by, enabled_at
  from public.clinic_features
  where feature_key = 'custom_messages';

-- Propostas de template: agora com o item da Meta.
drop policy whatsapp_templates_proposal on public.whatsapp_templates;
drop policy whatsapp_templates_proposal_update on public.whatsapp_templates;

create policy whatsapp_templates_proposal on public.whatsapp_templates
  for insert to authenticated
  with check (
    stage = 'proposed' and version > 1
    and app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[])
    and app.clinic_has_feature(clinic_id, 'custom_templates')
  );

create policy whatsapp_templates_proposal_update on public.whatsapp_templates
  for update to authenticated
  using (
    version > 1
    and app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[])
    and app.clinic_has_feature(clinic_id, 'custom_templates')
  )
  with check (
    version > 1
    and app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[])
    and app.clinic_has_feature(clinic_id, 'custom_templates')
  );

-- ---------------------------------------------------------------------------
-- Orientações gerais: texto da clínica (em bot_messages), sempre editável
-- ---------------------------------------------------------------------------
alter table public.bot_messages drop constraint bot_messages_message_key_check;
alter table public.bot_messages add constraint bot_messages_message_key_check check (message_key in (
  'welcome', 'menu', 'not_understood', 'handoff', 'booking_link', 'cancel_done', 'presence_confirmed', 'idle_closed',
  'consultation_guidance'
));

-- As orientações podem ser mais longas que as falas do bot (texto do WhatsApp vai até 4096).
alter table public.bot_messages drop constraint bot_messages_body_check;
alter table public.bot_messages add constraint bot_messages_body_check check (
  length(trim(body)) > 0
  and length(body) <= case when message_key = 'consultation_guidance' then 3500 else 1024 end
);

drop policy bot_messages_admin on public.bot_messages;
create policy bot_messages_admin on public.bot_messages
  for all to authenticated
  using (
    app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[])
    and (message_key = 'consultation_guidance' or app.clinic_has_feature(clinic_id, 'custom_messages'))
  )
  with check (
    app.has_clinic_role(clinic_id, array['admin']::public.clinic_role[])
    and (message_key = 'consultation_guidance' or app.clinic_has_feature(clinic_id, 'custom_messages'))
  );

alter table public.clinic_settings
  add column guidance_enabled boolean not null default false;

alter table public.whatsapp_templates drop constraint whatsapp_templates_template_key_check;
alter table public.whatsapp_templates add constraint whatsapp_templates_template_key_check check (template_key in (
  'confirmation',
  'confirmation_return',
  'reschedule',
  'cancellation',
  'clinic_cancellation',
  'reminder',
  'exam_preparation',
  'consultation_guidance',
  'waitlist_offer',
  'daily_summary_consultations',
  'daily_summary_exams',
  'daily_summary_consultations_today',
  'daily_summary_exams_today'
));

-- Trilha: "Reenviar orientações" da Agenda.
alter table public.appointment_events drop constraint appointment_events_event_type_check;
alter table public.appointment_events add constraint appointment_events_event_type_check check (event_type in (
  'created',
  'rescheduled',           -- details: { from, to }
  'canceled',
  'presence_confirmed',
  'presence_unconfirmed',
  'attendance_recorded',   -- details: { status: 'completed' | 'no_show' }
  'attendance_corrected',  -- details: { from, to }
  'message_not_sent',      -- details: { kind, reason }
  'reminder_resent',
  'preparation_resent',
  'guidance_resent',
  'waitlist_joined',
  'waitlist_left',         -- details: { reason }
  'waitlist_advanced',     -- details: { from, to }
  'rebooking_dismissed'    -- a equipe parou de acompanhar a remarcação
));
