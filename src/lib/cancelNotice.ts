import { formatInstant } from "./clinicTime";
import { whatsappHref } from "./phone";

// Aviso de cancelamento pela clínica enviado à mão pelo WhatsApp de quem
// está no painel (F4.6; cliente, 05/out/2026): o envio automático vem com o
// WhatsApp por clínica (F6). Com o link de remarcação válido (F5.4; cliente,
// 06/out), a mensagem leva o link com a validade e "Se preferir, responda";
// sem link (bot não liberado, link vencido ou usado), pede para responder.

export type CancelNoticeInput = {
  clinicName: string;
  contactName: string;
  patientName: string;
  /** O paciente fala por si (sem responsável). */
  isContactSelf: boolean;
  serviceName: string;
  scheduledAt: Date;
  timeZone: string;
  /** Link de remarcação válido: endereço completo e até quando vale. */
  rebooking?: { url: string; expiresAt: Date } | null;
};

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export function cancelNoticeText(input: CancelNoticeInput): string {
  const when = formatInstant(input.scheduledAt, input.timeZone, "dd/MM 'às' HH:mm");
  const whose = input.isContactSelf ? "o seu atendimento" : `o atendimento de ${firstName(input.patientName)}`;
  const next = input.rebooking
    ? [
        `Para escolher um novo horário, use o link (vale até ${formatInstant(input.rebooking.expiresAt, input.timeZone, "dd/MM 'às' HH:mm")}):\n${input.rebooking.url}`,
        "Se preferir, responda esta mensagem.",
      ]
    : ["Responda esta mensagem para combinarmos um novo horário."];
  return [
    `Olá, ${firstName(input.contactName)}! Aqui é da ${input.clinicName}.`,
    `Precisamos cancelar ${whose} (${input.serviceName}) de ${when}. Pedimos desculpas pelo transtorno.`,
    ...next,
  ].join("\n\n");
}

/** wa.me com a mensagem já escrita. */
export function whatsappMessageHref(phone: string, text: string): string {
  return `${whatsappHref(phone)}?text=${encodeURIComponent(text)}`;
}
