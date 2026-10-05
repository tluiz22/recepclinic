import type { APIRoute } from "astro";
import { isUuid } from "../../../../lib/clinicAccess";
import { createUserClient } from "../../../../lib/data/clients";
import { cancelByClinic } from "../../../../lib/data/agenda/blocks";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { formAll, formOptionalText } from "../../../../lib/forms";

// Cancelamento em massa pela clínica (F4.6; Fase 12 do piloto): os
// selecionados na Agenda (turma = todos os pacientes ativos dela). Cada um
// ganha o link de remarcação (com o bot liberado, D11); depois, a tela
// "Avisar" mostra cada paciente com a mensagem pronta para o WhatsApp.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const returnTo = formOptionalText(form, "return_to");
  const back = returnTo && /^\/admin\/agenda(\/[a-z-]+)?(\?[^\s]*)?$/.test(returnTo) ? returnTo : "/admin/agenda";
  const ids = [...new Set(formAll(form, "ids").flatMap((value) => value.split(",")).filter(isUuid))];

  return runFormAction(
    context,
    async () => {
      if (!ids.length) throw new DataError("invalid", "Cancelamento: selecione ao menos um atendimento", { ids: "Selecione ao menos um atendimento." });
      const canceled = await cancelByClinic(createUserClient(request, cookies), locals.clinic!.clinicId, ids, locals.userId ?? null);
      if (!canceled.length) return { redirectTo: back, message: "Nada foi cancelado: os selecionados já estavam cancelados." };
      const done = canceled.map((c) => c.appointment.id);
      return {
        redirectTo: `/admin/agenda/avisar?ids=${done.join(",")}&volta=${encodeURIComponent(back)}`,
        message: `${done.length} atendimento(s) cancelado(s). Avise cada um abaixo.`,
      };
    },
    back,
  );
};
