import type { PreparationSender } from "./preparation";
import type { ReminderSender } from "./reminders";

// Envio pelo WhatsApp a partir do painel (botões de lembrete e de preparo da
// Agenda, F4.5). O envio de verdade, com o número e o token de cada clínica,
// é ligado na F6 (plano); até lá não há quem envie, e a tela avisa sem
// registrar tentativa nenhuma.

export const SENDING_NOT_READY = "O envio pelo WhatsApp ainda não está ligado no RecepClinic (entra na fase do WhatsApp por clínica).";

export function panelReminderSender(): ReminderSender | null {
  return null;
}

export function panelPreparationSender(): PreparationSender | null {
  return null;
}
