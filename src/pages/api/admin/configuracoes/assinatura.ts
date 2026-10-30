import type { APIRoute } from "astro";
import { saveBillingContacts, setBillingWhatsappOptIn } from "../../../../lib/data/billing";
import { createUserClient } from "../../../../lib/data/clients";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { formChecked, formOptionalText, formText } from "../../../../lib/forms";

// Configurações › Assinatura (F12.1): contatos financeiros (Administrador e
// Suporte) e a autorização do WhatsApp financeiro (só o Administrador da
// clínica; o banco confere de novo e registra na trilha).
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals } = context;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const db = createUserClient(request, cookies);
  const page = "/admin/configuracoes/assinatura";

  return runFormAction(
    context,
    async () => {
      switch (formText(form, "acao")) {
        case "contatos":
          await saveBillingContacts(db, clinic.clinicId, { financeEmail: formText(form, "finance_email"), financePhone: formOptionalText(form, "finance_phone") });
          return { redirectTo: page, message: "Contatos financeiros salvos." };
        case "whatsapp_autorizar":
          if (!formChecked(form, "aceite")) throw new DataError("invalid", "WhatsApp financeiro: marque a autorização", { aceite: "Marque a autorização." });
          await setBillingWhatsappOptIn(db, clinic.clinicId, true);
          return { redirectTo: page, message: "WhatsApp financeiro autorizado." };
        case "whatsapp_retirar":
          await setBillingWhatsappOptIn(db, clinic.clinicId, false);
          return { redirectTo: page, message: "Autorização do WhatsApp retirada: os avisos vão só por e-mail." };
        default:
          throw new DataError("invalid", "Ação desconhecida", { acao: "Ação desconhecida." });
      }
    },
    page,
  );
};
