import type { APIRoute } from "astro";
import { isUuid } from "../../../../lib/clinicAccess";
import { todayIn } from "../../../../lib/clinicTime";
import { createUserClient } from "../../../../lib/data/clients";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { setPatientActive, setPatientInsurance, updatePatient } from "../../../../lib/data/patients";
import { formOptionalText, formText } from "../../../../lib/forms";

// Paciente (F4.7): salvar dados, plano de saúde (com o item), desativar e reativar.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params } = context;
  const id = params.id!;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const db = createUserClient(request, cookies);
  const page = `/admin/pacientes/${id}`;

  return runFormAction(
    context,
    async () => {
      if (!isUuid(id)) throw new DataError("not_found", "Paciente: não encontrado");
      switch (formText(form, "acao")) {
        case "salvar":
          await updatePatient(
            db,
            clinic.clinicId,
            id,
            { fullName: formText(form, "full_name"), birthdate: formText(form, "birthdate"), notes: formOptionalText(form, "notes") },
            todayIn(clinic.timezone),
          );
          return { redirectTo: page, message: "Dados salvos." };
        case "plano": {
          if (!clinic.features.includes("insurance")) throw new DataError("not_enabled", "Convênios não liberados");
          const planId = formOptionalText(form, "plan_id");
          await setPatientInsurance(
            db,
            clinic.clinicId,
            id,
            planId ? { planId, cardNumber: formOptionalText(form, "card_number"), cardValidUntil: formOptionalText(form, "card_valid_until") } : null,
          );
          return { redirectTo: page, message: planId ? "Plano salvo." : "Agora é particular." };
        }
        case "desativar":
        case "reativar": {
          const active = formText(form, "acao") === "reativar";
          await setPatientActive(db, clinic.clinicId, id, active);
          return { redirectTo: page, message: active ? "Reativado." : "Desativado: sai das buscas do Marcar; o histórico fica." };
        }
        default:
          throw new DataError("invalid", "Ação desconhecida", { acao: "Ação desconhecida." });
      }
    },
    page,
  );
};
