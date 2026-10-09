import type { APIRoute } from "astro";
import { createClinicServiceClient } from "../../../lib/data/clinicService";
import { DataError } from "../../../lib/data/errors";
import { describeDataError } from "../../../lib/data/formAction";
import { getClinicFeatures } from "../../../lib/data/features";
import { hashToken, saveInfoRequestAnswers } from "../../../lib/data/onboarding";
import { resolveClinicByOnboardingToken } from "../../../lib/data/platform";
import { setFlash } from "../../../lib/flash";
import { parseOnboardingForm, sectionsFor } from "../../../lib/onboardingForm";
import { logError } from "../../../lib/log";

// Formulário de informações (F4.4a): salva o rascunho ou envia ao Suporte.
// Sem login: o link é a chave; a plataforma só descobre a clínica e o resto
// segue com a credencial limitada à clínica (D1).
export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const token = params.token ?? "";
  const page = `/formulario/${token}`;
  const clinicId = await resolveClinicByOnboardingToken(hashToken(token));
  if (!clinicId) return redirect(page, 303);
  const form = await request.formData().catch(() => null);
  if (!form) return redirect(page, 303);
  const submit = form.get("acao") === "enviar";
  const db = createClinicServiceClient(clinicId);
  try {
    const answers = parseOnboardingForm(form, sectionsFor(await getClinicFeatures(db, clinicId)));
    await saveInfoRequestAnswers(db, token, answers, submit);
    setFlash(cookies, { tone: "success", text: submit ? "Recebemos as informações. Obrigado!" : "Rascunho salvo. Dá para continuar depois pelo mesmo link." }, "/formulario");
  } catch (error) {
    if (!(error instanceof DataError)) logError("pedido de informações", error);
    setFlash(cookies, { tone: "error", text: error instanceof DataError ? describeDataError(error) : "Não foi possível salvar. Tente de novo." }, "/formulario");
  }
  return redirect(page, 303);
};
