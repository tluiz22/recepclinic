-- F6.3 — Conversa parada há 15 minutos recebe o aviso de encerramento
-- (cliente, 07/out/2026), conferida de minuto em minuto pelo agendador do
-- Supabase (pg_cron + pg_net, L34): a Vercel gratuita só roda rotina uma vez
-- por dia. É o mesmo caminho das rotinas da F7.
--
-- O endereço do sistema e o CRON_SECRET ficam no cofre (Vault), gravados pela
-- plataforma (scripts/agendador.mjs); sem eles, a chamada não sai e nada
-- acontece (banco local sem configuração, por exemplo).

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Chama uma rota do sistema com o CRON_SECRET. Só o agendador usa.
create function app.call_system_route(p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_secret text;
begin
  select decrypted_secret into v_base from vault.decrypted_secrets where name = 'system_base_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_base is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_base, '/') || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end
$$;

revoke execute on function app.call_system_route(text) from public, anon, authenticated, clinic_service;

-- Plataforma (service role): grava o endereço do sistema e o CRON_SECRET no cofre.
create function public.set_scheduler_settings(p_base_url text, p_cron_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if coalesce(trim(p_base_url), '') !~ '^https?://' then
    raise exception 'endereço do sistema inválido';
  end if;
  if length(coalesce(p_cron_secret, '')) < 32 then
    raise exception 'CRON_SECRET curto demais';
  end if;

  select id into v_id from vault.secrets where name = 'system_base_url';
  if v_id is null then
    perform vault.create_secret(trim(p_base_url), 'system_base_url', 'Endereço do sistema para o agendador');
  else
    perform vault.update_secret(v_id, trim(p_base_url));
  end if;

  select id into v_id from vault.secrets where name = 'cron_secret';
  if v_id is null then
    perform vault.create_secret(p_cron_secret, 'cron_secret', 'CRON_SECRET das rotinas');
  else
    perform vault.update_secret(v_id, p_cron_secret);
  end if;
end
$$;

revoke execute on function public.set_scheduler_settings(text, text) from public, anon, authenticated, clinic_service;
grant execute on function public.set_scheduler_settings(text, text) to service_role;

-- Plataforma (service role): clínicas com conversa parada no meio de um
-- atendimento; o resto da rotina segue com a credencial de cada clínica (D1).
create function public.list_clinics_with_idle_conversations(p_before timestamptz)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct clinic_id
  from public.conversation_state
  where human_handoff = false
    and state not in ('WELCOME', 'HUMAN_HANDOFF')
    and updated_at < p_before
    and updated_at > p_before - interval '1 day'
$$;

revoke execute on function public.list_clinics_with_idle_conversations(timestamptz) from public, anon, authenticated, clinic_service;
grant execute on function public.list_clinics_with_idle_conversations(timestamptz) to service_role;

select cron.schedule('conversas-paradas', '* * * * *', $$ select app.call_system_route('/api/cron/conversas-paradas') $$);
