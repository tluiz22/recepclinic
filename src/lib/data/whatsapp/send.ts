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
    /** `body`: texto próprio da versão personalizada (F6.6); sem ele, o padrão. */
    template: { name: string; language: string; body?: string | null },
    params: string[],
    buttonPayloads?: string[],
  ): Promise<SendOutcome>;
  text(to: string, body: string): Promise<SendOutcome>;
  /** Lista interativa (até 10 linhas no total). Só na janela de 24h, como o texto. */
  list(to: string, body: string, button: string, sections: ListSection[]): Promise<SendOutcome>;
  /** Botões de resposta (até 3, título com até 20 caracteres). */
  buttons(to: string, body: string, buttons: ReplyButton[]): Promise<SendOutcome>;
};

export type ListRow = { id: string; title: string; description?: string };
export type ListSection = { title?: string; rows: ListRow[] };
export type ReplyButton = { id: string; title: string };

/** Texto registrado de uma lista ou dos botões: o corpo e as opções, como o paciente vê. */
export function interactiveBody(body: string, options: { title: string; description?: string }[]): string {
  return `${body}\n\n${options.map((o) => (o.description ? `${o.title} (${o.description})` : o.title)).join("\n")}`;
}

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
      const text = template.body ?? defaultTemplate(key)?.body ?? null;
      // Só as variáveis que o corpo usa (o cancelamento não leva o local).
      const used = text ? params.slice(0, paramCount(text)) : params;
      const components: Record<string, unknown>[] = [];
      if (used.length) components.push({ type: "body", parameters: used.map((text) => ({ type: "text", text: cleanParam(text) })) });
      buttonPayloads.forEach((payload, index) => {
        components.push({ type: "button", sub_type: "quick_reply", index: String(index), parameters: [{ type: "payload", payload }] });
      });
      const body = text ? fillTemplate(text, used) : `[${template.name}] ${used.join(" · ")}`;
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
    list(to, body, button, sections) {
      return post(
        { to: toWaNumber(to), type: "interactive", interactive: { type: "list", body: { text: body }, action: { button, sections } } },
        interactiveBody(body, sections.flatMap((section) => section.rows)),
      );
    },
    buttons(to, body, buttons) {
      return post(
        {
          to: toWaNumber(to),
          type: "interactive",
          interactive: { type: "button", body: { text: body }, action: { buttons: buttons.map((reply) => ({ type: "reply", reply })) } },
        },
        interactiveBody(body, buttons),
      );
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
