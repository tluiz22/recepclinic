-- Fase 19 · etapa 1: confirmação de presença pelo paciente (lembrete com
-- botões) e resposta ao lembrete.
--
-- "Presença confirmada" (paciente, antes do atendimento) é um registro à
-- parte e NÃO mexe em `status`, que continua sendo só do ciclo do atendimento
-- (scheduled → completed / no_show / canceled). O `status = 'confirmed'` e o
-- `confirmed_at` da 0001 continuam sem uso.
--
-- Remarcar (link do bot ou tela) zera estes campos e o `reminder_sent_at`:
-- a data nova pede um novo lembrete e uma nova confirmação.
alter table appointments
  -- Quem confirmou: nulo = WhatsApp (mesmo padrão de autoria da Fase 17);
  -- preenchido = login da tela (confirmação manual por ligação/texto).
  add column patient_confirmed_at timestamptz,
  add column patient_confirmed_by uuid references auth.users (id) on delete set null,
  -- Botão tocado no lembrete (só o toque do paciente; a confirmação manual
  -- pela tela não entra aqui). Nulo = não respondeu.
  add column reminder_response text check (reminder_response in ('confirmed', 'reschedule', 'cancel')),
  add column reminder_response_at timestamptz;
