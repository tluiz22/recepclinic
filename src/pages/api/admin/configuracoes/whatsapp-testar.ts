import type { APIRoute } from "astro";
import { platformEnv, webhookOverride } from "../../../../lib/env";
import { createClinicServiceClient } from "../../../../lib/data/clinicService";
import { checkWhatsappConnection } from "../../../../lib/data/whatsapp/connection";
import { setFlash } from "../../../../lib/flash";

// Suporte, "Testar conexão" (F6.1): pergunta à Meta pelo número com o token
// gravado e inscreve o app na conta, para os eventos chegarem ao webhook. Usa
// a credencial da clínica porque só ela lê o token (ninguém da equipe lê).
// No staging (F10.0a), a inscrição leva o desvio da conta para o webhook dele.
export const POST: APIRoute = async ({ cookies, locals, redirect }) => {
  const clinic = locals.clinic!;
  const back = "/admin/configuracoes/whatsapp";
  if (!clinic.isPlatformStaff) {
    setFlash(cookies, { tone: "error", text: "Você não tem permissão para isso." });
    return redirect(back, 303);
  }
  const override = webhookOverride(platformEnv());
  const result = await checkWhatsappConnection(createClinicServiceClient(clinic.clinicId), clinic.clinicId, fetch, override);
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
    ? override
      ? `App inscrito na conta, com o desvio para ${override.url}: as mensagens chegam a este ambiente.`
      : "App inscrito na conta: as mensagens chegam ao webhook."
    : `Não foi possível inscrever o app na conta: ${result.subscribeError}`;
  setFlash(cookies, { tone: result.subscribed ? "success" : "error", text: `${parts.join(" · ")}. ${subscribed}` });
  return redirect(back, 303);
};
