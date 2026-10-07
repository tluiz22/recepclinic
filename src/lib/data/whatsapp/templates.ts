import { formatInstant } from "../../clinicTime";
import type { TemplateKey, TemplateStatus } from "./connection";

// Templates padrão do RecepClinic (D3b, F6.2): um texto só para todas as
// clínicas, aprovado pelo cliente em 07/out/2026. O que muda por clínica entra
// nas variáveis ({{1}}, {{2}}…, nesta ordem). O Suporte cria cada um na conta
// da clínica pela API (Configurações › WhatsApp); o envio usa o aprovado
// (`whatsapp_templates`). Texto aprovado na Meta não muda no lugar: versão
// nova = outro nome (`_v2`…), como na revisão do D3b.

export type DefaultTemplate = {
  key: TemplateKey;
  /** Nome na Meta (minúsculas, números e "_"). */
  name: string;
  body: string;
  /** Um exemplo por variável, exigido pela Meta na análise. */
  examples: string[];
  /** Botões de resposta rápida, na ordem (payload definido no envio). */
  quickReplies?: string[];
};

export const TEMPLATE_LANGUAGE = "pt_BR";
export const TEMPLATE_CATEGORY = "UTILITY";

const GREETING = "Olá, {{1}}! Aqui é {{2}}.";
const ANY_QUESTION = "Qualquer dúvida, é só responder esta mensagem.";
const APPOINTMENT_EXAMPLES = [
  "Maria",
  "da Clínica Sorriso",
  "Consulta com Dra. Ana Souza",
  "João Silva",
  "segunda, 12/10 às 08:00",
  "Consultório — Rua das Flores, 100, Centro",
];

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    key: "confirmation",
    name: "rc_confirmacao_v1",
    body: `${GREETING}\nSeu atendimento está marcado:\n\n📋 {{3}}\n👤 Paciente: {{4}}\n📅 {{5}}\n📍 {{6}}\n\n${ANY_QUESTION}`,
    examples: APPOINTMENT_EXAMPLES,
  },
  {
    key: "reschedule",
    name: "rc_remarcacao_v1",
    body: `${GREETING}\nO atendimento foi remarcado:\n\n📋 {{3}}\n👤 Paciente: {{4}}\n📅 Nova data: {{5}}\n📍 {{6}}\n\n${ANY_QUESTION}`,
    examples: APPOINTMENT_EXAMPLES,
  },
  {
    key: "cancellation",
    name: "rc_cancelamento_v1",
    body: `${GREETING}\nO atendimento abaixo foi cancelado:\n\n📋 {{3}}\n👤 Paciente: {{4}}\n📅 {{5}}\n\nSe quiser marcar outro horário, é só responder esta mensagem.`,
    examples: APPOINTMENT_EXAMPLES.slice(0, 5),
  },
  {
    key: "reminder",
    name: "rc_lembrete_v1",
    body: `${GREETING}\nPassando para lembrar do seu atendimento:\n\n📋 {{3}}\n👤 Paciente: {{4}}\n📅 {{5}}\n📍 {{6}}\n\nPode confirmar a presença?`,
    examples: APPOINTMENT_EXAMPLES,
    quickReplies: ["Confirmar presença", "Remarcar", "Cancelar"],
  },
  {
    key: "exam_preparation",
    name: "rc_preparo_exame_v1",
    body: `${GREETING}\nO exame {{3}} precisa de preparo. As orientações estão neste link: {{4}}\n\n${ANY_QUESTION}`,
    examples: ["Maria", "da Clínica Sorriso", "Espirometria", "https://app.recepclinic.com.br/preparo/exemplo"],
  },
];

export function defaultTemplate(key: TemplateKey): DefaultTemplate | null {
  return DEFAULT_TEMPLATES.find((t) => t.key === key) ?? null;
}

/**
 * Variável pronta para a Meta: sem quebra de linha, tabulação nem mais de
 * quatro espaços seguidos (a Meta recusa o envio).
 */
export function cleanParam(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim() || "-";
}

/** Texto que o paciente vê: o corpo com as variáveis preenchidas (registro e prévia). */
export function fillTemplate(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (match, n: string) => params[Number(n) - 1] ?? match);
}

/** Quantas variáveis o corpo usa. */
export function paramCount(body: string): number {
  return new Set(body.match(/\{\{\d+\}\}/g) ?? []).size;
}

// ---------------------------------------------------------------------------
// Variáveis dos avisos de atendimento
// ---------------------------------------------------------------------------

export type MessageArticle = "da" | "do";
export const MESSAGE_ARTICLES: MessageArticle[] = ["da", "do"];

/** {{2}}: "da Clínica Sorriso" / "do Consultório X". */
export function clinicLabel(name: string, article: MessageArticle): string {
  return `${article} ${name.trim()}`;
}

export type AppointmentForMessage = {
  contactName: string;
  patientName: string;
  serviceName: string;
  professionalName: string | null;
  scheduledAt: Date;
  timeZone: string;
  locationName: string;
  isHomeVisit: boolean;
  /** Endereço do atendimento domiciliar, ou do local. */
  address: string | null;
};

/** Primeiro nome do contato, como se fala no WhatsApp. */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/** {{5}}: "segunda, 12/10 às 08:00", no relógio da clínica. */
export function formatAppointmentWhen(at: Date, timeZone: string): string {
  return formatInstant(at, timeZone, "EEE, dd/MM 'às' HH:mm");
}

/** {{6}}: local e endereço ("Consultório — Rua X, 100"; domiciliar sem endereço = "Atendimento domiciliar"). */
export function appointmentPlace(a: Pick<AppointmentForMessage, "locationName" | "isHomeVisit" | "address">): string {
  const name = a.isHomeVisit ? "Atendimento domiciliar" : a.locationName.trim();
  const address = a.address?.trim();
  return address ? `${name} — ${address}` : name;
}

/** {{3}}: o serviço, com o profissional quando o atendimento tem um. */
export function serviceLine(serviceName: string, professionalName: string | null): string {
  return professionalName ? `${serviceName} com ${professionalName}` : serviceName;
}

/** Variáveis {{1}}…{{6}} da confirmação, remarcação e lembrete ({{1}}…{{5}} do cancelamento). */
export function appointmentParams(clinic: string, a: AppointmentForMessage): string[] {
  return [
    firstName(a.contactName),
    clinic,
    serviceLine(a.serviceName, a.professionalName),
    a.patientName,
    formatAppointmentWhen(a.scheduledAt, a.timeZone),
    appointmentPlace(a),
  ].map(cleanParam);
}

// ---------------------------------------------------------------------------
// Meta: criação e situação
// ---------------------------------------------------------------------------

/** Corpo do pedido de criação do template na conta (POST /{waba}/message_templates). */
export function templateCreationPayload(template: DefaultTemplate): Record<string, unknown> {
  const components: Record<string, unknown>[] = [
    { type: "BODY", text: template.body, example: { body_text: [template.examples] } },
  ];
  if (template.quickReplies?.length) {
    components.push({ type: "BUTTONS", buttons: template.quickReplies.map((text) => ({ type: "QUICK_REPLY", text })) });
  }
  return { name: template.name, language: TEMPLATE_LANGUAGE, category: TEMPLATE_CATEGORY, components };
}

/** Situação da Meta (APPROVED, PENDING, REJECTED, PAUSED…) na nossa. */
export function templateStatusFromMeta(status: string | null | undefined): TemplateStatus {
  switch ((status ?? "").toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "REJECTED":
      return "rejected";
    case "PAUSED":
    case "DISABLED":
    case "DELETED":
    case "PENDING_DELETION":
    case "ARCHIVED":
      return "disabled";
    default:
      return "pending";
  }
}

/** Motivo da recusa legível ("NONE" e vazio = sem motivo). */
export function rejectionReason(reason: string | null | undefined): string | null {
  const text = reason?.trim();
  return text && text.toUpperCase() !== "NONE" ? text : null;
}
