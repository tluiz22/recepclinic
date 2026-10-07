import { platformEnv } from "../../env";
import { createClinicServiceClient } from "../clinicService";
import { createClinicSender, type ClinicSender } from "./send";

// Quem envia pelo WhatsApp da clínica fora do bot (F6.2): botões e avisos da
// Agenda, página /agendar e webhook. O token só é lido com a credencial da
// clínica (a equipe nunca o lê); registro e trilha seguem com a credencial de
// quem chamou. null = WhatsApp da clínica não conectado.

/** Endereço público para os links das mensagens: SITE_URL, ou o da própria requisição. */
export function publicBaseUrl(requestUrl: URL | string): string {
  return platformEnv().siteUrl ?? new URL(requestUrl).origin;
}

export function clinicSenderFor(clinicId: string, requestUrl: URL | string): Promise<ClinicSender | null> {
  return createClinicSender(createClinicServiceClient(clinicId), clinicId, { baseUrl: publicBaseUrl(requestUrl) });
}
