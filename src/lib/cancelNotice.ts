import { formatInstant } from "./clinicTime";
import { whatsappHref } from "./phone";

// Aviso de cancelamento pela clínica enviado à mão pelo WhatsApp de quem
// está no painel (F4.6; cliente, 05/out/2026): o envio automático com o link
// de remarcação vem com o WhatsApp por clínica (F6). Até a página pública do
// link existir (F5), a mensagem pede para responder, sem o link (cliente,
// 05/out); o link já fica gerado e guardado.

export type CancelNoticeInput = {
  clinicName: string;
  contactName: string;
  patientName: string;
  /** O paciente fala por si (sem responsável). */
  isContactSelf: boolean;
  serviceName: string;
  scheduledAt: Date;
  timeZone: string;
};

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export function cancelNoticeText(input: CancelNoticeInput): string {
  const when = formatInstant(input.scheduledAt, input.timeZone, "dd/MM 'às' HH:mm");
  const whose = input.isContactSelf ? "o seu atendimento" : `o atendimento de ${firstName(input.patientName)}`;
  return [
    `Olá, ${firstName(input.contactName)}! Aqui é da ${input.clinicName}.`,
    `Precisamos cancelar ${whose} (${input.serviceName}) de ${when}. Pedimos desculpas pelo transtorno.`,
    "Responda esta mensagem para combinarmos um novo horário.",
  ].join("\n\n");
}

/** wa.me com a mensagem já escrita. */
export function whatsappMessageHref(phone: string, text: string): string {
  return `${whatsappHref(phone)}?text=${encodeURIComponent(text)}`;
}
