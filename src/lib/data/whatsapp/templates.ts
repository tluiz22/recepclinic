import { formatInstant } from "../../clinicTime";
import type { TemplateKey, TemplateStatus, WhatsappTemplate } from "./connection";
import type { FeatureKey } from "../../features";
import { formatCalendarDate } from "../../clinicTime";

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
  /** Documento (PDF) no topo da mensagem (F11.5): a Meta pede um PDF de exemplo na criação. */
  documentHeader?: boolean;
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
    // Cancelamento pela clínica com o link de remarcação (F6.5; texto do cliente, 05 e 07/out).
    key: "clinic_cancellation",
    name: "rc_cancelamento_clinica_v1",
    body:
      `${GREETING}\nPrecisamos cancelar o atendimento de {{3}} ({{4}}) de {{5}}. Pedimos desculpas pelo transtorno.\n\n` +
      "Para escolher um novo horário, use o link (vale por 2 dias):\n{{6}}\n\nSe preferir, responda esta mensagem.",
    examples: ["Maria", "da Clínica Sorriso", "João", "Consulta", "segunda, 12/10 às 08:00", "https://app.recepclinic.com.br/agendar/exemplo"],
  },
  {
    key: "reminder",
    name: "rc_lembrete_v1",
    body: `${GREETING}\nPassando para lembrar do seu atendimento:\n\n📋 {{3}}\n👤 Paciente: {{4}}\n📅 {{5}}\n📍 {{6}}\n\nPode confirmar a presença?`,
    examples: APPOINTMENT_EXAMPLES,
    quickReplies: ["Confirmar presença", "Remarcar", "Cancelar"],
  },
  {
    // v2: a Meta classificou a v1 como marketing (07/out); o texto deixa claro que é o exame marcado.
    // v3 (C7.4; cliente, 28/out/2026): sai logo depois da confirmação, então sem saudação e sem link; as
    // instruções cadastradas numa linha só (src/lib/preparationMessage.ts). Quem ainda só tem a v2 aprovada
    // continua com ela (preparationSender, LEGACY_PREPARATION). C7.5: final "Estamos à disposição…".
    key: "exam_preparation",
    name: "rc_preparo_exame_v3",
    body: "Segue orientações para a realização do exame {{1}}:\n\n{{2}}\n\nEstamos à disposição para qualquer dúvida.",
    examples: ["Espirometria", "*Não usar* broncodilatador nas 4 horas anteriores. · Venha de roupa confortável."],
  },
  {
    // Preparo com arquivo, com a conversa fechada (C7.5; cliente, 28/out/2026): a única mensagem do preparo,
    // com o arquivo no topo. A v1 ("… em anexo.", enviada depois do preparo) a Meta pôs como marketing.
    key: "exam_preparation_file",
    name: "rc_preparo_arquivo_v2",
    body: "Segue orientações para a realização do exame {{1}}:\n\nEstamos à disposição para qualquer dúvida.",
    examples: ["Espirometria"],
    documentHeader: true,
  },
  {
    // Orientações gerais da consulta, fora da janela de 24h (texto aprovado pelo cliente em 08/out).
    key: "consultation_guidance",
    name: "rc_orientacoes_consulta_v1",
    body: `${GREETING}\nPara a consulta de {{3}} que você marcou, veja as orientações gerais neste link: {{4}}\n\n${ANY_QUESTION}`,
    examples: ["Maria", "da Clínica Sorriso", "João Silva", "https://app.recepclinic.com.br/orientacoes/exemplo"],
  },
  // Resumo do dia para a equipe (F7; texto aprovado pelo cliente em 07/out/2026).
  ...(["consultations", "exams"] as const).flatMap((kind) =>
    (["", "_today"] as const).map((suffix) => {
      const noun = kind === "exams" ? "Exames" : "Consultas";
      // O de hoje tem texto próprio (v2): quase igual ao de amanhã, a Meta recusou (INVALID_FORMAT, 07/out).
      // O de amanhã também foi recusado (texto fixo curto para 4 variáveis); o cliente editou o recusado
      // na Meta com o texto abaixo, mesmo nome (10/out).
      return {
        key: `daily_summary_${kind}${suffix}` as TemplateKey,
        name: `rc_resumo_${kind === "exams" ? "exames" : "consultas"}_${suffix ? "hoje_v2" : "amanha_v1"}`,
        body: suffix
          ? `Oi, {{1}}, tudo bem? A agenda de ${noun.toLowerCase()} {{2}} para hoje, {{3}}, é esta:\n\n{{4}}\n\nBom trabalho! Esta é uma mensagem automática do RecepClinic.`
          : `Olá, {{1}}! Para a equipe se preparar, a agenda de ${noun.toLowerCase()} {{2}} de amanhã, {{3}}, ficou assim:\n\n{{4}}\n\nAté amanhã! Esta é uma mensagem automática do RecepClinic.`,
        examples: ["Ana", "da Clínica Sorriso", "terça, 08/10", "▪️ 09h00 - João Silva (✅ confirmado) ▪️ 10h30 - Maria Souza (sem confirmação)"],
      };
    }),
  ),
  {
    // Oferta de vaga da lista de espera (F7; texto do piloto com a clínica, aprovado em 07/out).
    key: "waitlist_offer",
    name: "rc_oferta_vaga_v1",
    body: `${GREETING}\nAbriu uma vaga de {{3}} para {{4}}: {{5}}. É antes do horário marcado ({{6}}).\n\nQuer antecipar? Responda em até 60 minutos.`,
    examples: ["Maria", "da Clínica Sorriso", "consulta", "João Silva", "terça, 08/10 às 14:00 (Consultório Centro)", "sexta, 18/10 às 09:00"],
    quickReplies: ["Sim, quero antecipar", "Não, manter horário"],
  },
  {
    // Nota fiscal do pagamento, com o PDF (DANFSe) no topo (F11.5; texto aprovado pelo cliente em 12/out).
    key: "nfse_document",
    name: "rc_nota_fiscal_v1",
    body: `${GREETING}\nSegue a nota fiscal nº {{3}}, de {{4}}, referente ao atendimento de {{5}} em {{6}}.\n\n${ANY_QUESTION}`,
    examples: ["Maria", "da Clínica Sorriso", "123", "R$ 300,00", "João Souza", "05/10/2026"],
    documentHeader: true,
  },
];

/** Texto da v2 do preparo (com o link), para quem ainda só tem ela aprovada (C7.4). */
export const LEGACY_PREPARATION_BODY = `${GREETING}\nPara o exame {{3}} que você marcou, siga as orientações de preparo neste link: {{4}}\n\n${ANY_QUESTION}`;

export function defaultTemplate(key: TemplateKey): DefaultTemplate | null {
  return DEFAULT_TEMPLATES.find((t) => t.key === key) ?? null;
}

/** Templates que a clínica usa com os itens liberados (aba Mensagens e o aviso da F8.2). */
export function templatesInUse(features: readonly FeatureKey[]): DefaultTemplate[] {
  const has = (feature: FeatureKey) => features.includes(feature);
  return DEFAULT_TEMPLATES.filter(
    (t) =>
      ((t.key !== "exam_preparation" && t.key !== "exam_preparation_file") || has("exams")) &&
      (!t.key.startsWith("daily_summary") || has("daily_summary")) &&
      (!t.key.startsWith("daily_summary_exams") || has("exams")) &&
      (t.key !== "waitlist_offer" || has("waitlist")) &&
      (t.key !== "nfse_document" || has("finance")),
  );
}

export type TemplateApproval = { approved: number; pending: number; rejected: number; missing: number };

/**
 * Situação dos templates em uso na conta da clínica (F8.2), como o envio vê:
 * aprovado = alguma versão aprovada (o envio sai); senão, em análise,
 * recusado (ou desativado) ou ainda não enviado à Meta.
 */
export function templateApproval(inUse: DefaultTemplate[], saved: WhatsappTemplate[]): TemplateApproval {
  const summary: TemplateApproval = { approved: 0, pending: 0, rejected: 0, missing: 0 };
  for (const template of inUse) {
    const versions = saved.filter((t) => t.key === template.key && t.stage === "meta");
    if (versions.some((t) => t.status === "approved")) summary.approved += 1;
    else if (versions.some((t) => t.status === "pending")) summary.pending += 1;
    else if (versions.length) summary.rejected += 1;
    else summary.missing += 1;
  }
  return summary;
}

/** Frase da situação: "10 aprovadas, 2 em análise…"; null = todas aprovadas. */
export function describeTemplateApproval(summary: TemplateApproval): string | null {
  if (!summary.pending && !summary.rejected && !summary.missing) return null;
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  return [
    summary.approved && n(summary.approved, "aprovada", "aprovadas"),
    summary.pending && `${summary.pending} em análise`,
    summary.rejected && n(summary.rejected, "recusada", "recusadas"),
    summary.missing && n(summary.missing, "ainda não enviada", "ainda não enviadas"),
  ]
    .filter(Boolean)
    .join(", ");
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

/**
 * Corpo do pedido de criação do template na conta (POST /{waba}/message_templates).
 * `headerHandle`: o PDF de exemplo já enviado à Meta (template com documento).
 */
export function templateCreationPayload(template: DefaultTemplate, headerHandle?: string): Record<string, unknown> {
  const components: Record<string, unknown>[] = [];
  if (template.documentHeader) components.push({ type: "HEADER", format: "DOCUMENT", example: { header_handle: [headerHandle ?? ""] } });
  components.push({ type: "BODY", text: template.body, example: { body_text: [template.examples] } });
  if (template.quickReplies?.length) {
    components.push({ type: "BUTTONS", buttons: template.quickReplies.map((text) => ({ type: "QUICK_REPLY", text })) });
  }
  return { name: template.name, language: TEMPLATE_LANGUAGE, category: TEMPLATE_CATEGORY, components };
}

/** Corpo da edição do template recusado (POST /{id}; F8a.1): sem nome nem idioma, que não mudam. */
export function templateEditPayload(template: DefaultTemplate, headerHandle?: string): Record<string, unknown> {
  const { category, components } = templateCreationPayload(template, headerHandle);
  return { category, components };
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

// ---------------------------------------------------------------------------
// Variáveis do resumo do dia e da oferta de vaga (F7)
// ---------------------------------------------------------------------------

/** "terça, 08/10" (data do calendário da clínica). */
export const formatSummaryDate = (date: string) => formatCalendarDate(date, "EEE, dd/MM");

/** {{3}} da oferta: "consulta", "retorno", "exame Espirometria". */
export function offerTypeWord(category: "consultation" | "return_visit" | "exam", serviceName: string): string {
  return category === "exam" ? `exame ${serviceName}` : category === "return_visit" ? "retorno" : "consulta";
}
