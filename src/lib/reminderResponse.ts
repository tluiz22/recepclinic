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
