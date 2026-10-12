import type { APIRoute } from "astro";
import { isUuid } from "../../../../../lib/clinicAccess";
import { todayIn } from "../../../../../lib/clinicTime";
import { getAgendaAppointment } from "../../../../../lib/data/agenda/view";
import { createUserClient } from "../../../../../lib/data/clients";
import { DataError } from "../../../../../lib/data/errors";
import { describeDataError, runFormAction } from "../../../../../lib/data/formAction";
import { logError } from "../../../../../lib/log";
import { getContact, getPatient } from "../../../../../lib/data/patients";
import { cancelNfse, checkNfse, issueNfse, listPaymentInvoices } from "../../../../../lib/data/nfse";
import { deliverAfterIssue, deliverInvoice, describeDelivery, type DeliveryDeps } from "../../../../../lib/data/nfseDelivery";
import { clinicSenderFor } from "../../../../../lib/data/whatsapp/clinicSender";
import { smtpSender } from "../../../../../lib/email";
import { platformEnv } from "../../../../../lib/env";
import { deletePayment, registerPayment } from "../../../../../lib/data/payments";
import { formChecked, formInt, formMoneyCents, formOptionalText, formText } from "../../../../../lib/forms";
import { formatCentsBRL } from "../../../../../lib/money";
import { receivedReturn, withReturn } from "../../../../../lib/returnPath";

// Pagamentos do atendimento (F11.2), pela tela Financeiro › Pagamento:
// registrar (volta para a tela de onde a pessoa veio, como o Remarcar) e
// excluir (fica na tela do pagamento). Só o Administrador e a Recepção, com o
// Módulo financeiro (conferido pela área da rota e de novo no banco).
// Nota fiscal (F11.4): emitir junto do registro ou depois, conferir na
// Receita (resposta perdida) e cancelar (só o Administrador; o banco confere).
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params } = context;
  const id = params.id!;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const db = createUserClient(request, cookies);
  const volta = receivedReturn(new URL(request.url));
  const page = withReturn(`/admin/financeiro/pagamento/${id}`, volta);
  const acao = formText(form, "acao");
  // Envio da nota (F11.5): WhatsApp da clínica e e-mail do sistema.
  const deliveryDeps = async (): Promise<DeliveryDeps> => ({ sender: await clinicSenderFor(clinic.clinicId, request.url), sendEmail: smtpSender(platformEnv().email) });
  /** Nota emitida: em Produção, vai sozinha para o contato (e os destinos com "enviar sempre"). */
  const afterIssue = async (paymentId: string, status: string): Promise<string> => {
    if (status !== "issued") return "";
    try {
      const [invoice] = (await listPaymentInvoices(db, clinic.clinicId, [paymentId])).get(paymentId) ?? [];
      if (!invoice || invoice.status !== "issued") return "";
      const lines = await deliverAfterIssue(db, clinic.clinicId, invoice.id, await deliveryDeps());
      return lines.length ? ` ${describeDelivery(lines)}.` : "";
    } catch (error) {
      logError("nota fiscal: envio automático", error, { clinica: clinic.clinicId, pagamento: paymentId });
      return " A nota não foi enviada sozinha: use \"Enviar nota\".";
    }
  };

  return runFormAction(
    context,
    async () => {
      if (!isUuid(id)) throw new DataError("not_found", "Atendimento: não encontrado");
      const appointment = await getAgendaAppointment(db, clinic.clinicId, id);
      if (!appointment) throw new DataError("not_found", "Atendimento: não encontrado");
      if (acao === "emitir_nota") {
        const paymentId = formText(form, "payment_id");
        if (!isUuid(paymentId)) throw new DataError("not_found", "Pagamento: não encontrado");
        const result = await issueNfse(db, clinic.clinicId, paymentId);
        return { redirectTo: page, message: `${result.message}${await afterIssue(paymentId, result.status)}` };
      }
      if (acao === "enviar_nota") {
        const invoiceId = formText(form, "invoice_id");
        if (!isUuid(invoiceId)) throw new DataError("not_found", "Nota fiscal: não encontrada");
        const lines = await deliverInvoice(
          db,
          clinic.clinicId,
          invoiceId,
          {
            contact: formChecked(form, "para_contato"),
            phone: formChecked(form, "para_numero") ? formOptionalText(form, "numero") : null,
            email: formChecked(form, "para_email") ? formOptionalText(form, "email") : null,
            save: formChecked(form, "guardar"),
            autoSend: formChecked(form, "enviar_sempre"),
          },
          await deliveryDeps(),
        );
        return { redirectTo: page, message: `${describeDelivery(lines)}.` };
      }
      if (acao === "conferir_nota" || acao === "cancelar_nota") {
        const invoiceId = formText(form, "invoice_id");
        if (!isUuid(invoiceId)) throw new DataError("not_found", "Nota fiscal: não encontrada");
        const result =
          acao === "conferir_nota"
            ? await checkNfse(db, clinic.clinicId, invoiceId)
            : await cancelNfse(db, clinic.clinicId, invoiceId, { code: formInt(form, "motivo"), text: formText(form, "motivo_texto") }, clinic.timezone);
        const paymentId = formText(form, "payment_id");
        const sent = acao === "conferir_nota" && isUuid(paymentId) ? await afterIssue(paymentId, result.status) : "";
        return { redirectTo: page, message: `${result.message}${sent}` };
      }
      if (acao === "excluir") {
        const paymentId = formText(form, "payment_id");
        if (!isUuid(paymentId)) throw new DataError("not_found", "Pagamento: não encontrado");
        await deletePayment(db, clinic.clinicId, paymentId);
        return { redirectTo: page, message: "Pagamento excluído." };
      }
      if (acao !== "registrar") throw new DataError("invalid", "Pagamento: ação desconhecida");
      const patient = await getPatient(db, clinic.clinicId, appointment.patientId);
      if (patient.anonymizedAt) throw new DataError("invalid", "Paciente anonimizado: não recebe pagamento novo");
      const contact = await getContact(db, clinic.clinicId, patient.contactId);
      const payment = await registerPayment(
        db,
        clinic.clinicId,
        { appointmentId: appointment.id, status: appointment.status, patient, contact, today: todayIn(clinic.timezone) },
        {
          amountCents: formMoneyCents(form, "amount"),
          method: formText(form, "method"),
          paidOn: formText(form, "paid_on"),
          payer: formText(form, "payer"),
          payerName: formOptionalText(form, "payer_name"),
          payerCpf: formOptionalText(form, "payer_cpf"),
        },
      );
      const registered = `Pagamento de ${formatCentsBRL(payment.amountCents)} registrado para ${appointment.patientName}.`;
      if (!formChecked(form, "emitir_nota")) {
        return { redirectTo: volta ?? page, message: `${registered}${payment.payerCpf ? "" : " Falta o CPF de quem pagou para a nota fiscal."}` };
      }
      if (!payment.payerCpf) return { redirectTo: page, message: `${registered} A nota fiscal não saiu: falta o CPF de quem pagou.` };
      // A nota sai na hora; qualquer problema fica na tela do pagamento, com o motivo.
      try {
        const result = await issueNfse(db, clinic.clinicId, payment.id);
        return { redirectTo: result.status === "issued" ? (volta ?? page) : page, message: `${registered} ${result.message}${await afterIssue(payment.id, result.status)}` };
      } catch (error) {
        const reason = error instanceof DataError ? describeDataError(error) : "não foi possível falar com a Receita agora.";
        if (!(error instanceof DataError)) logError("nota fiscal", error, { clinica: clinic.clinicId, pagamento: payment.id });
        return { redirectTo: page, message: `${registered} A nota fiscal não saiu: ${reason} Emita pelo botão "Emitir nota".` };
      }
    },
    page,
  );
};
