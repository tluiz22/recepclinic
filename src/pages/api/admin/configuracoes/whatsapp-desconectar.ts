import type { APIRoute } from "astro";
import { createClinicServiceClient } from "../../../../lib/data/clinicService";
import { createUserClient } from "../../../../lib/data/clients";
import { DataError } from "../../../../lib/data/errors";
import { describeDataError } from "../../../../lib/data/formAction";
import { resolveClinicsByWabaId } from "../../../../lib/data/platform";
import { disconnectWhatsapp } from "../../../../lib/data/whatsapp/connection";
import { setFlash } from "../../../../lib/flash";
import { logError } from "../../../../lib/log";

// "Desconectar WhatsApp" (F8.3; cliente, 25/out): o Administrador da clínica
// ou o Suporte. Trocar de número = desconectar e conectar de novo. O token só
// é lido pela credencial da clínica; o banco confere o papel de novo.
const COEXISTENCE_STEP =
  'Para terminar, no celular da recepção: app WhatsApp Business › Configurações › Conta › Plataforma comercial › "Desconectar conta".';

export const POST: APIRoute = async ({ request, cookies, locals, redirect }) => {
  const clinic = locals.clinic!;
  const back = "/admin/configuracoes/whatsapp";
  if (!clinic.isPlatformStaff && !clinic.roles.includes("admin")) {
    setFlash(cookies, { tone: "error", text: "Só o Administrador da clínica desconecta o WhatsApp." });
    return redirect(back, 303);
  }
  try {
    const result = await disconnectWhatsapp(
      createUserClient(request, cookies),
      createClinicServiceClient(clinic.clinicId),
      clinic.clinicId,
      (wabaId) => resolveClinicsByWabaId(wabaId),
    );
    if (result.problems.length) logError("whatsapp: desconexão na Meta", result.problems.join("; "), { clinica: clinic.clinicId });
    const head = "WhatsApp desconectado: o bot, os avisos e os lembretes pararam.";
    const step = result.coexistence ? ` ${COEXISTENCE_STEP}` : "";
    const meta = result.problems.length ? ` A Meta não confirmou a saída (${result.problems.join("; ")}); o suporte do RecepClinic confere.` : "";
    setFlash(cookies, { tone: result.problems.length ? "error" : "success", text: `${head}${step}${meta}` });
  } catch (error) {
    if (error instanceof DataError) {
      setFlash(cookies, { tone: "error", text: describeDataError(error) });
    } else {
      logError("whatsapp: desconexão", error, { clinica: clinic.clinicId });
      setFlash(cookies, { tone: "error", text: "O WhatsApp não foi desconectado por uma falha do sistema, já registrada para o suporte. Tente de novo em instantes." });
    }
  }
  return redirect(back, 303);
};
