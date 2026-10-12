import type { APIRoute } from "astro";
import { isUuid } from "../../../../../lib/clinicAccess";
import { receivedReturn, withReturn } from "../../../../../lib/returnPath";
import { createUserClient } from "../../../../../lib/data/clients";
import { DataError } from "../../../../../lib/data/errors";
import { saveContactCpf } from "../../../../../lib/data/finance";
import { runFormAction } from "../../../../../lib/data/formAction";
import { getContact } from "../../../../../lib/data/patients";
import { formOptionalText } from "../../../../../lib/forms";

// Módulo financeiro (F11.1): CPF do contato, pelo cartão "Financeiro" da tela
// do contato. Vale para todos os pacientes dele. Só o Administrador e a
// Recepção, com o item liberado (conferido pela área da rota e no banco).
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params } = context;
  const id = params.id!;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const db = createUserClient(request, cookies);
  const page = withReturn(`/admin/pacientes/contato/${id}`, receivedReturn(new URL(request.url)));

  return runFormAction(
    context,
    async () => {
      if (!isUuid(id)) throw new DataError("not_found", "Contato: não encontrado");
      const contact = await getContact(db, clinic.clinicId, id);
      if (contact.anonymizedAt) throw new DataError("invalid", "Contato anonimizado: não recebe dados financeiros");
      await saveContactCpf(db, clinic.clinicId, contact.id, formOptionalText(form, "cpf"));
      return { redirectTo: page, message: "CPF salvo." };
    },
    page,
  );
};
