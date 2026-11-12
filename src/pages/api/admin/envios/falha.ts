import type { APIRoute } from "astro";
import { isUuid } from "../../../../lib/clinicAccess";
import { safeReturnPath } from "../../../../lib/returnPath";
import { getAppointment } from "../../../../lib/data/agenda/appointments";
import { createUserClient } from "../../../../lib/data/clients";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { getContact, updateContact } from "../../../../lib/data/patients";
import { clinicSenderFor } from "../../../../lib/data/whatsapp/clinicSender";
import { sendAppointmentNotice, type NoticeKind } from "../../../../lib/data/whatsapp/notices";
import { dismissSendFailure, getOutboundMessage } from "../../../../lib/data/whatsapp/undeliverable";
import { formOptionalText, formText } from "../../../../lib/forms";
import { formatPhoneBR } from "../../../../lib/phone";

// Envio com falha (cliente, 05/nov/2026; docs/arquivo/modulos/falhas-de-envio.md):
// - `descartar`: o Suporte tira da aba Envios o erro já conhecido e resolvido (sem confirmação);
// - `numero_certo`: a recepção tira do Início o aviso de número sem WhatsApp;
// - `corrigir`: a recepção corrige o WhatsApp do contato; se a mensagem era a confirmação (ou a remarcação) de um
//   atendimento que ainda vai acontecer, ela sai de novo para o número novo, e a Agenda acompanha a entrega.
// O banco confere o papel em cada uma.

const NOTICE_OF: Record<string, NoticeKind> = { appointment_confirmation: "confirmation", appointment_reschedule: "reschedule" };
const RESENT_TEXT: Record<string, string> = {
  sent: "A confirmação foi enviada de novo para o número novo.",
  failed: "A confirmação não saiu de novo: o WhatsApp recusou o envio.",
  skipped_no_template: "A confirmação não saiu de novo: a mensagem ainda não está aprovada pela Meta.",
  not_connected: "A confirmação não saiu de novo: o WhatsApp da clínica não está conectado.",
};

export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const db = createUserClient(request, cookies);
  const returnTo = safeReturnPath(formOptionalText(form, "return_to"), "/admin/dashboard");

  return runFormAction(
    context,
    async () => {
      const messageId = formOptionalText(form, "mensagem");
      const eventText = formOptionalText(form, "evento");
      const eventId = eventText && /^\d{1,18}$/.test(eventText) ? Number(eventText) : null;
      if (messageId !== null && !isUuid(messageId)) throw new DataError("not_found", "Envio: não encontrado");

      switch (formText(form, "acao")) {
        case "descartar": {
          if (messageId) await dismissSendFailure(db, clinic.clinicId, "envios", { messageId });
          else if (eventId !== null) await dismissSendFailure(db, clinic.clinicId, "envios", { eventId });
          else throw new DataError("not_found", "Envio: não encontrado");
          return { redirectTo: returnTo, message: "Falha descartada: saiu da lista de envios com falha." };
        }
        case "numero_certo": {
          if (!messageId) throw new DataError("not_found", "Envio: não encontrado");
          await dismissSendFailure(db, clinic.clinicId, "inicio", { messageId });
          return { redirectTo: returnTo, message: "Aviso dispensado: o número continua o mesmo." };
        }
        case "corrigir": {
          if (!messageId) throw new DataError("not_found", "Envio: não encontrado");
          const message = await getOutboundMessage(db, clinic.clinicId, messageId);
          if (!message.contactId) throw new DataError("not_found", "Contato: não encontrado");
          const contact = await getContact(db, clinic.clinicId, message.contactId);
          let saved;
          try {
            saved = await updateContact(db, clinic.clinicId, contact.id, { fullName: contact.fullName, phone: formText(form, "phone") });
          } catch (error) {
            if (error instanceof DataError && error.code === "duplicate") {
              throw new DataError("duplicate", "Contato: este WhatsApp já é de outro cadastro", { phone: "Este WhatsApp já é de outro cadastro." });
            }
            throw error;
          }
          let text = `WhatsApp de ${contact.fullName} corrigido para ${formatPhoneBR(saved.phone)}.`;
          let redirectTo = returnTo;
          const kind = NOTICE_OF[message.messageType];
          if (kind && message.appointmentId && saved.phone !== message.phone) {
            const appointment = await getAppointment(db, clinic.clinicId, message.appointmentId);
            if ((appointment.status === "scheduled" || appointment.status === "confirmed") && appointment.scheduledAt.getTime() > Date.now()) {
              const sender = await clinicSenderFor(clinic.clinicId, request.url);
              const status = await sendAppointmentNotice(db, clinic.clinicId, appointment.id, kind, sender);
              text += ` ${RESENT_TEXT[status]}`;
              // Na Agenda, o aviso do topo acompanha a entrega da confirmação nova.
              if (status === "sent" && redirectTo.startsWith("/admin/agenda")) {
                const url = new URL(redirectTo, "http://local");
                url.searchParams.set("envio", appointment.id);
                redirectTo = `${url.pathname}${url.search}`;
              }
            }
          }
          return { redirectTo, message: text };
        }
        default:
          throw new DataError("invalid", "Ação desconhecida", { acao: "Ação desconhecida." });
      }
    },
    returnTo,
  );
};
