import type { APIRoute } from "astro";
import { createUserClient } from "../../../../lib/data/clients";
import { isCentralActive } from "../../../../lib/data/central";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { getContact, getPatient, updateContact } from "../../../../lib/data/patients";
import { formOptionalText, formText } from "../../../../lib/forms";
import { isUuid } from "../../../../lib/clinicAccess";
import { safeReturnPath } from "../../../../lib/returnPath";

// "É de um paciente já cadastrado" (CN3b; tela T3, cliente, 05/nov/2026): o número da conversa, sem cadastro, passa a
// ser o WhatsApp do contato do paciente escolhido (com confirmação na tela; se o contato tem outros pacientes, muda
// para todos), e a conversa fica ligada a esse contato. Administrador e Recepção.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const clinic = locals.clinic!;
  const form = await request.formData().catch(() => null);
  const back = safeReturnPath(formOptionalText(form, "return_to"), "/admin/conversas");
  return runFormAction(
    context,
    async () => {
      if (!clinic.isPlatformStaff && !clinic.roles.some((role) => role === "admin" || role === "reception")) {
        throw new DataError("forbidden", "Conversas: só o Administrador e a Recepção ligam o número a um paciente");
      }
      const db = createUserClient(request, cookies);
      if (!(await isCentralActive(db, clinic.clinicId))) throw new DataError("forbidden", "Conversas: a Central de atendimento está desligada");
      const phone = formText(form, "telefone");
      const patientId = formText(form, "paciente");
      if (!/^\+\d{10,15}$/.test(phone) || !isUuid(patientId)) throw new DataError("not_found", "Conversas: paciente não encontrado");
      const patient = await getPatient(db, clinic.clinicId, patientId);
      const contact = await getContact(db, clinic.clinicId, patient.contactId);
      await updateContact(db, clinic.clinicId, contact.id, { fullName: contact.fullName, phone });
      const { error } = await db.from("conversation_state").update({ contact_id: contact.id }).eq("clinic_id", clinic.clinicId).eq("contact_phone", phone);
      if (error) throw new DataError("unexpected", `Conversas: ${error.message}`);
      return { redirectTo: back, message: `Número ligado a ${patient.fullName}: o WhatsApp de ${contact.fullName} passou a ser este.` };
    },
    back,
  );
};
