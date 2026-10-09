import type { APIRoute } from "astro";
import { createUserClient } from "../../../../lib/data/clients";
import { updateClinicSettings } from "../../../../lib/data/config/clinic";
import { runFormAction } from "../../../../lib/data/formAction";
import { formChecked, formInt } from "../../../../lib/forms";

// Resumo do dia para a equipe (F7; item "Envio do resumo do dia", D11;
// cliente, 07/out/2026): na véspera (enviar ou não e a hora, 7h às 20h) e no
// dia (enviar ou não e quantas horas antes da primeira agenda, 1 a 4).
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const db = createUserClient(request, cookies);
  const page = "/admin/configuracoes/lembretes";

  return runFormAction(
    context,
    async () => {
      await updateClinicSettings(db, locals.clinic!.clinicId, {
        summaryPreviewEnabled: formChecked(form, "summary_preview_enabled"),
        summaryPreviewHour: formInt(form, "summary_preview_hour"),
        summaryTodayEnabled: formChecked(form, "summary_today_enabled"),
        summaryTodayLeadHours: formInt(form, "summary_today_lead_hours"),
      });
      return { redirectTo: page, message: "Envios do resumo salvos." };
    },
    page,
  );
};
