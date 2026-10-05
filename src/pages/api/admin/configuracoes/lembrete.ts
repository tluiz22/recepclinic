import type { APIRoute } from "astro";
import { createUserClient } from "../../../../lib/data/clients";
import { updateClinicSettings } from "../../../../lib/data/config/clinic";
import { runFormAction } from "../../../../lib/data/formAction";
import { formInt } from "../../../../lib/forms";

// Hora do lembrete da véspera (F4.4b; item "Lembrete automático", D11): horas
// cheias das 7h às 20h, no fuso da clínica (cliente, 05/out/2026).
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const db = createUserClient(request, cookies);
  const page = "/admin/configuracoes/whatsapp";

  return runFormAction(
    context,
    async () => {
      await updateClinicSettings(db, locals.clinic!.clinicId, { reminderHour: formInt(form, "reminder_hour") });
      return { redirectTo: page, message: "Hora do lembrete salva." };
    },
    page,
  );
};
