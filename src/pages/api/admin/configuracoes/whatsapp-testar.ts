import type { APIRoute } from "astro";
import { createClinicServiceClient } from "../../../../lib/data/clinicService";
import { checkWhatsappConnection } from "../../../../lib/data/whatsapp/connection";
import { setFlash } from "../../../../lib/flash";

// Suporte, "Testar conexão" (F6.1): pergunta à Meta pelo número com o token
// gravado e inscreve o app na conta, para os eventos chegarem ao webhook. Usa
// a credencial da clínica porque só ela lê o token (ninguém da equipe lê).
export const POST: APIRoute = async ({ cookies, locals, redirect }) => {
  const clinic = locals.clinic!;
  const back = "/admin/configuracoes/whatsapp";
  if (!clinic.isPlatformStaff) {
    setFlash(cookies, { tone: "error", text: "Você não tem permissão para isso." });
    return redirect(back, 303);
  }
  const result = await checkWhatsappConnection(createClinicServiceClient(clinic.clinicId), clinic.clinicId);
  if (!result.ok) {
    setFlash(cookies, { tone: "error", text: result.message });
    return redirect(back, 303);
  }
  const { info } = result;
  const parts = [
    `A Meta respondeu: ${info.displayPhoneNumber ?? "número sem exibição"}${info.verifiedName ? ` (${info.verifiedName})` : ""}`,
    `nome ${info.nameStatus ?? "?"}`,
    `número ${info.status ?? "?"}`,
    `plataforma ${info.platformType ?? "?"}`,
    `qualidade ${info.qualityRating ?? "?"}`,
  ];
  const subscribed = result.subscribed
    ? "App inscrito na conta: as mensagens chegam ao webhook."
    : `Não foi possível inscrever o app na conta: ${result.subscribeError}`;
  setFlash(cookies, { tone: result.subscribed ? "success" : "error", text: `${parts.join(" · ")}. ${subscribed}` });
  return redirect(back, 303);
};
