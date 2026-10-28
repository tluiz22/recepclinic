import type { APIRoute } from "astro";
import { receivedReturn, withReturn } from "../../../../../lib/returnPath";
import { createUserClient } from "../../../../../lib/data/clients";
import { DataError } from "../../../../../lib/data/errors";
import { runFormAction } from "../../../../../lib/data/formAction";
import { addPatientNote, deletePatientNote, editPatientNote } from "../../../../../lib/data/patientNotes";
import { formText } from "../../../../../lib/forms";

// Anotações do paciente (CRM P2): escrever, editar (só o autor) e apagar (só o
// Administrador, com confirmação na tela). O banco confere o papel e o autor.
// Volta para a aba Anotações da ficha.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params } = context;
  const clinic = locals.clinic!;
  const patientId = params.id!;
  const form = await request.formData().catch(() => null);
  const db = createUserClient(request, cookies);
  const page = withReturn(`/admin/pacientes/${patientId}?aba=anotacoes`, receivedReturn(new URL(request.url)));

  return runFormAction(
    context,
    async () => {
      switch (formText(form, "acao")) {
        case "escrever":
          await addPatientNote(db, clinic.clinicId, patientId, formText(form, "body"));
          return { redirectTo: page, message: "Anotação salva." };
        case "editar":
          await editPatientNote(db, clinic.clinicId, patientId, formText(form, "anotacao"), formText(form, "body"));
          return { redirectTo: page, message: "Anotação corrigida." };
        case "apagar":
          await deletePatientNote(db, clinic.clinicId, patientId, formText(form, "anotacao"));
          return { redirectTo: page, message: "Anotação apagada." };
        default:
          throw new DataError("invalid", "Ação desconhecida", { acao: "Ação desconhecida." });
      }
    },
    page,
  );
};
