import type { APIRoute } from "astro";
import { platformEnv } from "../../../../lib/env";
import { createUserClient } from "../../../../lib/data/clients";
import { DataError } from "../../../../lib/data/errors";
import { describeDataError } from "../../../../lib/data/formAction";
import { connectWithSignup } from "../../../../lib/data/whatsapp/connection";
import { GraphRequestError } from "../../../../lib/data/whatsapp/graph";
import { setFlash } from "../../../../lib/flash";
import { formText } from "../../../../lib/forms";
import { logError } from "../../../../lib/log";

// "Conectar WhatsApp" (F8.1): a tela manda o código e o número que a janela
// da Meta devolveu (o código vale 30 segundos). Só o Administrador da clínica
// ou o Suporte (o banco confere de novo em connect_whatsapp).
export const POST: APIRoute = async ({ request, cookies, locals, redirect }) => {
  const clinic = locals.clinic!;
  const back = "/admin/configuracoes/whatsapp";
  const fail = (text: string) => {
    setFlash(cookies, { tone: "error", text });
    return redirect(back, 303);
  };
  if (!clinic.isPlatformStaff && !clinic.roles.includes("admin")) return fail("Só o Administrador da clínica conecta o WhatsApp.");
  const env = platformEnv();
  if (!env.whatsapp || !env.whatsappAppId || !env.whatsappSignupConfigId) {
    return fail("A conexão pela Meta ainda não está ligada no sistema. Fale com o suporte do RecepClinic.");
  }

  const form = await request.formData().catch(() => null);
  try {
    const result = await connectWithSignup(
      createUserClient(request, cookies),
      clinic.clinicId,
      {
        code: formText(form, "code"),
        wabaId: formText(form, "waba_id"),
        phoneNumberId: formText(form, "phone_number_id"),
        event: formText(form, "event"),
      },
      { appId: env.whatsappAppId, appSecret: env.whatsapp.appSecret },
    );
    const phone = result.displayPhone ? ` ${result.displayPhone}` : "";
    const mode = result.coexistence
      ? "A recepção continua no app WhatsApp Business, e o bot atende pelo sistema."
      : "O número fica só no sistema (sem o app WhatsApp Business).";
    if (result.syncProblems.length) {
      logError("whatsapp: sincronização da coexistência", result.syncProblems.join("; "), { clinica: clinic.clinicId });
      setFlash(cookies, {
        tone: "error",
        text: `WhatsApp${phone} conectado. ${mode} Falta uma etapa pedida pela Meta (sincronização): use "Sincronizar de novo" nas próximas 24 horas.`,
      });
    } else {
      setFlash(cookies, { tone: "success", text: `WhatsApp${phone} conectado. ${mode}` });
    }
    return redirect(back, 303);
  } catch (error) {
    if (error instanceof DataError) return fail(describeDataError(error));
    logError("whatsapp: conexão pela Meta", error, { clinica: clinic.clinicId });
    if (error instanceof GraphRequestError) {
      return fail(`A Meta não concluiu a conexão (${error.message}). Nada foi gravado: tente "Conectar WhatsApp" de novo. Se repetir, fale com o suporte.`);
    }
    return fail("A conexão não foi gravada por uma falha do sistema, já registrada para o suporte. Tente de novo em instantes.");
  }
};
