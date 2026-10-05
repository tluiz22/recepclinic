-- F3.9b — Lembrete e reenvios: resposta ao lembrete no atendimento.

-- Botão tocado no lembrete (Fase 19 do piloto): decide o "Reenviar lembrete"
-- de quem não respondeu e o reenvio automático. A F2.4 deixou as colunas de
-- fora. Remarcar zera junto com o lembrete (a data nova pede outro); o
-- histórico das respostas fica nas mensagens recebidas (métricas).
alter table public.appointments
  add column reminder_response text check (reminder_response in ('confirmed', 'reschedule', 'cancel')),
  add column reminder_response_at timestamptz,
  add constraint appointments_reminder_response_at_check
    check ((reminder_response is null) = (reminder_response_at is null));

-- Remarcar turma (função do banco) também zera o lembrete e a resposta, como
-- a remarcação individual.
create or replace function app.reset_reminder_on_reschedule()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.scheduled_at is distinct from old.scheduled_at then
    new.reminder_sent_at := null;
    new.reminder_response := null;
    new.reminder_response_at := null;
  end if;
  return new;
end
$$;

create trigger appointments_reset_reminder before update of scheduled_at on public.appointments
  for each row execute function app.reset_reminder_on_reschedule();
