// Notificações de agendamento por WhatsApp (Fase 3a).
//
// Camada acima do cliente de baixo nível (`./client`): monta os parâmetros
// do template aprovado na Meta, dispara o envio e SEMPRE registra a
// mensagem em `whatsapp_messages`. É melhor esforço — uma falha no envio ou
// no log não deve reverter a operação (marcar/remarcar/cancelar) que a
// originou.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTemplateMessage, sendTextMessage } from "./client";
import { formatWhen } from "./formatDateTime";
import { formatCentsBRL } from "../money";
import { buildAppUrl, updateConversationState } from "./bot/shared";
import { preparationText } from "./bot/messages";

interface NotificationInput {
  supabase: SupabaseClient;
  appointmentId: string;
  guardianId: string;
  guardianPhone: string; // E.164, ex.: "+5584981880777"
  patientName: string;
  // Tipo e local do atendimento — os rótulos das variáveis {{1}} (tipo) e
  // {{4}} (local) são montados aqui dentro (ver `notificationTypeLabel` /
  // `notificationLocationLabel`), não pelo chamador, pra todos os templates
  // falarem igual. Agenda/Calendar continuam com os rótulos deles.
  appointmentType: string; // "first_visit" | "return_visit" | "exam"
  examName?: string | null;
  locationType?: string | null; // `clinic_locations.type`: "clinic" | "home_visit" | "exam"
  scheduledAt: Date;
  // Endereço completo do local (`clinic_locations.address`) — nulo para
  // atendimento domiciliar (não há endereço fixo, é a equipe que vai até a
  // casa). Só usado pelas notificações que incluem "onde será a consulta"
  // (confirmação, remarcação, lembrete) — o cancelamento não precisa.
  locationAddress?: string | null;
  // Valor da consulta em centavos (`clinic_locations.price_first_visit_cents`).
  // Nulo/omitido para retorno — o retorno não tem valor próprio, está
  // incluso no valor da consulta anterior (decisão do cliente). Só usado na
  // confirmação — pedido do cliente, para o responsável já saber o valor e a
  // forma de pagamento na primeira mensagem que recebe.
  priceCents?: number | null;
  // URL de `/agendar/[token]` pra remarcar — só o cancelamento em massa
  // (Fase 12) usa, com um `booking_links` de validade mais longa (a
  // notificação é passiva, sem conversa ativa pra justificar os 30min
  // padrão do bot).
  link?: string;
}

interface NotificationSpec {
  messageType: string;
  // Nome do template aprovado na Meta (de uma env var). Resolvido pelo
  // chamador com referência estática, pois `import.meta.env[chave]` dinâmico
  // não é confiável no build do Astro.
  templateName: string | undefined;
  // Substitui o rótulo do tipo na variável {{1}} — só a confirmação no
  // layout novo usa ("Agradecemos por agendar {{1}}.").
  firstParameter?: string;
  // Quando true, adiciona o endereço como próxima variável do template —
  // usado nas notificações que precisam dizer ao responsável onde será a
  // consulta.
  includeAddress?: boolean;
  // Quando true, adiciona o valor da consulta como próxima variável — só a
  // confirmação usa.
  includePrice?: boolean;
  // Quando true, adiciona o link de agendamento como próxima variável — só
  // o cancelamento em massa (Fase 12) usa.
  includeLink?: boolean;
  // Payloads dos botões de resposta rápida do template, na ordem dos
  // botões — só o lembrete no layout novo usa (Fase 19).
  quickReplyPayloads?: string[];
  buildPreview: (
    typeLabel: string,
    patientName: string,
    whenLabel: string,
    locationLabel: string,
    addressText: string | null,
    priceText: string | null,
    link: string | null
  ) => string;
}

// "Consulta" | "Retorno" | "Exame (<nome>)" — rótulo usado também na Agenda
// e no evento do Calendar.
export function buildAppointmentTypeLabel(
  appointmentType: string,
  examName?: string | null
): string {
  if (appointmentType === "exam") return examName ? `Exame (${examName})` : "Exame";
  return appointmentType === "return_visit" ? "Retorno" : "Consulta";
}

// Variável {{1}} dos templates: rótulo pronto, sem artigo — os templates
// (padrão de set/2026) mostram em lista ("📋 {{1}}"), sem frase flexionada
// ("remarcada"/"remarcado") que dependa do gênero do tipo.
function notificationTypeLabel(appointmentType: string, examName?: string | null, locationType?: string | null): string {
  if (appointmentType === "first_visit" && locationType === "home_visit") return "Consulta domiciliar";
  return buildAppointmentTypeLabel(appointmentType, examName);
}

// Variável {{4}} ("📍 Local: {{4}}"). Exame também é "Consultório"
// (decisão do cliente) — o endereço vai na variável seguinte.
function notificationLocationLabel(locationType?: string | null): string {
  return locationType === "home_visit" ? "Atendimento domiciliar" : "Consultório";
}

// {{1}} da confirmação no layout novo ("Agradecemos por agendar {{1}}.").
// Exame não cita a médica — alguns são feitos direto pela secretária.
function confirmationThanksPhrase(appointmentType: string, examName?: string | null, locationType?: string | null): string {
  if (appointmentType === "exam") return examName ? `o exame ${examName}` : "o exame";
  const withDoctor = " com a Dra. Ana Karina Fernandes";
  if (appointmentType === "return_visit") return `o retorno${withDoctor}`;
  return locationType === "home_visit" ? `a consulta domiciliar${withDoctor}` : `a consulta${withDoctor}`;
}

// Assinatura comum aos templates do paciente (padrão de set/2026) — só
// para o texto registrado em `whatsapp_messages`; o texto enviado é o do
// template aprovado na Meta.
const SIGNATURE_PREVIEW =
  "Qualquer dúvida, estamos à disposição!\n\n*Dra. Ana Karina Fernandes – Pneumopediatra*\nCRM 5751 | RQE 6271";

function listPreview(intro: string, typeLabel: string, patientName: string, dateLine: string, locationLabel: string): string {
  return `Olá! 😊\n\n${intro}\n\n📋 ${typeLabel}\n👶 Paciente: ${patientName}\n${dateLine}\n📍 Local: ${locationLabel}`;
}

// Texto do endereço/localização enviado como variável do template. Sem
// endereço cadastrado (atendimento domiciliar), usa um texto fixo em vez do
// endereço do consultório — não faz sentido mandar o endereço da clínica
// quando é a equipe que vai até a casa do paciente.
function buildLocationAddressText(address: string | null | undefined): string {
  if (!address) {
    return "A equipe estará no endereço combinado com você.";
  }
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  return `Endereço: ${address}. Localização: ${mapsUrl}`;
}

// Texto do valor enviado como variável do template — frase completa (não só
// o número) porque o retorno não tem valor próprio, está incluso no valor
// da consulta anterior (decisão do cliente), e as duas frases precisam
// funcionar dentro do mesmo template aprovado na Meta.
function buildPriceText(priceCents: number | null | undefined): string {
  if (priceCents == null) {
    return "O retorno está incluso no valor da consulta anterior.";
  }
  return `O valor é de ${formatCentsBRL(priceCents)}.`;
}

// Dispara uma notificação e grava o log. Retorna o status registrado
// (`sent` | `failed` | `skipped_no_template`); nunca lança.
async function sendNotification(
  {
    supabase,
    appointmentId,
    guardianId,
    guardianPhone,
    patientName,
    appointmentType,
    examName,
    locationType,
    scheduledAt,
    locationAddress,
    priceCents,
    link,
  }: NotificationInput,
  spec: NotificationSpec
): Promise<string> {
  const languageCode = (import.meta.env.WHATSAPP_TEMPLATE_LANGUAGE as string | undefined) ?? "pt_BR";

  const typeLabel = spec.firstParameter ?? notificationTypeLabel(appointmentType, examName, locationType);
  const locationLabel = notificationLocationLabel(locationType);
  const whenLabel = formatWhen(scheduledAt);
  const addressText = spec.includeAddress ? buildLocationAddressText(locationAddress) : null;
  const priceText = spec.includePrice ? buildPriceText(priceCents) : null;
  const linkText = spec.includeLink ? (link ?? null) : null;

  // Ordem dos parâmetros ({{1}} tipo, {{2}} nome, {{3}} data-hora, {{4}}
  // local, {{5}} endereço/valor/link) precisa bater com o corpo do template
  // aprovado na Meta — cada notificação usa só as variáveis extras que o seu
  // template declara. "Tipo" entra em set/2026 pra reaproveitar os mesmos
  // templates entre consulta/retorno/exame (ver `notificationTypeLabel`).
  const bodyParameters = [typeLabel, patientName, whenLabel, locationLabel];
  if (addressText !== null) bodyParameters.push(addressText);
  if (priceText !== null) bodyParameters.push(priceText);
  if (linkText !== null) bodyParameters.push(linkText);

  const bodyPreview = spec.buildPreview(typeLabel, patientName, whenLabel, locationLabel, addressText, priceText, linkText);

  let status: string;
  let waMessageId: string | null = null;

  if (!spec.templateName) {
    status = "skipped_no_template";
    console.warn(
      `[whatsapp] template de ${spec.messageType} não configurado — não enviado, apenas registrado.`
    );
  } else {
    try {
      const { id } = await sendTemplateMessage({
        to: guardianPhone,
        templateName: spec.templateName,
        languageCode,
        bodyParameters,
        quickReplyPayloads: spec.quickReplyPayloads,
      });
      status = "sent";
      waMessageId = id;
      console.log(`[whatsapp] ${spec.messageType} enviado (${id}) para ${guardianPhone}`);
    } catch (err) {
      status = "failed";
      console.error(
        `[whatsapp] falha ao enviar ${spec.messageType}:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  const { error } = await supabase.from("whatsapp_messages").insert({
    appointment_id: appointmentId,
    guardian_id: guardianId,
    direction: "outbound",
    message_type: spec.messageType,
    template_name: spec.templateName ?? null,
    body: bodyPreview,
    status,
    wa_message_id: waMessageId,
  });

  if (error) {
    console.error("[whatsapp] falha ao registrar whatsapp_messages:", error.message);
  }

  // Essas notificações (confirmação/remarcação/cancelamento/lembrete) não
  // passam pelo roteador do bot — sem isso, a conversa ficava parada em
  // qualquer estado que estivesse antes (ex.: MENU de uma interação
  // anterior), e um "ok" de resposta à notificação caía direto em "não
  // entendi" em vez de reiniciar do zero. Reseta mesmo se o envio falhou ou
  // o template ainda não foi aprovado — a ação (marcar/remarcar/cancelar) já
  // aconteceu de verdade no sistema, independente da entrega da mensagem.
  await updateConversationState(supabase, guardianPhone, "WELCOME", { context: {} });

  return status;
}

// Consulta/retorno/exame recém-marcado. Retorno usa um template próprio
// (`WHATSAPP_TEMPLATE_CONFIRMATION_RETURN`), com as mesmas variáveis mas sem
// a frase fixa de pagamento — o retorno não tem valor próprio (pedido do
// cliente). Enquanto esse template não existir/não for aprovado na Meta, cai
// no template geral, com a frase.
//
// Layout novo (set/2026: "Olá! 😊 / Agradecemos por agendar {{1}}." + lista
// + assinatura): {{1}} vira a frase completa ("a consulta domiciliar com a
// Dra. …", "o exame …"). Como o texto antigo do template ("Atendimento
// confirmado: {{1}} de {{2}}…") não combina com essa frase, cada template
// só passa pro layout novo quando a versão nova for aprovada na Meta e a
// env var correspondente for ligada (`…_NEW_LAYOUT=true`).
export function sendAppointmentConfirmation(input: NotificationInput): Promise<string> {
  const returnTemplate = import.meta.env.WHATSAPP_TEMPLATE_CONFIRMATION_RETURN as string | undefined;
  const useReturnTemplate = input.appointmentType === "return_visit" && !!returnTemplate;
  const newLayout = useReturnTemplate
    ? import.meta.env.WHATSAPP_TEMPLATE_CONFIRMATION_RETURN_NEW_LAYOUT === "true"
    : import.meta.env.WHATSAPP_TEMPLATE_CONFIRMATION_NEW_LAYOUT === "true";
  const paymentSentence = useReturnTemplate
    ? ""
    : "Atendimento somente particular — pagamento em dinheiro, transferência bancária ou PIX.";

  return sendNotification(input, {
    messageType: "appointment_confirmation",
    templateName: useReturnTemplate ? returnTemplate : import.meta.env.WHATSAPP_TEMPLATE_CONFIRMATION,
    firstParameter: newLayout
      ? confirmationThanksPhrase(input.appointmentType, input.examName, input.locationType)
      : undefined,
    includeAddress: true,
    includePrice: true,
    buildPreview: (type, name, when, location, address, price) =>
      newLayout
        ? `Olá! 😊\n\nAgradecemos por agendar ${type}.\n\n👶 Paciente: ${name}\n📅 Data: ${when}\n📍 Local: ${location}\n\n` +
          `${address}\n\n${price}\n\n` +
          (paymentSentence ? `${paymentSentence}\n\n` : "") +
          SIGNATURE_PREVIEW
        : `Atendimento confirmado: ${type} de ${name}, para ${when}, no ${location}. ${address} ${price}` +
          (paymentSentence ? ` ${paymentSentence}` : ""),
  });
}

// Consulta/retorno/exame remarcado — `scheduledAt`/`locationType` são os
// novos valores.
export function sendAppointmentReschedule(input: NotificationInput): Promise<string> {
  return sendNotification(input, {
    messageType: "appointment_reschedule",
    templateName: import.meta.env.WHATSAPP_TEMPLATE_RESCHEDULE,
    includeAddress: true,
    buildPreview: (type, name, when, location, address) =>
      `${listPreview("Seu agendamento foi remarcado:", type, name, `📅 Nova data: ${when}`, location)}\n\n` +
      `${address}\n\n${SIGNATURE_PREVIEW}`,
  });
}

// Consulta/retorno/exame cancelado — `scheduledAt`/`locationType` são os
// valores que estavam agendados. Sem endereço: não há mais consulta pra
// dizer onde é.
export function sendAppointmentCancellation(input: NotificationInput): Promise<string> {
  return sendNotification(input, {
    messageType: "appointment_cancellation",
    templateName: import.meta.env.WHATSAPP_TEMPLATE_CANCELLATION,
    buildPreview: (type, name, when, location) =>
      `${listPreview("Seu agendamento foi cancelado:", type, name, `📅 Data: ${when}`, location)}\n\n` +
      `Se quiser remarcar, é só responder esta mensagem.\n\n${SIGNATURE_PREVIEW}`,
  });
}

// Cancelamento em massa de um dia (Fase 12) — motivo fixo ("imprevisto da
// médica"), já inclui o link de um `booking_links` novo (validade mais
// longa que o padrão do bot) pra remarcar sem precisar escrever pro bot.
export function sendMassCancellationNotice(input: NotificationInput): Promise<string> {
  return sendNotification(input, {
    messageType: "appointment_mass_cancellation",
    templateName: import.meta.env.WHATSAPP_TEMPLATE_MASS_CANCELLATION,
    includeLink: true,
    buildPreview: (type, name, when, location, _address, _price, link) =>
      `${listPreview("Por um imprevisto da médica, precisamos cancelar o seu agendamento:", type, name, `📅 Data: ${when}`, location)}\n\n` +
      `Pedimos desculpas pelo transtorno. Para escolher uma nova data, acesse: ${link}\n\n${SIGNATURE_PREVIEW}`,
  });
}

// Ações dos botões do lembrete (Fase 19), na ordem dos botões do template:
// Confirmar presença · Remarcar · Cancelar.
export const REMINDER_ACTIONS = ["confirm", "reschedule", "cancel"] as const;
export type ReminderAction = (typeof REMINDER_ACTIONS)[number];

// Payload de cada botão: `reminder:<ação>:<appointment_id>` — identifica o
// atendimento do toque mesmo quando o responsável (ex.: convênio) recebe um
// lembrete por criança.
export function reminderButtonPayload(action: ReminderAction, appointmentId: string): string {
  return `reminder:${action}:${appointmentId}`;
}

// Lembrete disparado pelo cron ~1 dia antes da consulta/retorno/exame.
// Layout novo (Fase 19: lista + assinatura + 3 botões, sem "amanhã" — a
// janela de 26h do cron também pega atendimentos do mesmo dia) só com
// `WHATSAPP_TEMPLATE_REMINDER_NEW_LAYOUT=true`, depois da aprovação da
// versão com botões na Meta: mandar payload de botão para o template antigo
// (sem botões) dá erro.
export function sendAppointmentReminder(input: NotificationInput): Promise<string> {
  const newLayout = import.meta.env.WHATSAPP_TEMPLATE_REMINDER_NEW_LAYOUT === "true";
  return sendNotification(input, {
    messageType: "appointment_reminder",
    templateName: import.meta.env.WHATSAPP_TEMPLATE_REMINDER,
    includeAddress: true,
    quickReplyPayloads: newLayout
      ? REMINDER_ACTIONS.map((action) => reminderButtonPayload(action, input.appointmentId))
      : undefined,
    buildPreview: (type, name, when, location, address) =>
      newLayout
        ? `${listPreview("Passando para lembrar do seu agendamento:", type, name, `📅 Data: ${when}`, location)}\n\n` +
          `${address}\n\nPor favor, confirme sua presença tocando em um dos botões abaixo.\n\n${SIGNATURE_PREVIEW}\n\n` +
          "[Confirmar presença] [Remarcar] [Cancelar]"
        : `Lembrete: ${type} de ${name} é amanhã, ${when}, no ${location}. ${address} ` +
          "Nos vemos em breve! Qualquer dúvida ou se precisar remarcar, é só responder esta mensagem.",
  });
}

// --- preparo do exame (Fase 18) --------------------------------------------

// Margem sobre as 24h da Meta: a última mensagem do responsável pode ter
// chegado quase no limite, e o envio acontece alguns segundos depois da
// checagem.
const CUSTOMER_SERVICE_WINDOW_MS = 23.5 * 60 * 60 * 1000;

// Janela de atendimento de 24h aberta = o responsável mandou alguma
// mensagem nas últimas 24h (sempre o caso quando marcou pelo bot). Só aí a
// Meta aceita texto livre, com o preparo formatado.
async function isCustomerServiceWindowOpen(supabase: SupabaseClient, guardianId: string): Promise<boolean> {
  const since = new Date(Date.now() - CUSTOMER_SERVICE_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select("id")
    .eq("guardian_id", guardianId)
    .eq("direction", "inbound")
    .gte("created_at", since)
    .limit(1);
  if (error) {
    console.error("[whatsapp] falha ao checar a janela de 24h:", error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

interface ExamPreparationInput {
  supabase: SupabaseClient;
  appointmentId: string;
  guardianId: string;
  guardianPhone: string;
  examTypeId: string;
}

// Preparo do exame, enviado logo depois da confirmação, da remarcação e do
// lembrete (decisão do cliente). Janela de 24h aberta → texto formatado pela
// médica + link da página `/preparo/[id]`; fechada → template com o nome do
// exame e o link (parâmetro de template não aceita quebra de linha, por isso
// o texto não vai direto). Exame sem preparo cadastrado → não envia nada
// (retorna null). Melhor esforço, como as demais notificações: registra em
// `whatsapp_messages` e nunca lança.
export async function sendExamPreparation({
  supabase,
  appointmentId,
  guardianId,
  guardianPhone,
  examTypeId,
}: ExamPreparationInput): Promise<string | null> {
  const { data: exam } = await supabase
    .from("exam_types")
    .select("name, preparation_instructions")
    .eq("id", examTypeId)
    .maybeSingle();
  const preparation = exam?.preparation_instructions?.trim();
  if (!exam || !preparation) return null;

  const url = buildAppUrl(`/preparo/${examTypeId}`);
  const windowOpen = await isCustomerServiceWindowOpen(supabase, guardianId);
  const templateName = windowOpen
    ? null
    : ((import.meta.env.WHATSAPP_TEMPLATE_EXAM_PREPARATION as string | undefined) ?? null);
  const body = windowOpen
    ? preparationText(preparation, url)
    : `Olá! Seguem as orientações de preparo para o exame ${exam.name}.\n\n` +
      `Para ver todas as orientações, acesse: ${url}\n\n` +
      "Qualquer dúvida, estamos à disposição!\n\n" +
      "*Dra. Ana Karina Fernandes – Pneumopediatra*\nCRM 5751 | RQE 6271";

  let status: string;
  let waMessageId: string | null = null;

  if (!windowOpen && !templateName) {
    status = "skipped_no_template";
    console.warn("[whatsapp] template de exam_preparation não configurado — não enviado, apenas registrado.");
  } else {
    try {
      const { id } = windowOpen
        ? await sendTextMessage({ to: guardianPhone, body })
        : await sendTemplateMessage({
            to: guardianPhone,
            templateName: templateName!,
            languageCode: (import.meta.env.WHATSAPP_TEMPLATE_LANGUAGE as string | undefined) ?? "pt_BR",
            bodyParameters: [exam.name, url],
          });
      status = "sent";
      waMessageId = id;
      console.log(`[whatsapp] exam_preparation (${windowOpen ? "texto" : "template"}) enviado (${id}) para ${guardianPhone}`);
    } catch (err) {
      status = "failed";
      console.error("[whatsapp] falha ao enviar exam_preparation:", err instanceof Error ? err.message : String(err));
    }
  }

  const { error } = await supabase.from("whatsapp_messages").insert({
    appointment_id: appointmentId,
    guardian_id: guardianId,
    direction: "outbound",
    message_type: "exam_preparation",
    template_name: templateName,
    body,
    status,
    wa_message_id: waMessageId,
  });
  if (error) {
    console.error("[whatsapp] falha ao registrar whatsapp_messages:", error.message);
  }

  return status;
}
