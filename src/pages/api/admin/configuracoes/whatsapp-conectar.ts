import type { APIRoute } from "astro";
import { platformEnv, webhookOverride } from "../../../../lib/env";
import { createClinicServiceClient } from "../../../../lib/data/clinicService";
import { createUserClient } from "../../../../lib/data/clients";
import { DataError } from "../../../../lib/data/errors";
import { describeDataError } from "../../../../lib/data/formAction";
import { connectWithSignup } from "../../../../lib/data/whatsapp/connection";
import { GraphRequestError } from "../../../../lib/data/whatsapp/graph";
import { createTemplatesAfterConnect } from "../../../../lib/data/whatsapp/templateSync";
import { setFlash } from "../../../../lib/flash";
import { formText } from "../../../../lib/forms";
import { logError } from "../../../../lib/log";

// "Conectar WhatsApp" (F8.1): a tela manda o código e o número que a janela
// da Meta devolveu (o código vale 30 segundos). Só o Administrador da clínica
// ou o Suporte (o banco confere de novo em connect_whatsapp). F8.2: logo
// depois, os templates na conta da clínica (com a credencial dela, que lê o
// token); falha neles não desfaz a conexão.
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
      { appId: env.whatsappAppId, appSecret: env.whatsapp.appSecret, webhookOverride: webhookOverride(env) },
    );
    const phone = result.displayPhone ? ` ${result.displayPhone}` : "";
    const mode = result.coexistence
      ? "A recepção continua no app WhatsApp Business, e o bot atende pelo sistema."
      : "O número fica só no sistema (sem o app WhatsApp Business).";
    const templates = await createTemplatesAfterConnect(createClinicServiceClient(clinic.clinicId), clinic.clinicId).catch((error: unknown) => {
      logError("whatsapp: templates na conexão", error, { clinica: clinic.clinicId });
      return null;
    });
    const templateProblems = !templates
      ? ["falha do sistema"]
      : templates.ok
        ? templates.lines.filter((l) => l.problem).map((l) => `${l.name}: ${l.problem}`)
        : [templates.message];
    if (templates && templateProblems.length) logError("whatsapp: templates na conexão", templateProblems.join("; "), { clinica: clinic.clinicId });
    const templateText = templateProblems.length
      ? 'Algumas mensagens automáticas não foram enviadas à Meta: use "Enviar à Meta as que faltam", abaixo.'
      : templates?.ok && templates.lines.every((l) => l.status === "approved")
        ? "As mensagens automáticas já estão aprovadas na Meta."
        : "As mensagens automáticas foram enviadas à Meta para análise: a aprovação leva de minutos a algumas horas e chega sozinha.";
    if (result.syncProblems.length) {
      logError("whatsapp: sincronização da coexistência", result.syncProblems.join("; "), { clinica: clinic.clinicId });
      setFlash(cookies, {
        tone: "error",
        text: `WhatsApp${phone} conectado. ${mode} Falta uma etapa pedida pela Meta (sincronização): use "Sincronizar de novo" nas próximas 24 horas. ${templateText}`,
      });
    } else {
      setFlash(cookies, { tone: templateProblems.length ? "error" : "success", text: `WhatsApp${phone} conectado. ${mode} ${templateText}` });
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
