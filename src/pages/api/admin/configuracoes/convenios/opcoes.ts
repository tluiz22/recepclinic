import type { APIRoute } from "astro";
import { createUserClient } from "../../../../../lib/data/clients";
import { updateClinicSettings } from "../../../../../lib/data/config/clinic";
import { runFormAction } from "../../../../../lib/data/formAction";
import { formChecked } from "../../../../../lib/forms";

// Convênios (F4.4b, D10): pedir carteirinha e validade na marcação por plano.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const db = createUserClient(request, cookies);
  const page = "/admin/configuracoes/convenios";

  return runFormAction(
    context,
    async () => {
      await updateClinicSettings(db, locals.clinic!.clinicId, { requireInsuranceDetails: formChecked(form, "require_insurance_details") });
      return { redirectTo: page, message: "Opção salva." };
    },
    page,
  );
};
