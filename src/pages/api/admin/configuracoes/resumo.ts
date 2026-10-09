import type { APIRoute } from "astro";
import { createUserClient } from "../../../../lib/data/clients";
import { updateClinicSettings, type ReminderTiming } from "../../../../lib/data/config/clinic";
import { setSummaryProfessionals } from "../../../../lib/data/config/professionals";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { formAll, formChecked, formInt, formText } from "../../../../lib/forms";

// Lembretes ao profissional e à equipe (resumo do dia; cliente, 09/out/2026):
// enviar ou não, na véspera ou no dia, e o horário (6h às 20h). Cada público
// com o próprio item da matriz (D11); no do profissional, também quem recebe.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const db = createUserClient(request, cookies);
  const clinic = locals.clinic!;
  const page = "/admin/configuracoes/lembretes";
  const audience = formText(form, "publico") === "equipe" ? "team" : "professional";

  return runFormAction(
    context,
    async () => {
      const feature = audience === "team" ? "team_summary" : "daily_summary";
      if (!clinic.features.includes(feature)) throw new DataError("not_enabled", "Lembrete não liberado para a clínica");
      const enabled = formChecked(form, "enabled");
      const timing = formText(form, "timing") as ReminderTiming;
      const hour = formInt(form, "hour");
      if (audience === "team") {
        await updateClinicSettings(db, clinic.clinicId, { teamSummaryEnabled: enabled, teamSummaryTiming: timing, teamSummaryHour: hour });
        return { redirectTo: page, message: "Lembrete à equipe salvo." };
      }
      await updateClinicSettings(db, clinic.clinicId, { professionalSummaryEnabled: enabled, professionalSummaryTiming: timing, professionalSummaryHour: hour });
      await setSummaryProfessionals(db, clinic.clinicId, formAll(form, "professional_ids"));
      return { redirectTo: page, message: "Lembrete ao profissional salvo." };
    },
    page,
  );
};
