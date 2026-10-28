import type { APIRoute } from "astro";
import { safeReturnPath, withReturn } from "../../../../lib/returnPath";
import { createUserClient } from "../../../../lib/data/clients";
import { parseRegisterRequest, registerContact, registerParams, resolveRegisterTarget } from "../../../../lib/data/contactInteractions";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { formOptionalText, formText } from "../../../../lib/forms";

// Relacionamento › Registrar contato (CRM C2): grava o resultado e volta para
// a tela de onde veio (a aba da central ou a ficha do paciente). Quem e qual
// pendência são conferidos de novo aqui; o banco confere o papel, o item
// "Relacionamento", o paciente e o "Marcou".
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const db = createUserClient(request, cookies);
  const get = (name: string) => (form ? formOptionalText(form, name) : null);
  const req = parseRegisterRequest(get);
  const back = safeReturnPath(get("return_to"), "/admin/relacionamento");
  const page = req ? withReturn(`/admin/relacionamento/registrar?${new URLSearchParams(registerParams(req))}`, back) : back;

  return runFormAction(
    context,
    async () => {
      if (!req) throw new DataError("not_found", "Registro de contato: origem desconhecida");
      const target = await resolveRegisterTarget(db, clinic.clinicId, req);
      const { exits } = await registerContact(db, clinic.clinicId, target, { outcome: formText(form, "outcome"), note: formOptionalText(form, "note") });
      const who = target.patientName ?? target.contactName ?? "O contato";
      const message =
        req.source === "ficha_paciente"
          ? "Contato registrado."
          : exits
            ? `Contato registrado. ${who} saiu da lista.`
            : req.source === "aguardando_remarcacao"
              ? "Contato registrado. Continua na lista até remarcar ou desistir."
              : "Contato registrado. Continua na lista, com a tentativa.";
      return { redirectTo: back, message };
    },
    page,
  );
};
