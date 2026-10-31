import type { APIRoute } from "astro";
import { safeReturnPath } from "../../../../lib/returnPath";
import { createUserClient } from "../../../../lib/data/clients";
import { runFormAction } from "../../../../lib/data/formAction";
import { dismissRecall } from "../../../../lib/data/relationship";
import { formText } from "../../../../lib/forms";

// Relacionamento › Retomar contato: "Retirar da lista" (cliente, 31/out/2026),
// com confirmação na tela. O banco confere o papel (Administrador e Recepção).
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const clinic = locals.clinic!;
  const form = await request.formData().catch(() => null);
  const db = createUserClient(request, cookies);
  const page = safeReturnPath(formText(form, "return_to"), "/admin/relacionamento?tab=retomar_contato");

  return runFormAction(
    context,
    async () => {
      await dismissRecall(db, clinic.clinicId, formText(form, "telefone"), formText(form, "fluxo"));
      return { redirectTo: page, message: "Retirado da lista." };
    },
    page,
  );
};
