import type { APIRoute } from "astro";
import { isUuid } from "../../../../../lib/clinicAccess";
import { receivedReturn, withReturn } from "../../../../../lib/returnPath";
import { createUserClient } from "../../../../../lib/data/clients";
import { DataError } from "../../../../../lib/data/errors";
import { parsePayerContact, savePatientFinance, savePayerContact, type Payer } from "../../../../../lib/data/finance";
import { runFormAction } from "../../../../../lib/data/formAction";
import { getPatient } from "../../../../../lib/data/patients";
import { formChecked, formOptionalText, formText, payerContactFromForm } from "../../../../../lib/forms";

// Módulo financeiro (F11.1): CPF e responsável financeiro do paciente, pelo
// cartão "Financeiro" da tela do paciente. Só o Administrador e a Recepção,
// com o item liberado (conferido pela área da rota e de novo no banco).
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params } = context;
  const id = params.id!;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const db = createUserClient(request, cookies);
  const page = withReturn(`/admin/pacientes/${id}`, receivedReturn(new URL(request.url)));

  return runFormAction(
    context,
    async () => {
      if (!isUuid(id)) throw new DataError("not_found", "Paciente: não encontrado");
      const patient = await getPatient(db, clinic.clinicId, id);
      if (patient.anonymizedAt) throw new DataError("invalid", "Paciente anonimizado: não recebe dados financeiros");
      // N3a: e-mail e endereço de quem paga (opcionais aqui; validados se vierem).
      const payerContact = parsePayerContact(payerContactFromForm(form));
      await savePatientFinance(db, clinic.clinicId, patient, {
        cpf: formOptionalText(form, "cpf"),
        payer: formText(form, "payer"),
        payerName: formOptionalText(form, "payer_name"),
        payerCpf: formOptionalText(form, "payer_cpf"),
        contactCpf: formOptionalText(form, "contact_cpf"),
        invoicePhone: formOptionalText(form, "invoice_phone"),
        invoiceEmail: formOptionalText(form, "invoice_email"),
        invoiceAutoSend: formChecked(form, "invoice_auto_send"),
      });
      const payer = (["contact", "patient", "other"] as const).find((p) => p === formText(form, "payer")) ?? ("contact" as Payer);
      await savePayerContact(db, clinic.clinicId, patient, payer, payerContact);
      return { redirectTo: page, message: "Dados financeiros salvos." };
    },
    page,
  );
};
