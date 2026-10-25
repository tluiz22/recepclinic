import type { APIRoute } from "astro";
import { createClinicServiceClient } from "../../../../lib/data/clinicService";
import { createUserClient } from "../../../../lib/data/clients";
import { retryCoexistenceSync } from "../../../../lib/data/whatsapp/connection";
import { setFlash } from "../../../../lib/flash";
import { logError } from "../../../../lib/log";

// "Sincronizar de novo" (F8.1): na coexistência, a Meta exige as
// sincronizações dos contatos e do histórico em até 24 horas depois da
// conexão. O token só é lido pela credencial da clínica.
export const POST: APIRoute = async ({ request, cookies, locals, redirect }) => {
  const clinic = locals.clinic!;
  const back = "/admin/configuracoes/whatsapp";
  if (!clinic.isPlatformStaff && !clinic.roles.includes("admin")) {
    setFlash(cookies, { tone: "error", text: "Só o Administrador da clínica conecta o WhatsApp." });
    return redirect(back, 303);
  }
  try {
    const problems = await retryCoexistenceSync(createUserClient(request, cookies), createClinicServiceClient(clinic.clinicId), clinic.clinicId);
    if (problems.length) {
      logError("whatsapp: sincronização da coexistência", problems.join("; "), { clinica: clinic.clinicId });
      setFlash(cookies, { tone: "error", text: `A Meta recusou a sincronização (${problems.join("; ")}). Tente de novo em instantes.` });
    } else {
      setFlash(cookies, { tone: "success", text: "Sincronização concluída." });
    }
  } catch (error) {
    logError("whatsapp: sincronização da coexistência", error, { clinica: clinic.clinicId });
    setFlash(cookies, { tone: "error", text: "A sincronização não foi feita por uma falha do sistema, já registrada para o suporte. Tente de novo em instantes." });
  }
  return redirect(back, 303);
};
