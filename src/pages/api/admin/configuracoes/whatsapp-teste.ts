import type { APIRoute } from "astro";
import { createUserClient } from "../../../../lib/data/clients";
import { DataError } from "../../../../lib/data/errors";
import { runFormAction } from "../../../../lib/data/formAction";
import { clinicSenderFor } from "../../../../lib/data/whatsapp/clinicSender";
import { sendConnectionTest } from "../../../../lib/data/whatsapp/connectionTest";
import { formText } from "../../../../lib/forms";
import { describeSendFailure } from "../../../../lib/whatsappErrors";

// "Enviar mensagem de teste" (IS2; cliente, 03/nov/2026): o Administrador da clínica ou o Suporte manda o modelo
// rc_teste_envio_v1 para um celular e acompanha a entrega em Configurações › WhatsApp. Substitui a marcação manual
// "Forma de pagamento conferida" (F8.3). Sai também com a clínica em implantação.
export const POST: APIRoute = async (context) => {
  const { request, cookies, locals, url } = context;
  const form = await request.formData().catch(() => null);
  const clinic = locals.clinic!;
  const back = "/admin/configuracoes/whatsapp";
  return runFormAction(
    context,
    async () => {
      if (!clinic.isPlatformStaff && !clinic.roles.includes("admin")) throw new DataError("forbidden", "Mensagem de teste: só o Administrador ou o Suporte");
      const sender = await clinicSenderFor(clinic.clinicId, url, { allowOnboarding: true });
      const test = await sendConnectionTest(createUserClient(request, cookies), clinic.clinicId, { phone: formText(form, "telefone") }, sender);
      if (test.status === "failed") {
        const why = describeSendFailure(test.failureCode, test.failureReason);
        throw new DataError("invalid", "Mensagem de teste: não saiu", { telefone: `${why.title} ${why.action}` });
      }
      return { redirectTo: `${back}#teste`, message: "Mensagem de teste enviada. A situação da entrega aparece abaixo em alguns segundos (atualize a página)." };
    },
    `${back}#teste`,
  );
};
