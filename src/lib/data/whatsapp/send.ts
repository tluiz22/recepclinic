import type { DbClient } from "../clients";
import { unwrapOne } from "../errors";
import { getSendingSetup, type TemplateKey } from "./connection";
import { GraphRequestError, sendMessage, type Fetcher } from "./graph";
import type { SendOutcome } from "./messages";
import { toWaNumber } from "./meta";
import type { PreparationSender } from "./preparation";
import type { ReminderSender } from "./reminders";
import { appointmentParams, cleanParam, clinicLabel, defaultTemplate, fillTemplate, firstName, paramCount, type MessageArticle } from "./templates";

// Envio pelo WhatsApp da clínica (F6.2): o número e o token dela (D3a), com a
// credencial limitada à clínica, a única que lê o token. As camadas de
// lembrete, preparo e avisos decidem o que enviar e registram; aqui só se
// envia e se monta o texto que o paciente vê.

export type ClinicSender = {
  clinicId: string;
  /** {{2}} dos templates: "da Clínica Sorriso". */
  clinicLabel: string;
  /** Endereço público do sistema, para os links (ex.: página do preparo). */
  baseUrl: string;
  template(
    to: string,
    key: TemplateKey,
    template: { name: string; language: string },
    params: string[],
    buttonPayloads?: string[],
  ): Promise<SendOutcome>;
  text(to: string, body: string): Promise<SendOutcome>;
};

const failure = (error: unknown): SendOutcome => ({
  sent: false,
  reason: error instanceof GraphRequestError ? error.message : error instanceof Error ? error.message : String(error),
});

/**
 * Quem envia pela clínica, ou null se o WhatsApp dela não está conectado (ou
 * sem token). `serviceDb` é a credencial da clínica.
 */
export async function createClinicSender(
  serviceDb: DbClient,
  clinicId: string,
  { baseUrl, fetcher = fetch }: { baseUrl: string; fetcher?: Fetcher },
): Promise<ClinicSender | null> {
  const setup = await getSendingSetup(serviceDb, clinicId);
  if (!setup) return null;
  const [clinic, settings] = await Promise.all([
    serviceDb.from("clinics").select("name").eq("id", clinicId).maybeSingle().then((r) => unwrapOne(r, "Clínica")),
    serviceDb
      .from("clinic_settings")
      .select("message_article")
      .eq("clinic_id", clinicId)
      .maybeSingle()
      .then((r) => unwrapOne(r, "Configuração da clínica")),
  ]);
  const post = async (message: Record<string, unknown>, body: string): Promise<SendOutcome> => {
    try {
      const messageId = await sendMessage(setup.phoneNumberId, setup.accessToken, message, fetcher);
      return { sent: true, messageId, body };
    } catch (error) {
      console.error("[whatsapp envio]", error instanceof Error ? error.message : String(error));
      return { ...failure(error), body };
    }
  };

  return {
    clinicId,
    clinicLabel: clinicLabel(clinic.name, settings.message_article as MessageArticle),
    baseUrl: baseUrl.replace(/\/$/, ""),
    template(to, key, template, params, buttonPayloads = []) {
      const known = defaultTemplate(key);
      // Só as variáveis que o corpo usa (o cancelamento não leva o local).
      const used = known ? params.slice(0, paramCount(known.body)) : params;
      const components: Record<string, unknown>[] = [];
      if (used.length) components.push({ type: "body", parameters: used.map((text) => ({ type: "text", text: cleanParam(text) })) });
      buttonPayloads.forEach((payload, index) => {
        components.push({ type: "button", sub_type: "quick_reply", index: String(index), parameters: [{ type: "payload", payload }] });
      });
      const body = known ? fillTemplate(known.body, used) : `[${template.name}] ${used.join(" · ")}`;
      return post(
        {
          to: toWaNumber(to),
          type: "template",
          template: { name: template.name, language: { code: template.language }, ...(components.length ? { components } : {}) },
        },
        body,
      );
    },
    text(to, body) {
      return post({ to: toWaNumber(to), type: "text", text: { body, preview_url: true } }, body);
    },
  };
}

/** Lembrete (template com os botões Confirmar presença · Remarcar · Cancelar). */
export function reminderSender(sender: ClinicSender): ReminderSender {
  return (reminder) =>
    sender.template(reminder.phone, "reminder", reminder.template, appointmentParams(sender.clinicLabel, reminder), reminder.buttonPayloads);
}

/** Preparo do exame: texto com as orientações (janela aberta) ou template com o link (fechada). */
export function preparationSender(sender: ClinicSender): PreparationSender {
  return (preparation) => {
    const link = `${sender.baseUrl}${preparation.pagePath}`;
    const greeting = `Olá, ${firstName(preparation.contactName)}! Aqui é ${sender.clinicLabel}.`;
    if (preparation.mode === "text" || !preparation.template) {
      return sender.text(
        preparation.phone,
        `${greeting}\nPreparo do exame *${preparation.examName}*:\n\n${preparation.instructions}\n\nAs orientações também estão neste link: ${link}\n\nQualquer dúvida, é só responder esta mensagem.`,
      );
    }
    return sender.template(preparation.phone, "exam_preparation", preparation.template, [
      firstName(preparation.contactName),
      sender.clinicLabel,
      preparation.examName,
      link,
    ]);
  };
}
