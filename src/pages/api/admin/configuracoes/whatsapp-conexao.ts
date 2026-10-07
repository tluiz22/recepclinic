import type { APIRoute } from "astro";
import { createUserClient } from "../../../../lib/data/clients";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { saveWhatsappConnection, setWhatsappAccessToken, type ConnectionStatus } from "../../../../lib/data/whatsapp/connection";
import { formChecked, formOptionalText, formText } from "../../../../lib/forms";

// Suporte cadastra a conexão do WhatsApp da clínica (F6.1; o Administrador
// conecta sozinho pelo Embedded Signup na F8). O token só é gravado (vai para
// o Vault); em branco, fica o que já estava.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  return runFormAction(
    context,
    async () => {
      if (!clinic.isPlatformStaff) throw new DataError("forbidden", "Conexão do WhatsApp: só o Suporte");
      const db = createUserClient(request, cookies);
      await saveWhatsappConnection(db, clinic.clinicId, {
        phoneNumberId: formText(form, "phone_number_id"),
        wabaId: formText(form, "waba_id"),
        displayPhone: formOptionalText(form, "display_phone"),
        status: formText(form, "status") as ConnectionStatus,
        coexistence: formChecked(form, "coexistence"),
      });
      const token = formOptionalText(form, "access_token");
      if (token) await setWhatsappAccessToken(db, clinic.clinicId, token);
      return { redirectTo: "/admin/configuracoes/whatsapp", message: token ? "Conexão e token salvos." : "Conexão salva." };
    },
    "/admin/configuracoes/whatsapp",
  );
};
