import type { APIRoute } from "astro";
import { parseImportForm } from "../../../lib/agendaImport";
import { createClinicServiceClient } from "../../../lib/data/clinicService";
import { getAgendaImportByToken, saveAgendaImport } from "../../../lib/data/agendaImport";
import { DataError } from "../../../lib/data/errors";
import { describeDataError } from "../../../lib/data/formAction";
import { hashToken } from "../../../lib/data/onboarding";
import { resolveClinicByAgendaImportToken } from "../../../lib/data/platform";
import { setFlash } from "../../../lib/flash";
import { logError } from "../../../lib/log";

// Agenda atual (F10.1a): salva o rascunho ou envia ao Suporte. Sem login: o
// link é a chave; a plataforma só descobre a clínica e o resto segue com a
// credencial limitada à clínica (D1). Os problemas de cada campo a página
// mostra ao abrir, conferindo o que ficou salvo.
export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const token = params.token ?? "";
  const page = `/importar/${token}`;
  const clinicId = await resolveClinicByAgendaImportToken(hashToken(token));
  if (!clinicId) return redirect(page, 303);
  const form = await request.formData().catch(() => null);
  if (!form) return redirect(page, 303);
  const submit = form.get("acao") === "enviar";
  const db = createClinicServiceClient(clinicId);
  const say = (tone: "success" | "error", text: string) => setFlash(cookies, { tone, text }, "/importar");
  try {
    const current = await getAgendaImportByToken(db, token);
    if (!current) return redirect(page, 303);
    const { data: settings } = await db.from("clinic_settings").select("timezone").eq("clinic_id", clinicId).maybeSingle();
    const patients = parseImportForm(form);
    const { issues, submitted } = await saveAgendaImport(db, clinicId, token, patients, submit, settings?.timezone ?? "America/Fortaleza");
    const problems = Object.keys(issues).length;
    const pending = problems === 1 ? "1 ponto a corrigir" : `${problems} pontos a corrigir`;
    if (submitted) say("success", "Recebemos a agenda atual. O Suporte RecepClinic vai conferir e avisar.");
    else if (submit && patients.length === 0) say("error", "Cadastre ao menos um paciente antes de enviar.");
    else if (submit) say("error", `Ainda não foi enviado: há ${pending}, marcados em vermelho. O que você digitou ficou salvo.`);
    else if (problems > 0) say("success", `Rascunho salvo, com ${pending} (marcados em vermelho). Dá para continuar depois pelo mesmo link.`);
    else say("success", "Rascunho salvo. Dá para continuar depois pelo mesmo link.");
  } catch (error) {
    if (!(error instanceof DataError)) logError("agenda atual", error);
    say("error", error instanceof DataError ? describeDataError(error) : "Não foi possível salvar. Tente de novo.");
  }
  return redirect(page, 303);
};
