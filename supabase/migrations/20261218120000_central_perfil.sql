-- CN3b — nome do perfil do WhatsApp na conversa (Central de Atendimento, tela T4, cliente, 05/nov/2026): "Nome no
-- WhatsApp: Fernanda", vindo do `contacts[].profile.name` do webhook, guardado só nas clínicas com a Central valendo
-- (mesma regra do texto, D12 revista) e usado para preencher o cadastro. Fora da leitura direta pela API, como a
-- prévia: sai pela função da lista. Aditiva.
--
-- Reversão: alter table public.conversation_state drop column profile_name (e recriar a central_conversations do
-- 20261217120000).

alter table public.conversation_state
  add column profile_name text check (char_length(profile_name) <= 120);

create function app.conversation_profile_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.profile_name is not null then
    new.profile_name := nullif(left(btrim(new.profile_name), 120), '');
    if new.profile_name is not null and not app.central_active(new.clinic_id) then
      new.profile_name := null;
    end if;
  end if;
  return new;
end
$$;
create trigger conversation_state_profile_guard before insert or update of profile_name on public.conversation_state
  for each row execute function app.conversation_profile_guard();

-- O nome do perfil não muda o tempo parado do bot (como a última mensagem, 20261216120000).
create or replace function app.conversation_state_keep_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cols text[] := array['updated_at', 'last_message_at', 'last_message_author', 'last_message_preview', 'last_patient_at', 'profile_name'];
begin
  if (to_jsonb(new) - v_cols) = (to_jsonb(old) - v_cols) then
    new.updated_at := old.updated_at;
  end if;
  return new;
end
$$;

-- A lista passa a trazer o nome do perfil (o retorno muda: drop e create).
drop function public.central_conversations(uuid, boolean, text, integer);
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
  last_message_preview text, last_patient_at timestamptz, unread integer, profile_name text, handoff_id uuid
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
           ) else 0 end,
           c.profile_name, c.handoff_id
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
       and (not p_finished or c.last_message_at is not null)
       and (
         v_search is null
         or coalesce(ct.full_name, pc.full_name, '') ilike '%' || v_search || '%'
         or coalesce(c.profile_name, '') ilike '%' || v_search || '%'
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
