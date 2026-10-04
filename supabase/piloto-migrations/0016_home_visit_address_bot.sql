-- Fase 16 · etapa 2: bot de WhatsApp pergunta/confirma o endereço do
-- atendimento domiciliar antes de gerar o link de agendamento.

-- Carrega o endereço já confirmado na conversa até a criação da consulta em
-- `/agendar/[token]` (a consulta em si só nasce lá, não no bot) — mesmo
-- padrão já usado para `exam_type_id`/`location_category` nesta tabela.
alter table booking_links
  add column home_visit_address text;

-- Novo estado BOOK_HOME_ADDRESS: pergunta o endereço (ou confirma o padrão
-- salvo do responsável) logo depois de escolher "Atendimento domiciliar",
-- antes de identificar a criança.
alter table conversation_state drop constraint conversation_state_state_check;
alter table conversation_state add constraint conversation_state_state_check
  check (state in (
    'WELCOME',
    'MENU',
    'CONSULTAS_MENU',
    'EXAMES_MENU',
    'BOOK_MODALITY',
    'BOOK_LOCATION',
    'BOOK_HOME_ADDRESS',
    'BOOK_PATIENT_SELECT',
    'BOOK_PATIENT_NEW',
    'BOOK_SLOT_SELECT',
    'BOOK_CONFIRM',
    'EXAM_TYPE_SELECT',
    'CANCEL_SELECT',
    'CANCEL_CONFIRM',
    'RESCHEDULE_SELECT',
    'RESCHEDULE_CONFIRM',
    'INFO_MENU',
    'HUMAN_HANDOFF'
  ));
