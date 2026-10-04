-- Fase 24 · etapa 1: valor do atendimento guardado na marcação.
--
-- O relatório financeiro (aba Financeiro em Métricas) mostra o valor da
-- tabela vigente no momento da marcação — mudar um preço depois não altera
-- os meses passados. Pagamento é presencial, fora do sistema: é o valor
-- esperado, não o recebido. Convênios/prefeituras usam o mesmo valor.
--
-- Regra (a mesma das mensagens de confirmação):
--   Consulta → clinic_locations.price_first_visit_cents do local
--              (clínicas e domiciliar);
--   Retorno  → 0 (incluso na consulta);
--   Exame    → exam_types.price_cents do tipo de exame.
-- Nulo só se faltar o local/exame de referência.

alter table appointments
  add column price_cents integer check (price_cents >= 0);

create or replace function appointment_table_price(
  p_appointment_type text,
  p_clinic_location_id uuid,
  p_exam_type_id uuid
) returns integer
language sql
stable
set search_path = public
as $$
  select case p_appointment_type
    when 'return_visit' then 0
    when 'exam' then (select price_cents from exam_types where id = p_exam_type_id)
    else (select price_first_visit_cents from clinic_locations where id = p_clinic_location_id)
  end;
$$;

-- Gatilho em vez de mexer em cada caminho de marcação (página /agendar,
-- tela da Agenda, exame em grupo). Na marcação, preenche se vier vazio; numa
-- alteração, só recalcula se de fato mudou tipo, local ou exame (ex.:
-- remarcação para outro consultório). Remarcar para o mesmo local mantém o
-- valor original — `reschedule_group_exam_session` (0012) regrava
-- clinic_location_id/appointment_type com os mesmos valores, por isso a
-- comparação com OLD.
create or replace function set_appointment_price() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.price_cents is null then
      new.price_cents := appointment_table_price(new.appointment_type, new.clinic_location_id, new.exam_type_id);
    end if;
  elsif new.appointment_type is distinct from old.appointment_type
     or new.clinic_location_id is distinct from old.clinic_location_id
     or new.exam_type_id is distinct from old.exam_type_id then
    new.price_cents := appointment_table_price(new.appointment_type, new.clinic_location_id, new.exam_type_id);
  end if;
  return new;
end;
$$;

create trigger appointments_set_price
  before insert or update of appointment_type, clinic_location_id, exam_type_id on appointments
  for each row execute function set_appointment_price();

-- Atendimentos já existentes recebem o valor atual da tabela (decisão do
-- cliente). Não dispara o gatilho acima (só price_cents muda).
update appointments
  set price_cents = appointment_table_price(appointment_type, clinic_location_id, exam_type_id)
  where price_cents is null;
