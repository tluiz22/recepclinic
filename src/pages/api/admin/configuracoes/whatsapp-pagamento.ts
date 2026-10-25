import type { APIRoute } from "astro";
import { createUserClient } from "../../../../lib/data/clients";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { setWhatsappPaymentChecked } from "../../../../lib/data/whatsapp/connection";
import { formText } from "../../../../lib/forms";

// Suporte (F8.3; cliente, 24/out): "Forma de pagamento conferida" na conta do
// WhatsApp da clínica (a Meta não tem API para isso), ou desmarca. Até
// conferir, o Administrador vê o aviso no Início. Não trava nada.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  return runFormAction(
    context,
    async () => {
      if (!clinic.isPlatformStaff) throw new DataError("forbidden", "Forma de pagamento: só o Suporte");
      const checked = formText(form, "conferida") === "sim";
      await setWhatsappPaymentChecked(createUserClient(request, cookies), clinic.clinicId, checked);
      return {
        redirectTo: "/admin/configuracoes/whatsapp",
        message: checked ? "Forma de pagamento marcada como conferida." : "Forma de pagamento desmarcada: o Administrador volta a ver o aviso no Início.",
      };
    },
    "/admin/configuracoes/whatsapp",
  );
};
