-- N5 — Desliga e remove o emissor antigo da NFS-e (DPS assinada e enviada à
-- Sefin Nacional pelo servidor, com o certificado A1 no Vault; F11.3 e F11.4).
-- Desde a N3b a emissão sai pelo Asaas, por emissor (planejamento-nfse-asaas.md,
-- seções 7 e 15).
--
--   1. sai: funções de emissão, cancelamento e consulta da Sefin, o
--      certificado A1 no Vault (os segredos são apagados), o contador da DPS,
--      o ambiente "Simulação" e os dados fiscais por clínica (copiados para o
--      emissor da clínica na N2a; os códigos por serviço vão agora para o
--      emissor da clínica);
--   2. fica: as notas antigas (provider 'sefin'), o XML delas no bucket e a
--      trilha; o PDF delas segue gerado do XML (danfse.ts);
--   3. migrate_agenda passa a copiar os códigos por emissor.
--
-- Conferido antes (operação): a produção não tem notas nem certificados do
-- emissor antigo (a piloto não tem o Módulo financeiro).
--
-- Reversão: recriar a partir das migrações 20261012140000, 20261012160000 e
-- 20261013120000 (os segredos apagados do Vault não voltam).

-- Códigos por serviço do emissor antigo → emissor da clínica (os que faltarem).
insert into public.fiscal_issuer_service_codes (clinic_id, issuer_id, service_id, service_code)
select c.clinic_id, i.id, c.service_id, c.service_code
  from public.service_fiscal_codes c
  join public.fiscal_issuers i on i.clinic_id = c.clinic_id and i.kind = 'clinic'
on conflict (issuer_id, service_id) do nothing;

create or replace function public.migrate_agenda(p_from uuid, p_to uuid, p_apply boolean default false, p_services uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_to_clinic uuid;
  v_from_name text;
  v_to_name text;
  v_to_kind public.agenda_kind;
  v_to_professional uuid;
  v_actor uuid := case when (select auth.role()) = 'authenticated' then (select auth.uid()) end;
  v_windows integer := 0;
  v_series integer := 0;
  v_moved integer := 0;
  v_conflicts jsonb := '[]'::jsonb;
  v_services jsonb;
  v_missing text[];
  v_map jsonb := '{}'::jsonb;
  v_target uuid;
  v_source record;
  r record;
begin
  select clinic_id, name into v_clinic, v_from_name from public.agendas where id = p_from;
  select clinic_id, name, kind, professional_id into v_to_clinic, v_to_name, v_to_kind, v_to_professional
    from public.agendas where id = p_to and is_active;
  if v_clinic is null or v_clinic is distinct from v_to_clinic or p_from = p_to
     or not app.has_clinic_role(v_clinic, array['admin']::public.clinic_role[]) then
    raise exception 'Sem acesso a estas agendas.' using errcode = '42501';
  end if;

  -- Os serviços da agenda antiga com horário, atendimento futuro ou série, e o que recebe cada um na nova.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name,
           'windows', (select count(*) from public.availability_windows w where w.agenda_id = p_from and w.service_id = s.id),
           'appointments', (select count(*) from public.appointments a
                              where a.agenda_id = p_from and a.service_id = s.id and a.scheduled_at >= now() and a.status in ('scheduled', 'confirmed')),
           'series', (select count(*) from public.appointment_series t where t.agenda_id = p_from and t.service_id = s.id and t.ended_at is null),
           'target_attends', v_to_kind = 'professional' or s.category = 'exam',
           'target_service', (select t.name from public.services t where t.id = app.owner_service_match(s.id, p_to)),
           'creates_copy', (v_to_kind = 'professional' or s.category = 'exam') and app.owner_service_match(s.id, p_to) is null
         ) order by s.name), '[]'::jsonb)
    into v_services
    from public.services s
    where s.id in (
      select service_id from public.availability_windows where agenda_id = p_from and service_id is not null
      union
      select service_id from public.appointments where agenda_id = p_from and scheduled_at >= now() and status in ('scheduled', 'confirmed')
      union
      select service_id from public.appointment_series where agenda_id = p_from and ended_at is null
    );

  -- A agenda da equipe só atende exames.
  select array_agg(distinct s.name order by s.name) into v_missing
    from public.services s
    where (p_services is null or s.id = any (p_services))
      and s.id in (select (e->>'id')::uuid from jsonb_array_elements(v_services) e)
      and v_to_kind = 'resource' and s.category <> 'exam';
  if v_missing is not null then
    raise exception 'service_not_in_agenda: %', array_to_string(v_missing, ', ') using errcode = 'P0001';
  end if;

  select count(*) into v_windows from public.availability_windows
    where agenda_id = p_from and (p_services is null or service_id = any (p_services));
  select count(*) into v_series from public.appointment_series
    where agenda_id = p_from and ended_at is null and (p_services is null or service_id = any (p_services));

  -- Serviço de destino de cada um (cria a cópia que faltar).
  if p_apply then
    for v_source in
      select s.* from public.services s
       where s.id in (select (e->>'id')::uuid from jsonb_array_elements(v_services) e)
         and (p_services is null or s.id = any (p_services))
    loop
      v_target := app.owner_service_match(v_source.id, p_to);
      if v_target is null then
        insert into public.services (
          clinic_id, name, category, duration_minutes, price_cents, return_deadline_days,
          preparation_instructions, scheduling_mode, is_active,
          preparation_file_path, preparation_file_name, preparation_file_type, preparation_file_size,
          professional_id, is_team)
        values (
          v_source.clinic_id, v_source.name, v_source.category, v_source.duration_minutes,
          v_source.price_cents, v_source.return_deadline_days, v_source.preparation_instructions,
          v_source.scheduling_mode, true,
          v_source.preparation_file_path, v_source.preparation_file_name,
          v_source.preparation_file_type, v_source.preparation_file_size,
          v_to_professional, v_to_kind = 'resource')
        returning id into v_target;
        insert into public.service_locations (clinic_id, service_id, location_id, price_cents)
          select clinic_id, v_target, location_id, price_cents
            from public.service_locations where service_id = v_source.id;
        -- N5: o código fiscal por serviço é por emissor (fiscal_issuer_service_codes).
        insert into public.fiscal_issuer_service_codes (clinic_id, issuer_id, service_id, service_code)
          select f.clinic_id, f.issuer_id, v_target, f.service_code
            from public.fiscal_issuer_service_codes f where f.service_id = v_source.id;
      end if;
      v_map := v_map || jsonb_build_object(v_source.id::text, v_target);
    end loop;
  end if;

  for r in
    select a.id, a.service_id, a.scheduled_at, a.is_exam, a.duration_minutes, p.full_name as patient_name
      from public.appointments a
      join public.patients p on p.id = a.patient_id
      where a.agenda_id = p_from and a.scheduled_at >= now() and a.status in ('scheduled', 'confirmed')
        and (p_services is null or a.service_id = any (p_services))
      order by a.scheduled_at
      for update of a
  loop
    if not r.is_exam and exists (
      select 1 from public.appointments o
        where o.agenda_id = p_to and not o.is_exam and o.status in ('scheduled', 'confirmed')
          and app.appointment_period(o.scheduled_at, o.duration_minutes) && app.appointment_period(r.scheduled_at, r.duration_minutes)
    ) then
      v_conflicts := v_conflicts || jsonb_build_object('id', r.id, 'scheduled_at', r.scheduled_at, 'patient', r.patient_name);
      continue;
    end if;
    v_moved := v_moved + 1;
    if p_apply then
      -- A trilha ("Alterado: Agenda: antiga → nova") vai pela coluna trail_context, que o gatilho de antes do
      -- update lê e zera (20261022120000_metricas_trilha.sql).
      update public.appointments
        set agenda_id = p_to,
            service_id = (v_map->>r.service_id::text)::uuid,
            trail_context = jsonb_build_object(
              'channel', 'admin', 'event', 'changed', 'actor', v_actor,
              'details', jsonb_build_object('changes', jsonb_build_array(jsonb_build_object('label', 'Agenda', 'from', v_from_name, 'to', v_to_name)))
            )
        where id = r.id;
    end if;
  end loop;

  if p_apply then
    update public.availability_windows
       set agenda_id = p_to, service_id = case when service_id is null then null else (v_map->>service_id::text)::uuid end
      where agenda_id = p_from and (p_services is null or service_id = any (p_services));
    update public.appointment_series
       set agenda_id = p_to, service_id = (v_map->>service_id::text)::uuid
      where agenda_id = p_from and ended_at is null and (p_services is null or service_id = any (p_services));
  end if;

  return jsonb_build_object(
    'windows', v_windows, 'series', v_series, 'appointments', v_moved, 'conflicts', v_conflicts,
    'services', v_services, 'applied', p_apply
  );
end
$$;

-- Funções do emissor antigo.
drop function if exists public.begin_nfse_issue(uuid);
drop function if exists public.finish_nfse_issue(uuid, text, text, text, text, text, text);
drop function if exists public.begin_nfse_cancel(uuid, integer, text);
drop function if exists public.finish_nfse_cancel(uuid, text, text, text);
drop function if exists public.get_fiscal_certificate_secret(uuid);
drop function if exists public.list_pending_nfse_invoices(timestamptz);
drop function if exists public.set_fiscal_certificate(uuid, text, text, text, text, timestamptz, timestamptz, text);
drop function if exists public.revoke_fiscal_certificate(uuid);

-- Certificado no Vault: apaga os segredos e a tabela.
delete from vault.secrets where id in (select pfx_secret_id from public.clinic_fiscal_certificates union select password_secret_id from public.clinic_fiscal_certificates);
drop table public.clinic_fiscal_certificates;
drop function if exists app.delete_fiscal_certificate_secrets();

-- Contador da DPS, dados fiscais por clínica e códigos antigos.
drop table public.nfse_dps_counters;
drop table public.service_fiscal_codes;
drop table public.clinic_fiscal_settings;
drop function if exists app.fiscal_environment_rules();
drop function if exists app.fiscal_row_rules();
