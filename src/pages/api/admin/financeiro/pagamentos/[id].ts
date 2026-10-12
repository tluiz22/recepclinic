import type { APIRoute } from "astro";
import { isUuid } from "../../../../../lib/clinicAccess";
import { todayIn } from "../../../../../lib/clinicTime";
import { getAgendaAppointment } from "../../../../../lib/data/agenda/view";
import { createUserClient } from "../../../../../lib/data/clients";
import { DataError } from "../../../../../lib/data/errors";
import { runFormAction } from "../../../../../lib/data/formAction";
import { getContact, getPatient } from "../../../../../lib/data/patients";
import { deletePayment, registerPayment } from "../../../../../lib/data/payments";
import { formMoneyCents, formOptionalText, formText } from "../../../../../lib/forms";
import { formatCentsBRL } from "../../../../../lib/money";
import { receivedReturn, withReturn } from "../../../../../lib/returnPath";

// Pagamentos do atendimento (F11.2), pela tela Financeiro › Pagamento:
// registrar (volta para a tela de onde a pessoa veio, como o Remarcar) e
// excluir (fica na tela do pagamento). Só o Administrador e a Recepção, com o
// Módulo financeiro (conferido pela área da rota e de novo no banco).
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params } = context;
  const id = params.id!;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const db = createUserClient(request, cookies);
  const volta = receivedReturn(new URL(request.url));
  const page = withReturn(`/admin/financeiro/pagamento/${id}`, volta);
  const acao = formText(form, "acao");

  return runFormAction(
    context,
    async () => {
      if (!isUuid(id)) throw new DataError("not_found", "Atendimento: não encontrado");
      const appointment = await getAgendaAppointment(db, clinic.clinicId, id);
      if (!appointment) throw new DataError("not_found", "Atendimento: não encontrado");
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
      return {
        redirectTo: volta ?? page,
        message: `Pagamento de ${formatCentsBRL(payment.amountCents)} registrado para ${appointment.patientName}.${payment.payerCpf ? "" : " Falta o CPF de quem pagou para a nota fiscal."}`,
      };
    },
    page,
  );
};
