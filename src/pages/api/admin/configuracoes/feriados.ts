import type { APIRoute } from "astro";
import { createUserClient } from "../../../../lib/data/clients";
import { addClinicHoliday, removeClinicHoliday } from "../../../../lib/data/config/holidays";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { formText } from "../../../../lib/forms";

// Feriados da clínica (F4.4b): adicionar e remover (um por data).
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const clinicId = locals.clinic!.clinicId;
  const db = createUserClient(request, cookies);
  const page = "/admin/configuracoes/feriados";

  return runFormAction(
    context,
    async () => {
      switch (formText(form, "acao")) {
        case "adicionar":
          await addClinicHoliday(db, clinicId, { date: formText(form, "date"), description: formText(form, "description") });
          return { redirectTo: page, message: "Feriado adicionado." };
        case "remover":
          await removeClinicHoliday(db, clinicId, formText(form, "holiday_id"));
          return { redirectTo: page, message: "Feriado removido." };
        default:
          throw new DataError("invalid", "Ação desconhecida", { acao: "Ação desconhecida." });
      }
    },
    page,
  );
};
