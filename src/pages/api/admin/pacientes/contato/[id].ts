import type { APIRoute } from "astro";
import { isUuid } from "../../../../../lib/clinicAccess";
import { createUserClient } from "../../../../../lib/data/clients";
import { DataError } from "../../../../../lib/data/errors";
import { runFormAction } from "../../../../../lib/data/formAction";
import { setContactActive, updateContact } from "../../../../../lib/data/patients";
import { markContactReviewed, setContactBotLimitsExempt } from "../../../../../lib/data/whatsapp/botLimits";
import { formOptionalText, formText } from "../../../../../lib/forms";

// Responsável/contato (F4.7): salvar nome, telefone e endereço padrão do
// domiciliar (só com o item); desativar e reativar. Limites do bot (F9.6a):
// "Revisado" (também pelo cartão do Painel, que volta para lá) e liberar ou
// voltar a aplicar os limites; o banco confere o papel.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, params } = context;
  const id = params.id!;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const db = createUserClient(request, cookies);
  const page = `/admin/pacientes/contato/${id}`;

  return runFormAction(
    context,
    async () => {
      if (!isUuid(id)) throw new DataError("not_found", "Contato: não encontrado");
      switch (formText(form, "acao")) {
        case "salvar": {
          const input = {
            fullName: formText(form, "full_name"),
            phone: formText(form, "phone"),
            ...(clinic.features.includes("home_visit") ? { defaultHomeAddress: formOptionalText(form, "default_home_address") } : {}),
          };
          try {
            await updateContact(db, clinic.clinicId, id, input);
          } catch (error) {
            if (error instanceof DataError && error.code === "duplicate") {
              throw new DataError("duplicate", "Contato: este WhatsApp já é de outro cadastro", { phone: "Este WhatsApp já é de outro cadastro." });
            }
            throw error;
          }
          return { redirectTo: page, message: "Dados salvos." };
        }
        case "desativar":
        case "reativar": {
          const active = formText(form, "acao") === "reativar";
          await setContactActive(db, clinic.clinicId, id, active);
          return { redirectTo: page, message: active ? "Reativado." : "Desativado." };
        }
        case "revisado": {
          await markContactReviewed(db, clinic.clinicId, id);
          return { redirectTo: formText(form, "voltar") === "painel" ? "/admin/dashboard" : page, message: "Marcado como revisado." };
        }
        case "liberar_limites":
        case "aplicar_limites": {
          const exempt = formText(form, "acao") === "liberar_limites";
          await setContactBotLimitsExempt(db, clinic.clinicId, id, exempt);
          return { redirectTo: page, message: exempt ? "Liberado dos limites do bot." : "Os limites do bot voltaram a valer." };
        }
        default:
          throw new DataError("invalid", "Ação desconhecida", { acao: "Ação desconhecida." });
      }
    },
    page,
  );
};
