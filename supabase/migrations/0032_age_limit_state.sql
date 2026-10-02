-- Evolução após teste com usuários reais (out/2026): depois da recusa pela
-- idade limite da consulta, o bot pergunta "Deseja agendar para outra
-- criança?" e espera a resposta no estado novo BOOK_AGE_LIMIT. Sem ele na
-- lista, a troca de estado era recusada e a resposta caía no passo anterior.

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
    'BOOK_AGE_LIMIT',
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
