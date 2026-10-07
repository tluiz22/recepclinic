import { safeReturnPath } from "../../../../lib/returnPath";
import type { APIRoute } from "astro";
import { isUuid } from "../../../../lib/clinicAccess";
import { createUserClient } from "../../../../lib/data/clients";
import { cancelByClinic } from "../../../../lib/data/agenda/blocks";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { formAll, formOptionalText } from "../../../../lib/forms";
import { clinicSenderFor } from "../../../../lib/data/whatsapp/clinicSender";
import { clinicCancellationSummary, notifyClinicCancellations } from "../../../../lib/data/whatsapp/notices";

// Cancelamento em massa pela clínica (F4.6; Fase 12 do piloto): os
// selecionados na Agenda (turma = todos os pacientes ativos dela). Cada um
// ganha o link de remarcação (com o bot liberado, D11) e recebe o aviso pelo
// WhatsApp da clínica (F6.5); só quem não recebeu vai para a tela "Avisar".
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const returnTo = formOptionalText(form, "return_to");
  const back = safeReturnPath(returnTo, "/admin/agenda");
  const ids = [...new Set(formAll(form, "ids").flatMap((value) => value.split(",")).filter(isUuid))];

  return runFormAction(
    context,
    async () => {
      if (!ids.length) throw new DataError("invalid", "Cancelamento: selecione ao menos um atendimento", { ids: "Selecione ao menos um atendimento." });
      const db = createUserClient(request, cookies);
      const clinicId = locals.clinic!.clinicId;
      const canceled = await cancelByClinic(db, clinicId, ids, locals.userId ?? null);
      if (!canceled.length) return { redirectTo: back, message: "Nada foi cancelado: os selecionados já estavam cancelados." };
      const notices = await notifyClinicCancellations(
        db,
        clinicId,
        canceled.map((c) => ({ appointmentId: c.appointment.id, rebookingLinkId: c.rebookingLink?.id ?? null })),
        await clinicSenderFor(clinicId, request.url),
      );
      const missed = notices.filter((n) => n.status !== "sent").map((n) => n.appointmentId);
      return {
        redirectTo: missed.length ? `/admin/agenda/avisar?ids=${missed.join(",")}&volta=${encodeURIComponent(back)}` : back,
        message: clinicCancellationSummary(notices),
      };
    },
    back,
  );
};
