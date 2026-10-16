// Resposta ao lembrete gravada em `appointments.reminder_response` (F7):
// 'confirmed', 'reschedule' ou 'cancel' (ver a migração do lembrete). O botão
// do WhatsApp se chama "confirm", mas o banco guarda "confirmed"; antes de
// 15/out/2026 a Agenda, o Resumo do Dia e os Lembretes comparavam com
// "confirm" e nunca mostravam quem confirmou pelo lembrete.
export const REMINDER_CONFIRMED = "confirmed";

/** O contato confirmou pelo botão do lembrete. */
export function confirmedByReminder(response: string | null): boolean {
  return response === REMINDER_CONFIRMED;
}

/** Mensagem recebida do toque no lembrete (`reminder_<botão>`) → a resposta, como o banco guarda. */
const RESPONSE_BY_TAP_MESSAGE: Record<string, string> = {
  reminder_confirm: REMINDER_CONFIRMED,
  reminder_reschedule: "reschedule",
  reminder_cancel: "cancel",
};
export const REMINDER_TAP_MESSAGE_TYPES = Object.keys(RESPONSE_BY_TAP_MESSAGE);

export function responseFromTapMessage(messageType: string): string | null {
  return RESPONSE_BY_TAP_MESSAGE[messageType] ?? null;
}
