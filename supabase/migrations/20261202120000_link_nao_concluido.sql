-- Pedido não concluído, PN2 (cliente, 03/nov/2026; docs/pedido-nao-concluido.md):
-- link do bot vencido sem uso recebe uma vez a mensagem "Não concluímos…" com
-- Novo link, Falar com a recepção e Desistir. Esta coluna marca o link já
-- tratado pela rotina (a mensagem saiu, ou foi pulada: paciente em outra
-- conversa, já resolvido, fora da janela de 24h). Nulo = ainda não tratado.
alter table public.booking_links
  add column not_completed_prompted_at timestamptz;

comment on column public.booking_links.not_completed_prompted_at is
  'Pedido não concluído (PN2): quando a rotina tratou o link vencido sem uso (mensagem enviada ou pulada).';

-- A rotina procura os links vencidos ainda não tratados.
create index booking_links_not_completed_idx
  on public.booking_links (clinic_id, expires_at)
  where used_at is null and not_completed_prompted_at is null;

-- A rotina da conversa parada passa também pelas clínicas com link vencido ainda
-- não tratado (depois do link a conversa volta ao começo, então não está
-- "parada"). Janela de 1 hora, como NOT_COMPLETED_LOOKBACK_MS (notCompleted.ts).
create or replace function public.list_clinics_with_idle_conversations(p_before timestamptz)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select clinic_id
  from public.conversation_state
  where human_handoff = false
    and state not in ('WELCOME', 'HUMAN_HANDOFF')
    and updated_at < p_before
    and updated_at > p_before - interval '1 day'
  union
  select clinic_id
  from public.booking_links
  where used_at is null
    and not_completed_prompted_at is null
    and expires_at <= now()
    and expires_at > now() - interval '1 hour'
$$;
