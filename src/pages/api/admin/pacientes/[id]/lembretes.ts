import type { APIRoute } from "astro";
import { receivedReturn, safeReturnPath, withReturn } from "../../../../../lib/returnPath";
import { todayIn } from "../../../../../lib/clinicTime";
import { createUserClient } from "../../../../../lib/data/clients";
import { DataError } from "../../../../../lib/data/errors";
import { runFormAction } from "../../../../../lib/data/formAction";
import { addPatientReminder, deletePatientReminder, editPatientReminder, setReminderDone } from "../../../../../lib/data/patientReminders";
import { formText } from "../../../../../lib/forms";

// Lembretes da equipe (CRM P3): criar, corrigir (só o autor), "Feito" e
// "Desfazer" e apagar (só o Administrador, com confirmação na tela). O banco
// confere o papel e o autor. Volta para a aba Lembretes da ficha ou, com
// `return_to`, para a tela de onde veio (o "Feito" do Relacionamento).
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params } = context;
  const clinic = locals.clinic!;
  const patientId = params.id!;
  const form = await request.formData().catch(() => null);
  const db = createUserClient(request, cookies);
  const page = safeReturnPath(
    formText(form, "return_to"),
    withReturn(`/admin/pacientes/${patientId}?aba=lembretes`, receivedReturn(new URL(request.url))),
  );
  const fields = () => ({ body: formText(form, "body"), dueOn: formText(form, "due_on") });

  return runFormAction(
    context,
    async () => {
      switch (formText(form, "acao")) {
        case "criar":
          await addPatientReminder(db, clinic.clinicId, patientId, fields(), todayIn(clinic.timezone));
          return { redirectTo: page, message: "Lembrete salvo." };
        case "editar":
          await editPatientReminder(db, clinic.clinicId, patientId, formText(form, "lembrete"), fields());
          return { redirectTo: page, message: "Lembrete corrigido." };
        case "feito":
          await setReminderDone(db, clinic.clinicId, formText(form, "lembrete"), true);
          return { redirectTo: page, message: "Lembrete feito." };
        case "desfazer":
          await setReminderDone(db, clinic.clinicId, formText(form, "lembrete"), false);
          return { redirectTo: page, message: "Lembrete reaberto." };
        case "apagar":
          await deletePatientReminder(db, clinic.clinicId, patientId, formText(form, "lembrete"));
          return { redirectTo: page, message: "Lembrete apagado." };
        default:
          throw new DataError("invalid", "Ação desconhecida", { acao: "Ação desconhecida." });
      }
    },
    page,
  );
};
