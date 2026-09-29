// Confirmação de presença pelo paciente (Fase 19) — registro à parte do
// `status` do atendimento (ver migração 0024).

// Remarcar (link do bot ou tela) zera o lembrete e a confirmação: a data
// nova pede um novo lembrete e uma nova confirmação de presença. Somar ao
// `update` de autoria da remarcação.
export const RESCHEDULE_PRESENCE_RESET = {
  reminder_sent_at: null,
  patient_confirmed_at: null,
  patient_confirmed_by: null,
  reminder_response: null,
  reminder_response_at: null,
} as const;
