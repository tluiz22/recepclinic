import type { APIRoute } from "astro";
import { createUserClient } from "../../../../lib/data/clients";
import { updateClinicSettings } from "../../../../lib/data/config/clinic";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { getGuidance } from "../../../../lib/data/whatsapp/customMessages";
import { formChecked } from "../../../../lib/forms";

// Orientações gerais depois da marcação de uma consulta (cliente, 08/out/2026):
// enviar ou não. Fora da matriz; o texto fica na aba Mensagens e precisa
// estar escrito para ligar o envio.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const db = createUserClient(request, cookies);
  const clinicId = locals.clinic!.clinicId;
  const page = "/admin/configuracoes/whatsapp";

  return runFormAction(
    context,
    async () => {
      const enabled = formChecked(form, "guidance_enabled");
      if (enabled && !(await getGuidance(db, clinicId))) {
        throw new DataError("invalid", "Orientações gerais: escreva o texto em Configurações › Mensagens antes de ligar o envio", {
          guidance_enabled: "Escreva o texto em Configurações › Mensagens antes de ligar o envio.",
        });
      }
      await updateClinicSettings(db, clinicId, { guidanceEnabled: enabled });
      return { redirectTo: page, message: enabled ? "Orientações gerais: envio ligado." : "Orientações gerais: envio desligado." };
    },
    page,
  );
};
