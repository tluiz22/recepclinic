-- F3.7a — Lista de espera: entrada pelo painel e saída sem service role.
--
-- 1. A recepção também inclui na lista pelo painel (cliente, 04/out/2026: quem
--    pede por telefone ou no balcão). Quem incluiu fica na trilha.
-- 2. Quem sai da lista (pelo bot ou retirado pela tela) perde a oferta em
--    aberto e a vaga volta para a fila. No piloto, a rota da tela fazia isso
--    com a service role; aqui é o banco, como no fim do atendimento
--    (waitlist_on_appointment_change). A oferta ao próximo da fila fica com o
--    motor de ofertas (F3.7b) e o agendador (F7).

alter table public.waitlist_entries drop constraint waitlist_entries_created_via_check;
alter table public.waitlist_entries add constraint waitlist_entries_created_via_check
  check (created_via in ('whatsapp_bot', 'booking_link', 'admin'));

create function app.waitlist_on_entry_left()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  with withdrawn as (
    update public.waitlist_offers
      set status = 'withdrawn', responded_at = now(),
          details = details || jsonb_build_object('reason', 'entry_' || new.status)
      where entry_id = new.id and status = 'pending'
      returning opening_id
  )
  update public.waitlist_openings
    set status = 'open'
    where id in (select opening_id from withdrawn) and status = 'offering';
  return null;
end
$$;

-- 'closed' já é tratado pelo gatilho do atendimento; 'advanced' não tem
-- oferta pendente (a aceita deixou de estar pendente).
create trigger waitlist_entries_left
  after update of status on public.waitlist_entries
  for each row
  when (old.status = 'active' and new.status in ('left', 'removed'))
  execute function app.waitlist_on_entry_left();
