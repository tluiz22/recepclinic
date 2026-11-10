-- ---------------------------------------------------------------------------
-- Juntar os exames repetidos da agenda de Exames (cliente, 10/nov/2026)
-- ---------------------------------------------------------------------------
-- Duas migrações de 08/nov se somaram: a do serviço com um dono (20261230120000)
-- fez uma cópia do exame que estava em duas agendas (a de Exames e a de um
-- profissional), e a do exame só na agenda de Exames (20270101150000) levou a
-- cópia do profissional para a de Exames. Resultado: dois exames de mesmo nome na
-- Equipe (no staging, Espirometria e Exame com Arquivo).
--
-- Decisão do cliente: juntar. Por clínica, entre os exames da Equipe com o mesmo
-- nome (sem diferença de maiúsculas e espaços) e o mesmo modo (individual ou
-- turma), fica um: o ativo; empatado, o de mais atendimentos; depois o mais
-- antigo. Ele mantém as próprias características (nome, duração, valor, preparo,
-- locais e códigos fiscais). Do outro passam para ele:
--   - atendimentos (histórico e futuros), séries, links de agendar, vagas da lista
--     de espera, links e reservas do portal;
--   - os horários só dele que o que fica não tem igual (mesma agenda, local, dia e
--     horas); vindos de um exame desativado, entram desativados (não abrem vaga
--     nova sozinhos);
--   - os locais que o que fica não tem, só se o outro estava ativo.
-- Depois o outro é apagado. Sem gatilhos: não é mudança do atendimento (nem
-- updated_at nem trilha), como nas duas migrações de origem.
--
-- Reversão: não há (os exames apagados não voltam); os dados movidos ficam no
-- exame que restou.

alter table public.services disable trigger user;
alter table public.service_agendas disable trigger user;
alter table public.service_locations disable trigger user;
alter table public.availability_windows disable trigger user;
alter table public.appointments disable trigger user;
alter table public.appointment_series disable trigger user;
alter table public.booking_links disable trigger user;
alter table public.waitlist_openings disable trigger user;
alter table public.portal_links disable trigger user;
alter table public.slot_holds disable trigger user;

do $$
declare
  g record;
  v_keep uuid;
  v_drop uuid;
  v_drop_active boolean;
begin
  for g in
    select clinic_id, lower(btrim(name)) as key, scheduling_mode
      from public.services
     where category = 'exam' and is_team
     group by 1, 2, 3
    having count(*) > 1
  loop
    select s.id into v_keep
      from public.services s
     where s.clinic_id = g.clinic_id and s.category = 'exam' and s.is_team
       and lower(btrim(s.name)) = g.key and s.scheduling_mode = g.scheduling_mode
     order by s.is_active desc,
              (select count(*) from public.appointments a where a.service_id = s.id) desc,
              s.created_at, s.id
     limit 1;

    for v_drop, v_drop_active in
      select s.id, s.is_active
        from public.services s
       where s.clinic_id = g.clinic_id and s.category = 'exam' and s.is_team
         and lower(btrim(s.name)) = g.key and s.scheduling_mode = g.scheduling_mode
         and s.id <> v_keep
    loop
      update public.appointments set service_id = v_keep where service_id = v_drop;
      update public.appointment_series set service_id = v_keep where service_id = v_drop;
      update public.booking_links set service_id = v_keep where service_id = v_drop;
      update public.waitlist_openings set service_id = v_keep where service_id = v_drop;
      update public.portal_links set service_id = v_keep where service_id = v_drop;
      update public.slot_holds set service_id = v_keep where service_id = v_drop;

      -- Horários só do exame apagado: os que o que fica não tem igual passam para ele.
      update public.availability_windows w
         set service_id = v_keep,
             is_active = w.is_active and v_drop_active
       where w.service_id = v_drop
         and not exists (
           select 1 from public.availability_windows k
            where k.service_id = v_keep and k.agenda_id = w.agenda_id
              and k.location_id is not distinct from w.location_id
              and k.weekday = w.weekday and k.start_time = w.start_time and k.end_time = w.end_time);

      if v_drop_active then
        insert into public.service_locations (clinic_id, service_id, location_id, price_cents)
          select l.clinic_id, v_keep, l.location_id, l.price_cents
            from public.service_locations l
           where l.service_id = v_drop
             and not exists (select 1 from public.service_locations k where k.service_id = v_keep and k.location_id = l.location_id);
      end if;

      -- Locais, agendas, códigos fiscais e os horários repetidos saem junto (on delete cascade).
      delete from public.services where id = v_drop;
    end loop;
  end loop;
end
$$;

alter table public.services enable trigger user;
alter table public.service_agendas enable trigger user;
alter table public.service_locations enable trigger user;
alter table public.availability_windows enable trigger user;
alter table public.appointments enable trigger user;
alter table public.appointment_series enable trigger user;
alter table public.booking_links enable trigger user;
alter table public.waitlist_openings enable trigger user;
alter table public.portal_links enable trigger user;
alter table public.slot_holds enable trigger user;
