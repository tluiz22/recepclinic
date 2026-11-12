import type { APIRoute } from "astro";
import { createUserClient } from "../../../../lib/data/clients";
import { updateClinicSettings } from "../../../../lib/data/config/clinic";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { formChecked } from "../../../../lib/forms";

// Confirmação ao paciente (BE-9, cliente 11/nov/2026): liga ou desliga a mensagem de confirmação da consulta
// marcada pelo portal e da marcada pela recepção. Lembrete, remarcação e cancelamento não mudam.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const db = createUserClient(request, cookies);
  const clinicId = locals.clinic!.clinicId;
  const page = "/admin/configuracoes/lembretes";

  return runFormAction(
    context,
    async () => {
      if (!form) throw new DataError("invalid", "Formulário inválido.");
      await updateClinicSettings(db, clinicId, {
        confirmPortalBooking: formChecked(form, "confirm_portal_booking"),
        confirmReceptionBooking: formChecked(form, "confirm_reception_booking"),
      });
      return { redirectTo: page, message: "Confirmação ao paciente salva." };
    },
    page,
  );
};
