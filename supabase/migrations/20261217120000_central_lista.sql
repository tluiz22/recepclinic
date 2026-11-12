-- CN3a — lista da tela Conversas (Central de Atendimento; plano em docs/arquivo/modulos/planejamento-central-atendimento.md, decisões 3,
-- 4, 6 e 12, telas T1 e T6). Só funções de leitura; nada muda nas tabelas.
--
-- `central_enabled`: a Central vale para a clínica (menu, tela e redirecionamento do Atendimento antigo), para toda a
-- equipe; a troca (central_switches) segue lida só pelo Administrador.
-- `central_conversations`: Abertas (com a clínica) ou Finalizadas (com o bot), com nome, situação, responsável,
-- prévia, última mensagem e não lidas de quem pergunta. Administrador, Recepção e Suporte veem todas; o Profissional,
-- só as abertas que estão com ele. O número do suporte do RecepClinic nunca aparece.
-- `central_waiting_count`: o número do item Conversas no menu (aguardando a clínica, que a pessoa vê).
--
-- Reversão: drop das três funções.

create function public.central_enabled(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (app.is_clinic_member(p_clinic_id) or app.is_platform_staff()) and app.central_active(p_clinic_id)
$$;
revoke execute on function public.central_enabled(uuid) from public, anon, clinic_service;
grant execute on function public.central_enabled(uuid) to authenticated;

create function public.central_conversations(
  p_clinic_id uuid,
  p_finished boolean default false,
  p_search text default null,
  p_limit integer default 200
)
returns table (
  contact_phone text, contact_id uuid, name text, human_handoff boolean, handoff_status text,
  handoff_status_at timestamptz, handoff_started_at timestamptz, handoff_reason text, handoff_subject text,
  assigned_to uuid, assigned_name text, last_message_at timestamptz, last_message_author text,
  last_message_preview text, last_patient_at timestamptz, unread integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_all boolean := app.is_platform_staff() or app.has_clinic_role(p_clinic_id, array['admin', 'reception']::public.clinic_role[]);
  v_professional boolean := app.has_clinic_role(p_clinic_id, array['professional']::public.clinic_role[]);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_digits text := nullif(regexp_replace(coalesce(p_search, ''), '\D', '', 'g'), '');
begin
  if not app.central_active(p_clinic_id) then
    raise exception 'A Central de atendimento não está ligada nesta clínica.'
      using errcode = 'P0001', hint = 'feature_disabled:central_attendance';
  end if;
  if not v_all and not v_professional then
    raise exception 'Sem acesso às conversas desta clínica.' using errcode = '42501';
  end if;
  -- Em implantação nada é da equipe ainda (como a tela Atendimento).
  if exists (select 1 from public.clinics k where k.id = p_clinic_id and k.status = 'onboarding') then
    return;
  end if;
  return query
    select c.contact_phone, coalesce(c.contact_id, pc.id), coalesce(ct.full_name, pc.full_name), c.human_handoff,
           c.handoff_status, c.handoff_status_at, c.handoff_started_at, c.handoff_reason, c.handoff_subject,
           c.assigned_to, nullif(btrim(mem.display_name), ''), c.last_message_at, c.last_message_author,
           c.last_message_preview, c.last_patient_at,
           case when c.human_handoff and not app.is_platform_staff() then (
             select least(count(*), 99)::integer from public.whatsapp_messages m
              where m.clinic_id = c.clinic_id and m.contact_phone = c.contact_phone
                and m.direction = 'inbound' and m.source = 'live'
                and m.sort_at > coalesce(r.last_read_at, c.handoff_started_at, c.human_handoff_at)
           ) else 0 end
      from public.conversation_state c
      left join public.contacts ct on ct.clinic_id = c.clinic_id and ct.id = c.contact_id
      left join lateral (
        select x.id, x.full_name from public.contacts x
         where c.contact_id is null and x.clinic_id = c.clinic_id and x.phone = c.contact_phone and x.is_active
         limit 1
      ) pc on true
      left join public.clinic_members mem on mem.clinic_id = c.clinic_id and mem.user_id = c.assigned_to
      left join public.conversation_reads r on r.clinic_id = c.clinic_id and r.contact_phone = c.contact_phone and r.user_id = v_user
     where c.clinic_id = p_clinic_id
       and c.contact_phone is distinct from (select s.support_whatsapp from public.platform_settings s limit 1)
       and (case when p_finished then not c.human_handoff else c.human_handoff end)
       and (v_all or (c.human_handoff and c.assigned_to = v_user))
       -- Finalizadas: só as que já tiveram mensagem (conversa criada e esquecida não entra).
       and (not p_finished or c.last_message_at is not null)
       and (
         v_search is null
         or coalesce(ct.full_name, pc.full_name, '') ilike '%' || v_search || '%'
         or (v_digits is not null and length(v_digits) >= 4 and regexp_replace(c.contact_phone, '\D', '', 'g') like '%' || v_digits || '%')
       )
     order by
       case when not p_finished and c.handoff_status = 'waiting_clinic' then 0 else 1 end,
       case when not p_finished and c.handoff_status = 'waiting_clinic' then c.handoff_status_at end asc nulls last,
       c.last_message_at desc nulls last,
       c.contact_phone
     limit greatest(1, least(coalesce(p_limit, 200), 500));
end
$$;
revoke execute on function public.central_conversations(uuid, boolean, text, integer) from public, anon, clinic_service;
grant execute on function public.central_conversations(uuid, boolean, text, integer) to authenticated;

create function public.central_waiting_count(p_clinic_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when not app.central_active(p_clinic_id) then 0 else (
    select count(*)::integer
      from public.conversation_state c
     where c.clinic_id = p_clinic_id
       and c.human_handoff and c.handoff_status = 'waiting_clinic'
       and c.contact_phone is distinct from (select s.support_whatsapp from public.platform_settings s limit 1)
       and not exists (select 1 from public.clinics k where k.id = p_clinic_id and k.status = 'onboarding')
       and (
         app.is_platform_staff()
         or app.has_clinic_role(p_clinic_id, array['admin', 'reception']::public.clinic_role[])
         or (app.has_clinic_role(p_clinic_id, array['professional']::public.clinic_role[]) and c.assigned_to = (select auth.uid()))
       )
  ) end
$$;
revoke execute on function public.central_waiting_count(uuid) from public, anon, clinic_service;
grant execute on function public.central_waiting_count(uuid) to authenticated;

-- A tela Conversas recarrega sozinha a cada minuto (como o Atendimento): a abertura da mesma conversa pela mesma pessoa
-- fica registrada uma vez a cada 15 minutos (a leitura continua marcando como lida a cada vez).
create or replace function public.central_conversation_messages(
  p_clinic_id uuid,
  p_contact_phone text,
  p_before_sort_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50
)
returns table (
  id uuid, direction text, author text, message_type text, template_name text, body text, status text,
  failure_code integer, failure_reason text, sort_at timestamptz, created_at timestamptz, sent_by uuid,
  handoff_id uuid, source text, edited_at timestamptz, revoked_at timestamptz, media_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_conversation_access(p_clinic_id, p_contact_phone);
  if p_before_sort_at is null then
    if not exists (
      select 1 from public.conversation_access_log l
       where l.clinic_id = p_clinic_id and l.contact_phone = p_contact_phone and l.user_id = (select auth.uid())
         and l.action = 'open' and l.occurred_at > now() - interval '15 minutes'
    ) then
      insert into public.conversation_access_log (clinic_id, contact_phone, user_id, action)
      values (p_clinic_id, p_contact_phone, (select auth.uid()), 'open');
    end if;
    if not app.is_platform_staff() then
      insert into public.conversation_reads (clinic_id, contact_phone, user_id, last_read_at)
      values (p_clinic_id, p_contact_phone, (select auth.uid()), now())
      on conflict (clinic_id, contact_phone, user_id) do update set last_read_at = excluded.last_read_at;
    end if;
  end if;
  return query
    select m.id, m.direction, m.author, m.message_type, m.template_name,
           case when m.revoked_at is null then m.body end,
           m.status, m.failure_code, m.failure_reason, m.sort_at, m.created_at, m.sent_by, m.handoff_id,
           m.source, m.edited_at, m.revoked_at, m.media_id
      from public.whatsapp_messages m
     where m.clinic_id = p_clinic_id
       and m.contact_phone = p_contact_phone
       and (p_before_sort_at is null or (m.sort_at, m.id) < (p_before_sort_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
     order by m.sort_at desc, m.id desc
     limit greatest(1, least(coalesce(p_limit, 50), 100));
end
$$;
