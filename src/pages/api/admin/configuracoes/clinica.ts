import type { APIRoute } from "astro";
import { createUserClient } from "../../../../lib/data/clients";
import { updateClinicSettings, type ClinicProfile, type ClinicSettingsPatch } from "../../../../lib/data/config/clinic";
import { runFormAction } from "../../../../lib/data/formAction";
import { formChecked, formOptionalInt, formOptionalText, formText } from "../../../../lib/forms";

// Perfil e identidade da clínica (F4.3). As informações do bot só vêm no
// formulário com o bot liberado.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  return runFormAction(
    context,
    async () => {
      const patch: ClinicSettingsPatch = {
        name: formText(form, "name"),
        profile: formText(form, "profile") as ClinicProfile,
        timezone: formText(form, "timezone"),
        consultationAgeLimitYears: formChecked(form, "age_limit_on") ? formOptionalInt(form, "age_limit") : null,
        brandColor: formOptionalText(form, "brand_color"),
      };
      if (clinic.features.includes("whatsapp_bot")) {
        patch.botPaymentInfo = formOptionalText(form, "bot_payment_info");
        patch.botInsuranceInfo = formOptionalText(form, "bot_insurance_info");
        patch.botNotes = formOptionalText(form, "bot_notes");
      }
      if (patch.consultationAgeLimitYears === null && formChecked(form, "age_limit_on")) patch.consultationAgeLimitYears = Number.NaN;
      await updateClinicSettings(createUserClient(request, cookies), clinic.clinicId, patch);
      return { redirectTo: "/admin/configuracoes", message: "Dados da clínica salvos." };
    },
    "/admin/configuracoes",
  );
};
