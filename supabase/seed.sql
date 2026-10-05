-- Dados de teste LOCAIS (carregados por `npm run db:reset` e pelo `supabase start`).
-- Duas clínicas fictícias, com dados em todas as tabelas, para desenvolver as
-- telas e o bot e para a varredura de isolamento (tests/db/isolamento.test.ts).
--
-- Logins (senha de todos: recepclinic-local) — só para o ambiente local:
--   Clínica Exemplo Saúde
--     admin@exemplo-saude.local           Administrador
--     pediatra@exemplo-saude.local        Profissional (pediatra)
--     psicologa@exemplo-saude.local       Profissional (psicóloga)
--     fisio@exemplo-saude.local           Profissional (fisioterapeuta)
--     recepcao@exemplo-saude.local        Recepção (todas as agendas)
--     recepcao2@exemplo-saude.local       Recepção restrita (psicóloga e fisioterapeuta)
--   Odonto Exemplo
--     admin@odonto-exemplo.local          Administrador + Profissional (dentista)
--     recepcao@odonto-exemplo.local       Recepção
--   Plataforma
--     suporte@recepclinic.local           Suporte RecepClinic

do $$
declare
  -- Clínicas
  c_a constant uuid := '0a000000-0000-4000-8000-000000000001';
  c_b constant uuid := '0b000000-0000-4000-8000-000000000001';
  -- Logins
  u_a_admin constant uuid := 'aa000000-0000-4000-8000-000000000001';
  u_a_ped constant uuid := 'aa000000-0000-4000-8000-000000000002';
  u_a_psi constant uuid := 'aa000000-0000-4000-8000-000000000003';
  u_a_fis constant uuid := 'aa000000-0000-4000-8000-000000000004';
  u_a_rec constant uuid := 'aa000000-0000-4000-8000-000000000005';
  u_a_rec2 constant uuid := 'aa000000-0000-4000-8000-000000000006';
  u_b_admin constant uuid := 'bb000000-0000-4000-8000-000000000001';
  u_b_rec constant uuid := 'bb000000-0000-4000-8000-000000000002';
  u_support constant uuid := 'cc000000-0000-4000-8000-000000000001';

  tz constant text := 'America/Fortaleza';
  -- Próxima segunda-feira (fuso de Fortaleza): os atendimentos ficam sempre no futuro.
  monday date := (date_trunc('week', (now() at time zone 'America/Fortaleza')) + interval '7 days')::date;

  v_user record;
  -- Clínica A
  p_ped uuid; p_psi uuid; p_fis uuid;
  l_office uuid; l_home uuid;
  ag_ped uuid; ag_psi uuid; ag_fis uuid; ag_exams uuid;
  s_consulta uuid; s_retorno uuid; s_avaliacao uuid; s_psi uuid; s_fis uuid; s_espiro uuid;
  ip_unimed uuid; ip_bradesco uuid; ip_hapvida uuid;
  ct_maria uuid; ct_carlos uuid; ct_julia uuid;
  pt_joao uuid; pt_ana uuid; pt_carlos uuid; pt_julia uuid;
  ser_psi uuid;
  ap_first uuid; ap_past uuid; ap_waiting uuid; ap_canceled uuid; ap_session uuid;
  e_waiting uuid; op_id uuid;
  v_secret uuid;
  -- Clínica B
  p_dent uuid; l_b uuid; ag_b uuid; s_b uuid; ct_b uuid; pt_b uuid;
begin
  -- -------------------------------------------------------------------------
  -- Logins (Auth local)
  -- -------------------------------------------------------------------------
  for v_user in
    select * from (values
      (u_a_admin, 'admin@exemplo-saude.local'),
      (u_a_ped, 'pediatra@exemplo-saude.local'),
      (u_a_psi, 'psicologa@exemplo-saude.local'),
      (u_a_fis, 'fisio@exemplo-saude.local'),
      (u_a_rec, 'recepcao@exemplo-saude.local'),
      (u_a_rec2, 'recepcao2@exemplo-saude.local'),
      (u_b_admin, 'admin@odonto-exemplo.local'),
      (u_b_rec, 'recepcao@odonto-exemplo.local'),
      (u_support, 'suporte@recepclinic.local')
    ) as t (id, email)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user.id, 'authenticated', 'authenticated', v_user.email,
      extensions.crypt('recepclinic-local', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), v_user.id, v_user.id::text, 'email',
      jsonb_build_object('sub', v_user.id::text, 'email', v_user.email, 'email_verified', true),
      now(), now(), now()
    );
  end loop;

  insert into public.platform_staff (user_id, display_name) values (u_support, 'Suporte Local');

  -- -------------------------------------------------------------------------
  -- Clínica A: Clínica Exemplo Saúde (perfil Mista, vários profissionais)
  -- -------------------------------------------------------------------------
  -- Limite de profissionais ativos (D11): definido pelo Suporte.
  insert into public.clinics (id, name, max_professionals) values (c_a, 'Clínica Exemplo Saúde', 5);
  -- Matriz de acesso (D11): a clínica de exemplo tem tudo liberado.
  insert into public.clinic_features (clinic_id, feature_key) select c_a, key from public.features;
  update public.clinic_settings
    set profile = 'mixed', consultation_age_limit_years = 14, reminder_hour = 14,
        bot_payment_info = 'Pix, cartão de crédito e débito.',
        bot_insurance_info = 'Atendemos Unimed, Bradesco Saúde e Hapvida.',
        brand_color = '#0F766E', require_insurance_details = true
    where clinic_id = c_a;

  insert into public.clinic_members (clinic_id, user_id, roles) values
    (c_a, u_a_admin, '{admin}'),
    (c_a, u_a_ped, '{professional}'),
    (c_a, u_a_psi, '{professional}'),
    (c_a, u_a_fis, '{professional}'),
    (c_a, u_a_rec, '{reception}'),
    (c_a, u_a_rec2, '{reception}');
  update public.clinic_members set agenda_scope = 'restricted' where clinic_id = c_a and user_id = u_a_rec2;

  insert into public.professionals (clinic_id, user_id, display_name, profession, specialty, council, council_number, council_state)
    values (c_a, u_a_ped, 'Dra. Helena Costa', 'Médica', 'Pediatria', 'CRM', '12345', 'RN') returning id into p_ped;
  insert into public.professionals (clinic_id, user_id, display_name, profession, specialty, council, council_number, council_state)
    values (c_a, u_a_psi, 'Marina Alves', 'Psicóloga', 'Terapia cognitivo-comportamental', 'CRP', '17/0001', 'RN') returning id into p_psi;
  insert into public.professionals (clinic_id, user_id, display_name, profession, specialty, council, council_number, council_state)
    values (c_a, u_a_fis, 'Rafael Lima', 'Fisioterapeuta', 'Fisioterapia respiratória', 'CREFITO', '1-000001', 'RN') returning id into p_fis;

  insert into public.locations (clinic_id, name, type, address)
    values (c_a, 'Consultório Centro', 'clinic', 'Rua das Flores, 100 – Centro') returning id into l_office;
  insert into public.locations (clinic_id, name, type)
    values (c_a, 'Atendimento domiciliar', 'home_visit') returning id into l_home;

  insert into public.agendas (clinic_id, name, kind, professional_id, buffer_minutes)
    values (c_a, 'Dra. Helena Costa', 'professional', p_ped, 10) returning id into ag_ped;
  insert into public.agendas (clinic_id, name, kind, professional_id)
    values (c_a, 'Marina Alves', 'professional', p_psi) returning id into ag_psi;
  insert into public.agendas (clinic_id, name, kind, professional_id)
    values (c_a, 'Rafael Lima', 'professional', p_fis) returning id into ag_fis;
  insert into public.agendas (clinic_id, name, kind)
    values (c_a, 'Exames', 'resource') returning id into ag_exams;

  insert into public.member_agenda_grants (clinic_id, user_id, agenda_id) values
    (c_a, u_a_rec2, ag_psi),
    (c_a, u_a_rec2, ag_fis);

  insert into public.services (clinic_id, name, category, duration_minutes, price_cents)
    values (c_a, 'Consulta pediátrica', 'consultation', 30, 30000) returning id into s_consulta;
  insert into public.services (clinic_id, name, category, duration_minutes, price_cents, return_deadline_days)
    values (c_a, 'Retorno pediátrico', 'return_visit', 20, 0, 30) returning id into s_retorno;
  insert into public.services (clinic_id, name, category, duration_minutes, price_cents)
    values (c_a, 'Avaliação inicial', 'consultation', 50, 20000) returning id into s_avaliacao;
  insert into public.services (clinic_id, name, category, duration_minutes, price_cents)
    values (c_a, 'Sessão de psicoterapia', 'consultation', 50, 18000) returning id into s_psi;
  insert into public.services (clinic_id, name, category, duration_minutes, price_cents)
    values (c_a, 'Sessão de fisioterapia', 'consultation', 40, 12000) returning id into s_fis;
  insert into public.services (clinic_id, name, category, duration_minutes, price_cents, preparation_instructions, scheduling_mode)
    values (c_a, 'Espirometria', 'exam', 40, 18000, '*Não usar* broncodilatador nas 4 horas anteriores.', 'group') returning id into s_espiro;

  insert into public.service_agendas (clinic_id, service_id, agenda_id) values
    (c_a, s_consulta, ag_ped),
    (c_a, s_retorno, ag_ped),
    (c_a, s_avaliacao, ag_psi),   -- mesmo serviço em duas agendas: o bot pergunta "com quem?"
    (c_a, s_avaliacao, ag_fis),
    (c_a, s_psi, ag_psi),
    (c_a, s_fis, ag_fis),
    (c_a, s_espiro, ag_exams);

  insert into public.service_locations (clinic_id, service_id, location_id, price_cents) values
    (c_a, s_consulta, l_office, null),
    (c_a, s_consulta, l_home, 45000),   -- consulta domiciliar com preço próprio
    (c_a, s_retorno, l_office, null),   -- retorno só no consultório
    (c_a, s_avaliacao, l_office, null),
    (c_a, s_psi, l_office, null),
    (c_a, s_fis, l_office, null),
    (c_a, s_espiro, l_office, null);

  insert into public.availability_windows (clinic_id, agenda_id, location_id, service_id, weekday, start_time, end_time, capacity) values
    (c_a, ag_ped, l_office, null, 1, '08:00', '12:00', null),
    (c_a, ag_ped, l_office, null, 3, '08:00', '12:00', null),
    (c_a, ag_ped, l_home, null, 5, '14:00', '17:00', null),
    (c_a, ag_psi, l_office, null, 1, '13:00', '18:00', null),
    (c_a, ag_psi, l_office, null, 4, '13:00', '18:00', null),
    (c_a, ag_fis, l_office, null, 2, '08:00', '12:00', null),
    (c_a, ag_exams, l_office, s_espiro, 3, '07:00', '08:00', 4);

  insert into public.clinic_holidays (clinic_id, date, description) values
    (c_a, make_date(extract(year from monday)::int, 12, 13), 'Santa Luzia (feriado municipal)');

  insert into public.notification_recipients (clinic_id, label, phone, receives_consultations, receives_exams) values
    (c_a, 'Recepção', '+5584999990001', true, true),
    (c_a, 'Dra. Helena', '+5584999990002', true, false);

  insert into public.insurance_plans (clinic_id, name, alternative_names, ans_code)
    values (c_a, 'Unimed', '{"Unimed Natal","Unimed RN"}', '339679') returning id into ip_unimed;
  insert into public.insurance_plans (clinic_id, name) values (c_a, 'Bradesco Saúde') returning id into ip_bradesco;
  insert into public.insurance_plans (clinic_id, name) values (c_a, 'Hapvida') returning id into ip_hapvida;
  -- O fisioterapeuta não atende Hapvida.
  insert into public.professional_insurance_exclusions (clinic_id, professional_id, insurance_plan_id)
    values (c_a, p_fis, ip_hapvida);

  insert into public.contacts (clinic_id, full_name, phone, default_home_address)
    values (c_a, 'Maria Souza', '+5584988880001', 'Rua A, 10 – Nova Betânia') returning id into ct_maria;
  insert into public.contacts (clinic_id, full_name, phone)
    values (c_a, 'Carlos Pereira', '+5584988880002') returning id into ct_carlos;
  insert into public.contacts (clinic_id, full_name, phone)
    values (c_a, 'Júlia Ramos', '+5584988880003') returning id into ct_julia;

  insert into public.patients (clinic_id, contact_id, full_name, birthdate, insurance_plan_id, insurance_card_number, insurance_card_valid_until)
    values (c_a, ct_maria, 'João Souza', monday - interval '6 years', ip_unimed, '0 123 456789 00-1', monday + interval '1 year')
    returning id into pt_joao;
  insert into public.patients (clinic_id, contact_id, full_name, birthdate)
    values (c_a, ct_maria, 'Ana Souza', monday - interval '18 months') returning id into pt_ana;
  insert into public.patients (clinic_id, contact_id, full_name, birthdate, is_contact_self, insurance_plan_id)
    values (c_a, ct_carlos, 'Carlos Pereira', '1985-04-12', true, ip_bradesco) returning id into pt_carlos;
  insert into public.patients (clinic_id, contact_id, full_name, birthdate, is_contact_self)
    values (c_a, ct_julia, 'Júlia Ramos', '1992-09-30', true) returning id into pt_julia;

  -- Atendimentos da próxima semana.
  insert into public.appointments (clinic_id, patient_id, service_id, agenda_id, location_id, scheduled_at, duration_minutes, booking_channel, status)
    values (c_a, pt_joao, s_consulta, ag_ped, l_office, (monday + time '08:00') at time zone tz, 30, 'whatsapp_bot', 'confirmed')
    returning id into ap_first;
  -- Retorno de uma consulta que já aconteceu (2 semanas antes, compareceu): todo
  -- retorno é de uma consulta já iniciada (cliente, 05/out/2026).
  insert into public.appointments (clinic_id, patient_id, service_id, agenda_id, location_id, scheduled_at, duration_minutes, booking_channel, status)
    values (c_a, pt_joao, s_consulta, ag_ped, l_office, (monday - 14 + time '09:00') at time zone tz, 30, 'admin', 'completed')
    returning id into ap_past;
  insert into public.appointments (clinic_id, patient_id, service_id, agenda_id, location_id, scheduled_at, duration_minutes, booking_channel, origin_appointment_id)
    values (c_a, pt_joao, s_retorno, ag_ped, l_office, (monday + 14 + time '10:00') at time zone tz, 20, 'admin', ap_past);
  insert into public.appointments (clinic_id, patient_id, service_id, agenda_id, location_id, scheduled_at, duration_minutes, booking_channel, home_visit_address)
    values (c_a, pt_ana, s_consulta, ag_ped, l_home, (monday + 4 + time '14:00') at time zone tz, 30, 'whatsapp_bot', 'Rua A, 10 – Nova Betânia');
  insert into public.appointments (clinic_id, patient_id, service_id, agenda_id, location_id, scheduled_at, duration_minutes, booking_channel)
    values (c_a, pt_carlos, s_avaliacao, ag_fis, l_office, (monday + 1 + time '09:00') at time zone tz, 50, 'whatsapp_bot');
  -- Turma de espirometria (quarta, 7h): dois pacientes no mesmo horário.
  insert into public.appointments (clinic_id, patient_id, service_id, agenda_id, location_id, scheduled_at, duration_minutes, booking_channel) values
    (c_a, pt_joao, s_espiro, ag_exams, l_office, (monday + 2 + time '07:00') at time zone tz, 40, 'admin'),
    (c_a, pt_carlos, s_espiro, ag_exams, l_office, (monday + 2 + time '07:00') at time zone tz, 40, 'whatsapp_bot');

  -- Série semanal de psicoterapia (segunda, 14h), 8 sessões; a 3ª semana foi pulada.
  insert into public.appointment_series (clinic_id, patient_id, service_id, agenda_id, location_id, interval_weeks, weekday, start_time, duration_minutes, starts_on, max_sessions, created_by)
    values (c_a, pt_julia, s_psi, ag_psi, l_office, 1, 1, '14:00', 50, monday, 8, u_a_rec)
    returning id into ser_psi;
  insert into public.appointments (clinic_id, patient_id, service_id, agenda_id, location_id, series_id, scheduled_at, duration_minutes, booking_channel, created_by)
    select c_a, pt_julia, s_psi, ag_psi, l_office, ser_psi, ((monday + 7 * w) + time '14:00') at time zone tz, 50, 'admin', u_a_rec
    from unnest(array[0, 1, 3, 4]) as w;
  select id into ap_session from public.appointments where series_id = ser_psi order by scheduled_at limit 1;
  insert into public.appointment_series_skips (clinic_id, series_id, skipped_on, reason)
    values (c_a, ser_psi, monday + 14, 'conflict');

  insert into public.schedule_blocks (clinic_id, agenda_id, starts_at, ends_at, reason, created_by)
    values (c_a, ag_ped, (monday + 2 + time '10:00') at time zone tz, (monday + 2 + time '12:00') at time zone tz, 'Reunião clínica', u_a_admin);

  insert into public.booking_links (clinic_id, contact_id, patient_id, service_id, mode, contact_phone, expires_at)
    values (c_a, ct_maria, pt_ana, s_consulta, 'create', '+5584988880001', now() + interval '1 day');

  -- Lista de espera: Ana espera antecipar a consulta com a pediatra; um
  -- cancelamento na mesma agenda abre a vaga (gatilho) e ela recebe a oferta.
  insert into public.appointments (clinic_id, patient_id, service_id, agenda_id, location_id, scheduled_at, duration_minutes, booking_channel)
    values (c_a, pt_ana, s_consulta, ag_ped, l_office, (monday + 16 + time '09:00') at time zone tz, 30, 'whatsapp_bot')
    returning id into ap_waiting;
  insert into public.waitlist_entries (clinic_id, appointment_id) values (c_a, ap_waiting) returning id into e_waiting;
  insert into public.appointments (clinic_id, patient_id, service_id, agenda_id, location_id, scheduled_at, duration_minutes, booking_channel)
    values (c_a, pt_joao, s_consulta, ag_ped, l_office, (monday + 2 + time '09:00') at time zone tz, 30, 'admin')
    returning id into ap_canceled;
  update public.appointments set status = 'canceled', canceled_at = now(), canceled_via = 'whatsapp_bot' where id = ap_canceled;
  select id into op_id from public.waitlist_openings where opened_by_appointment_id = ap_canceled;
  update public.waitlist_openings set status = 'offering' where id = op_id;
  insert into public.waitlist_offers (clinic_id, entry_id, appointment_id, opening_id, opened_by_appointment_id, slot_scheduled_at, slot_location_id, slot_duration_minutes, expires_at)
    values (c_a, e_waiting, ap_waiting, op_id, ap_canceled, (monday + 2 + time '09:00') at time zone tz, l_office, 30, now() + interval '60 minutes');

  insert into public.appointment_events (clinic_id, appointment_id, event_type, actor_id, channel, details) values
    (c_a, ap_first, 'created', null, 'whatsapp_bot', '{}'),
    (c_a, ap_first, 'presence_confirmed', null, 'whatsapp_bot', '{}'),
    (c_a, ap_canceled, 'canceled', null, 'whatsapp_bot', '{}'),
    (c_a, ap_waiting, 'waitlist_joined', null, 'whatsapp_bot', '{}'),
    (c_a, ap_session, 'created', u_a_rec, 'admin', '{}');

  -- WhatsApp (conexão fictícia; o token vai para o cofre).
  insert into public.whatsapp_connections (clinic_id, phone_number_id, waba_id, display_phone, status, connected_at)
    values (c_a, 'local-phone-number-id-a', 'local-waba-a', '+55 84 3333-0001', 'connected', now());
  v_secret := vault.create_secret('token-local-ficticio-a', 'whatsapp_token_' || c_a::text, 'Token fictício (local)');
  update public.whatsapp_connections set access_token_secret_id = v_secret where clinic_id = c_a;

  insert into public.whatsapp_templates (clinic_id, template_key, name, status) values
    (c_a, 'confirmation', 'recepclinic_confirmacao', 'approved'),
    (c_a, 'reminder', 'recepclinic_lembrete', 'approved'),
    (c_a, 'reschedule', 'recepclinic_remarcacao', 'approved'),
    (c_a, 'cancellation', 'recepclinic_cancelamento', 'approved'),
    (c_a, 'waitlist_offer', 'recepclinic_oferta_vaga', 'pending');

  insert into public.conversation_state (clinic_id, contact_phone, contact_id, state, context)
    values (c_a, '+5584988880001', ct_maria, 'MENU', '{}');
  insert into public.conversation_state (clinic_id, contact_phone, contact_id, state, human_handoff)
    values (c_a, '+5584988880002', ct_carlos, 'HUMAN_HANDOFF', true);

  insert into public.whatsapp_messages (clinic_id, appointment_id, contact_id, contact_phone, direction, message_type, template_name, body, status, wa_message_id) values
    (c_a, null, ct_maria, '+5584988880001', 'inbound', 'text', null, 'Oi, quero marcar uma consulta', 'received', 'wamid.local.1'),
    (c_a, ap_first, ct_maria, '+5584988880001', 'outbound', 'template', 'recepclinic_confirmacao', null, 'delivered', 'wamid.local.2'),
    (c_a, ap_first, ct_maria, '+5584988880001', 'outbound', 'template', 'recepclinic_lembrete', null, 'read', 'wamid.local.3');

  insert into public.bot_funnel_events (clinic_id, session_id, flow, step, contact_phone, contact_id) values
    (c_a, '0a0f0000-0000-4000-8000-000000000001', 'booking', 'started', '+5584988880001', ct_maria),
    (c_a, '0a0f0000-0000-4000-8000-000000000001', 'booking', 'confirmed', '+5584988880001', ct_maria);

  insert into public.job_runs (clinic_id, job, variant, trigger, started_at, finished_at, status, totals) values
    (c_a, 'appointment_reminders', null, 'scheduled', now() - interval '1 day', now() - interval '1 day' + interval '20 seconds', 'ok', '{"sent": 3}'),
    (c_a, 'daily_summary', 'final', 'scheduled', now() - interval '1 day', now() - interval '1 day' + interval '5 seconds', 'ok', '{"sent": 2}');

  insert into public.daily_summary_sends (clinic_id, summary_date, kind, first_scheduled_at)
    values (c_a, monday, 'consultas', (monday + time '08:00') at time zone tz);

  -- Convite do primeiro Administrador e pedido de informações (F4.4a). O
  -- formulário abre em /formulario/recepclinic-local-formulario (só local).
  insert into public.clinic_invitations (clinic_id, email, user_id, roles, invited_by, accepted_at)
    values (c_a, 'admin@exemplo-saude.local', u_a_admin, '{admin}', u_support, now());
  insert into public.onboarding_requests (clinic_id, token_hash, email, requested_by, expires_at)
    values (c_a, encode(sha256(convert_to('recepclinic-local-formulario', 'UTF8')), 'hex'), 'admin@exemplo-saude.local', u_support, now() + interval '30 days');

  -- -------------------------------------------------------------------------
  -- Clínica B: Odonto Exemplo (perfil Adultos)
  -- -------------------------------------------------------------------------
  insert into public.clinics (id, name, max_professionals) values (c_b, 'Odonto Exemplo', 2);
  -- Matriz de acesso (D11): a clínica de exemplo tem tudo liberado.
  insert into public.clinic_features (clinic_id, feature_key) select c_b, key from public.features;
  update public.clinic_settings set profile = 'adult', reminder_hour = 10 where clinic_id = c_b;

  insert into public.clinic_members (clinic_id, user_id, roles) values
    (c_b, u_b_admin, '{admin,professional}'),
    (c_b, u_b_rec, '{reception}');

  insert into public.professionals (clinic_id, user_id, display_name, profession, specialty, council, council_number, council_state)
    values (c_b, u_b_admin, 'Dra. Beatriz Nunes', 'Cirurgiã-dentista', 'Clínica geral', 'CRO', '4321', 'RN') returning id into p_dent;
  insert into public.locations (clinic_id, name, type, address)
    values (c_b, 'Consultório Odonto', 'clinic', 'Av. Principal, 500') returning id into l_b;
  insert into public.agendas (clinic_id, name, kind, professional_id)
    values (c_b, 'Dra. Beatriz Nunes', 'professional', p_dent) returning id into ag_b;
  insert into public.services (clinic_id, name, category, duration_minutes, price_cents)
    values (c_b, 'Avaliação odontológica', 'consultation', 40, 15000) returning id into s_b;
  insert into public.service_agendas (clinic_id, service_id, agenda_id) values (c_b, s_b, ag_b);
  insert into public.service_locations (clinic_id, service_id, location_id) values (c_b, s_b, l_b);
  insert into public.availability_windows (clinic_id, agenda_id, location_id, weekday, start_time, end_time)
    values (c_b, ag_b, l_b, 2, '08:00', '17:00');
  insert into public.insurance_plans (clinic_id, name) values (c_b, 'Odontoprev');
  insert into public.contacts (clinic_id, full_name, phone)
    values (c_b, 'Pedro Martins', '+5584988880001') returning id into ct_b;   -- mesmo telefone da Maria, outra clínica
  insert into public.patients (clinic_id, contact_id, full_name, birthdate, is_contact_self)
    values (c_b, ct_b, 'Pedro Martins', '1978-02-20', true) returning id into pt_b;
  insert into public.appointments (clinic_id, patient_id, service_id, agenda_id, location_id, scheduled_at, duration_minutes, booking_channel)
    values (c_b, pt_b, s_b, ag_b, l_b, (monday + 1 + time '10:00') at time zone tz, 40, 'whatsapp_bot');
  insert into public.whatsapp_connections (clinic_id, phone_number_id, waba_id, display_phone, status)
    values (c_b, 'local-phone-number-id-b', 'local-waba-b', '+55 84 3333-0002', 'pending');

  -- Leituras do Suporte (F3.2): uma em cada clínica.
  insert into public.platform_access_log (actor_user_id, clinic_id, method, path) values
    (u_support, c_a, 'GET', '/admin/agenda'),
    (u_support, c_b, 'GET', '/admin/pacientes');
end
$$;
