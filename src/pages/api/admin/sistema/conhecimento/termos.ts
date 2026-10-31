import type { APIRoute } from "astro";
import { createUserClient } from "../../../../../lib/data/clients";
import { runFormAction } from "../../../../../lib/data/formAction";
import { addClinicalTerm, parseList, saveSpecialty, setClinicalTermActive } from "../../../../../lib/data/knowledge/admin";
import { formChecked, formOptionalText, formText } from "../../../../../lib/forms";

// Dicionário de especialidades e termos do filtro clínico (BC 3.3). Só o
// Suporte. Valem no bot depois de publicar.
const BACK = "/admin/sistema/conhecimento/termos";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData().catch(() => null);
  const db = createUserClient(context.request, context.cookies);
  const action = formText(form, "acao");
  return runFormAction(
    context,
    async () => {
      switch (action) {
        case "especialidade":
          await saveSpecialty(db, {
            id: formOptionalText(form, "id") ?? undefined,
            name: formText(form, "name"),
            terms: parseList(formText(form, "terms")),
            isActive: formOptionalText(form, "id") ? formChecked(form, "is_active") : true,
          });
          return { redirectTo: `${BACK}#especialidades`, message: "Especialidade salva. Vale no bot depois de publicar." };
        case "termo":
          await addClinicalTerm(db, formText(form, "group"), formText(form, "term"));
          return { redirectTo: `${BACK}#filtro`, message: "Termo incluído. Vale no bot depois de publicar." };
        case "termo_ativo":
          await setClinicalTermActive(db, formText(form, "id"), formChecked(form, "is_active"));
          return { redirectTo: `${BACK}#filtro`, message: "Termo alterado. Vale no bot depois de publicar." };
        default:
          return { redirectTo: BACK, message: "Nada foi alterado." };
      }
    },
    BACK,
  );
};
