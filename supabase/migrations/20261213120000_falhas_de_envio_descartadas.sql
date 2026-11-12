-- Falhas de envio descartadas (cliente, 05/nov/2026; docs/arquivo/modulos/falhas-de-envio.md).
--
-- Dois lugares mostram um envio com falha, e cada um descarta o seu:
--   'envios'  Relatório do dia › Envios (só o Suporte): erro já conhecido e resolvido sai da lista e do alerta;
--   'inicio'  Início › "Corrigir número" (recepção): "O número está certo" tira o aviso do número sem WhatsApp.
-- Um descarte de um lugar não mexe no outro. A falha é uma mensagem (whatsapp_messages) ou um "não enviado" da
-- trilha do atendimento (appointment_events), nunca as duas.

create table public.send_failure_dismissals (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  message_id uuid references public.whatsapp_messages (id) on delete cascade,
  event_id bigint references public.appointment_events (id) on delete cascade,
  scope text not null check (scope in ('envios', 'inicio')),
  dismissed_by uuid references auth.users (id) on delete set null,
  dismissed_at timestamptz not null default now(),
  check (num_nonnulls(message_id, event_id) = 1)
);

create unique index send_failure_dismissals_message_idx on public.send_failure_dismissals (scope, message_id) where message_id is not null;
create unique index send_failure_dismissals_event_idx on public.send_failure_dismissals (scope, event_id) where event_id is not null;
create index send_failure_dismissals_clinic_idx on public.send_failure_dismissals (clinic_id, dismissed_at);

-- A equipe lê; grava só pela função abaixo (que confere o papel).
select app.enable_clinic_service_written_rls('public.send_failure_dismissals');

-- Descarta uma falha. 'envios': só o Suporte; 'inicio': Administrador e recepção (e o Suporte). A falha precisa ser
-- da clínica. Descartar de novo não muda nada.
create function public.dismiss_send_failure(p_clinic_id uuid, p_scope text, p_message_id uuid default null, p_event_id bigint default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_scope = 'envios' then
    if not app.is_platform_staff() then
      raise exception 'descartar falha: sem permissão' using errcode = '42501';
    end if;
  elsif p_scope = 'inicio' then
    if not app.has_clinic_role(p_clinic_id, array['admin', 'reception']::public.clinic_role[]) then
      raise exception 'descartar falha: sem permissão' using errcode = '42501';
    end if;
  else
    raise exception 'descartar falha: lugar desconhecido' using errcode = '22023';
  end if;
  if num_nonnulls(p_message_id, p_event_id) <> 1 then
    raise exception 'descartar falha: informe a mensagem ou o evento' using errcode = '22023';
  end if;
  if p_message_id is not null and not exists (
    select 1 from public.whatsapp_messages where clinic_id = p_clinic_id and id = p_message_id and direction = 'outbound'
  ) then
    raise exception 'descartar falha: não encontrada' using errcode = 'P0002';
  end if;
  if p_event_id is not null and not exists (
    select 1 from public.appointment_events where clinic_id = p_clinic_id and id = p_event_id and event_type = 'message_not_sent'
  ) then
    raise exception 'descartar falha: não encontrada' using errcode = 'P0002';
  end if;
  insert into public.send_failure_dismissals (clinic_id, message_id, event_id, scope, dismissed_by)
    values (p_clinic_id, p_message_id, p_event_id, p_scope, (select auth.uid()))
    on conflict do nothing;
end
$$;

revoke execute on function public.dismiss_send_failure(uuid, text, uuid, bigint) from public, anon, clinic_service;
grant execute on function public.dismiss_send_failure(uuid, text, uuid, bigint) to authenticated;
