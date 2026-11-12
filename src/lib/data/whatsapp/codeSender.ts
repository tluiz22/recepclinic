import { platformEnv, type WhatsappCodeEnv } from "../../env";
import { isAnonymizedPhone } from "../../anonymization";
import { logError } from "../../log";
import { fetchTemplatesByName, GraphRequestError, sendMessage, type Fetcher } from "./graph";
import type { TemplateStatus } from "./connection";
import type { SendOutcome } from "./messages";
import { toWaNumber } from "./meta";
import { sendFailure } from "./send";
import { fillTemplate, PORTAL_CODE_TEMPLATE, rejectionReason, TEMPLATE_LANGUAGE, templateStatusFromMeta } from "./templates";

// Código do portal pelo número do RecepClinic (cliente, 09/nov/2026; plano da recepção digital, seção 14): a Meta só
// libera template de autenticação a empresa verificada, então o código sai de um número só, da empresa do RecepClinic,
// para todas as clínicas. Não depende do WhatsApp da clínica; o texto é o fixo da Meta, sem o nome da clínica.

export type PortalCodeSender = {
  /** Manda o código (template de autenticação: o código no corpo e no botão "Copiar código"). */
  send(to: string, code: string): Promise<SendOutcome>;
};

/** null = sem as variáveis WHATSAPP_CODE_* (o portal fica sem a entrada direta). */
export function createPortalCodeSender(
  config: WhatsappCodeEnv | null = platformEnv().whatsappCode,
  fetcher: Fetcher = fetch,
): PortalCodeSender | null {
  if (!config) return null;
  return {
    async send(to, code) {
      // O registro guarda o texto sem o código (ele vale só para quem recebeu).
      const body = fillTemplate(PORTAL_CODE_TEMPLATE.body, ["••••••"]);
      if (isAnonymizedPhone(to)) return { sent: false, reason: "contato anonimizado", body };
      const message = {
        to: toWaNumber(to),
        type: "template",
        template: {
          name: PORTAL_CODE_TEMPLATE.name,
          language: { code: TEMPLATE_LANGUAGE },
          components: [
            { type: "body", parameters: [{ type: "text", text: code }] },
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
          ],
        },
      };
      try {
        const messageId = await sendMessage(config.phoneNumberId, config.token, message, fetcher);
        return { sent: true, messageId, body };
      } catch (error) {
        logError("whatsapp envio do código do portal", error);
        return { ...sendFailure(error), body };
      }
    },
  };
}

export type PortalCodeTemplateState =
  | { status: "unconfigured" }
  | { status: TemplateStatus | "missing"; rejectionReason: string | null }
  | { status: "error"; message: string };

/** Situação do template do código na conta do RecepClinic, para o Suporte (pergunta à Meta na hora). */
export async function portalCodeTemplateState(
  config: WhatsappCodeEnv | null = platformEnv().whatsappCode,
  fetcher: Fetcher = fetch,
): Promise<PortalCodeTemplateState> {
  if (!config) return { status: "unconfigured" };
  try {
    const found = (await fetchTemplatesByName(config.wabaId, PORTAL_CODE_TEMPLATE.name, config.token, fetcher)).find(
      (t) => t.language === TEMPLATE_LANGUAGE,
    );
    if (!found) return { status: "missing", rejectionReason: null };
    return { status: templateStatusFromMeta(found.status), rejectionReason: rejectionReason(found.rejectedReason) };
  } catch (error) {
    if (!(error instanceof GraphRequestError)) throw error;
    return { status: "error", message: error.graph.message };
  }
}
