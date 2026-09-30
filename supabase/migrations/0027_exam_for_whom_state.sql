-- Fase 21 · etapa 5: Marcar exame > "O exame é para você ou para outra
-- pessoa?" — novo estado EXAM_FOR_WHOM (pergunta + cadastro do próprio
-- paciente adulto: data de nascimento, nome e confirmação).

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
    'EXAM_FOR_WHOM',
    'CANCEL_SELECT',
    'CANCEL_CONFIRM',
    'RESCHEDULE_SELECT',
    'RESCHEDULE_HOME_ADDRESS',
    'RESCHEDULE_CONFIRM',
    'INFO_MENU',
    'INFO_PREP_SELECT',
    'HUMAN_HANDOFF'
  ));
