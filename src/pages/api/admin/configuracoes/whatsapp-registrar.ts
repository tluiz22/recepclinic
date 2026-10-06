import type { APIRoute } from "astro";
import { createClinicServiceClient } from "../../../../lib/data/clinicService";
import { registerWhatsappNumber } from "../../../../lib/data/whatsapp/connection";
import { setFlash } from "../../../../lib/flash";
import { formText } from "../../../../lib/forms";

// Suporte, "Registrar o número" na Cloud API com o PIN (F6.1). Usa a
// credencial da clínica porque só ela lê o token.
export const POST: APIRoute = async ({ request, cookies, locals, redirect }) => {
  const clinic = locals.clinic!;
  const back = "/admin/configuracoes/whatsapp";
  if (!clinic.isPlatformStaff) {
    setFlash(cookies, { tone: "error", text: "Você não tem permissão para isso." });
    return redirect(back, 303);
  }
  const form = await request.formData().catch(() => null);
  const problem = await registerWhatsappNumber(createClinicServiceClient(clinic.clinicId), clinic.clinicId, formText(form, "pin"));
  setFlash(cookies, problem ? { tone: "error", text: problem } : { tone: "success", text: "Número registrado na Cloud API." });
  return redirect(back, 303);
};
