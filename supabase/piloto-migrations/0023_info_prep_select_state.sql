-- Fase 18 · etapa 3: Informações gerais > Preparo para exames — novo estado
-- INFO_PREP_SELECT (o responsável escolhe o exame na lista e o bot manda o
-- preparo formatado + o link da página /preparo/[id]).

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
    'RESCHEDULE_HOME_ADDRESS',
    'RESCHEDULE_CONFIRM',
    'INFO_MENU',
    'INFO_PREP_SELECT',
    'HUMAN_HANDOFF'
  ));
