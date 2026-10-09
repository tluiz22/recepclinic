import type { APIRoute } from "astro";
import { createUserClient } from "../../../../lib/data/clients";
import { updateClinicSettings, type ReminderTiming } from "../../../../lib/data/config/clinic";
import { runFormAction } from "../../../../lib/data/formAction";
import { formChecked, formInt, formText } from "../../../../lib/forms";

// Lembrete ao paciente (F4.4b; item "Lembrete automático", D11): enviar ou
// não (F7), na véspera ou no dia, e o horário, em horas cheias das 6h às 20h,
// no fuso da clínica (cliente, 05, 07 e 09/out/2026).
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const db = createUserClient(request, cookies);
  const page = "/admin/configuracoes/lembretes";

  return runFormAction(
    context,
    async () => {
      await updateClinicSettings(db, locals.clinic!.clinicId, {
        reminderEnabled: formChecked(form, "reminder_enabled"),
        reminderTiming: formText(form, "reminder_timing") as ReminderTiming,
        reminderHour: formInt(form, "reminder_hour"),
      });
      return { redirectTo: page, message: "Lembrete salvo." };
    },
    page,
  );
};
