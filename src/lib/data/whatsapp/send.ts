import type { GuidanceSender } from "./guidance";
import type { DbClient } from "../clients";
import { unwrapOne } from "../errors";
import { getSendingSetup, type TemplateKey } from "./connection";
import { GraphRequestError, sendMessage, type Fetcher } from "./graph";
import type { SendOutcome } from "./messages";
import { toWaNumber } from "./meta";
import type { PreparationSender } from "./preparation";
import type { ReminderSender } from "./reminders";
import type { DailySummarySender } from "./dailySummary";
import type { OfferSender } from "../waitlist/offers";
import { getApprovedTemplate } from "./connection";
import { isCustomerServiceWindowOpen, recordOutboundMessage } from "./messages";
import { appointmentParams, cleanParam, clinicLabel, defaultTemplate, fillTemplate, firstName, formatAppointmentWhen, formatSummaryDate, offerTypeWord, paramCount, type MessageArticle } from "./templates";

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

/** Orientações gerais da consulta (cliente, 08/out): o texto (janela aberta) ou o template com o link (fechada). */
export function guidanceSender(sender: ClinicSender): GuidanceSender {
  return (guidance) => {
    if (guidance.mode === "text" || !guidance.template) {
      return sender.text(guidance.phone, `Orientações gerais para a consulta:\n\n${guidance.text}`);
    }
    return sender.template(guidance.phone, "consultation_guidance", guidance.template, [
      firstName(guidance.contactName),
      sender.clinicLabel,
      guidance.patientName,
      `${sender.baseUrl}${guidance.pagePath}`,
    ]);
  };
}

/** Resumo do dia para a equipe (F7): template com a lista numa linha só. */
export function dailySummarySender(sender: ClinicSender): DailySummarySender {
  return (summary) => {
    const kind = summary.kind === "exames" ? "exams" : "consultations";
    const key = `daily_summary_${kind}${summary.variant === "final" ? "_today" : ""}` as TemplateKey;
    return sender.template(summary.phone, key, summary.template, [firstName(summary.recipientName), sender.clinicLabel, formatSummaryDate(summary.date), summary.listText]);
  };
}

export const OFFER_BUTTONS = { yes: "Sim, quero antecipar", no: "Não, manter horário" } as const;

/**
 * Oferta de vaga da lista de espera (F7), como no piloto: quem escreveu nas
 * últimas 24h recebe texto com os botões; os demais, o template aprovado (sem
 * ele, a pessoa é pulada nessa vaga). A mensagem fica registrada no atendimento.
 */
export function waitlistOfferSender(sender: ClinicSender, db: DbClient): OfferSender {
  return async (offer) => {
    const when = (at: Date) => formatAppointmentWhen(at, offer.timeZone);
    const params = [
      firstName(offer.contact.fullName),
      sender.clinicLabel,
      offerTypeWord(offer.serviceCategory, offer.serviceName),
      offer.patientName,
      `${when(offer.slotStart)} (${offer.slotIsHomeVisit ? "Atendimento domiciliar" : offer.slotLocationName})`,
      when(offer.currentStart),
    ].map(cleanParam);
    const yes = `waitlist:yes:${offer.offerId}`;
    const no = `waitlist:no:${offer.offerId}`;
    const template = await getApprovedTemplate(db, offer.clinicId, "waitlist_offer");
    let outcome: SendOutcome;
    if (await isCustomerServiceWindowOpen(db, offer.clinicId, offer.contact.phone)) {
      const body = fillTemplate(template?.body ?? defaultTemplate("waitlist_offer")!.body, params);
      outcome = await sender.buttons(offer.contact.phone, body, [
        { id: yes, title: OFFER_BUTTONS.yes },
        { id: no, title: OFFER_BUTTONS.no },
      ]);
    } else if (template) {
      outcome = await sender.template(offer.contact.phone, "waitlist_offer", template, params, [yes, no]);
    } else {
      return { sent: false, reason: "no_template" };
    }
    await recordOutboundMessage(db, offer.clinicId, {
      phone: offer.contact.phone,
      contactId: offer.contact.id,
      appointmentId: offer.appointmentId,
      messageType: "waitlist_offer",
      templateName: template?.name ?? null,
      body: outcome.body ?? null,
      status: outcome.sent ? "sent" : "failed",
      waMessageId: outcome.sent ? outcome.messageId : null,
    });
    return outcome;
  };
}
