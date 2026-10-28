import type { APIRoute } from "astro";
import { isUuid } from "../../../../lib/clinicAccess";
import { receivedReturn, withReturn } from "../../../../lib/returnPath";
import { todayIn } from "../../../../lib/clinicTime";
import { createUserClient } from "../../../../lib/data/clients";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { anonymizePatient, setPatientActive, setPatientInsurance, updatePatient } from "../../../../lib/data/patients";
import { formOptionalText, formText } from "../../../../lib/forms";

// Paciente (F4.7): salvar dados, plano de saúde (com o item), desativar e reativar;
// anonimizar a pedido (F9.4, LGPD: só Administrador e Suporte; o banco confere de novo).
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params } = context;
  const id = params.id!;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const db = createUserClient(request, cookies);
  // A origem da tela (`?volta=`) segue depois da ação (cliente, 10/out/2026).
  const page = withReturn(`/admin/pacientes/${id}`, receivedReturn(new URL(request.url)));

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
            { fullName: formText(form, "full_name"), birthdate: formText(form, "birthdate") },
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
        case "anonimizar": {
          if (!clinic.isPlatformStaff && !clinic.roles.includes("admin")) {
            throw new DataError("forbidden", "Anonimizar: só o Administrador da clínica ou o Suporte");
          }
          const { canceled } = await anonymizePatient(db, clinic.clinicId, id);
          const futures = canceled > 0 ? ` ${canceled} ${canceled === 1 ? "atendimento futuro cancelado" : "atendimentos futuros cancelados"}.` : "";
          return { redirectTo: page, message: `Anonimizado.${futures}` };
        }
        default:
          throw new DataError("invalid", "Ação desconhecida", { acao: "Ação desconhecida." });
      }
    },
    page,
  );
};
