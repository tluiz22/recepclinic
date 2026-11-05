import { todayIn } from "../../../clinicTime";
import type { Designation, NounArticle } from "../../../designation";
import type { FeatureKey } from "../../../features";
import type { ClinicProfile } from "../../../vocabulary";
import type { DbClient } from "../../clients";
import { unwrap, unwrapOne } from "../../errors";
import { getClinicFeatures } from "../../features";
import { getWhatsappConnection } from "../connection";
import { listBotMessages, renderMarkers, type BotMessageKey } from "../customMessages";
import { logFunnelStep, markHandoffSubjectAsked, setConversationState, WELCOME, type Conversation } from "../conversations";
import { recordOutboundMessage, type SendOutcome } from "../messages";
import { botRetryContext } from "../retryRules";
import { sendPreparationFile, type ClinicSender, type ListSection, type ReplyButton } from "../send";
import { downloadPreparationFile } from "../preparation";
import type { PreparationFile } from "../../config/preparationFile";
import { preparationFileCaption } from "../../../preparationMessage";
import { loadCatalog, type BotCatalog } from "./catalog";
import {
  ASK_BIRTHDATE_AGAIN,
  HANDOFF_SUBJECT_QUESTION,
  INVALID_BIRTHDATE,
  INVALID_BIRTHDATE_AGAIN,
  LIST_BUTTON,
  MEDIA_AUDIO,
  MEDIA_OTHER,
  NOT_UNDERSTOOD_YES_NO,
  RECEPTION_CONFIRM,
  RECEPTION_CONFIRM_BUTTONS,
  receptionContactOffer,
  wayOutButtons,
  welcome,
  wordsFor,
  YES_NO_BACK_BUTTONS,
  YES_NO_BUTTONS,
  type Words,
} from "./texts";

// Núcleo do bot (F6.3): a conversa em andamento, o que se sabe da clínica e
// as respostas. Toda resposta é enviada pelo número da clínica e registrada
// em `whatsapp_messages` (tipo `bot_…`), com o texto que o paciente vê.

export type BotEnv = { db: DbClient; clinicId: string; sender: ClinicSender; now: Date };

export type BotClinic = {
  name: string;
  /** "da Clínica Sorriso". */
  label: string;
  profile: ClinicProfile;
  timeZone: string;
  today: string;
  ageLimitYears: number | null;
  paymentInfo: string | null;
  insuranceInfo: string | null;
  notes: string | null;
  /** Como a clínica é chamada nos textos genéricos (cliente, 11/out/2026). */
  designation: Designation;
  /** Prazo para oferecer horários, em dias. */
  horizonDays: number;
};

export type Bot = BotEnv & {
  phone: string;
  convo: Conversation;
  clinic: BotClinic;
  words: Words;
  features: FeatureKey[];
  /** "Falar com a recepção" só com o número em coexistência (cliente, 07/out). */
  receptionAvailable: boolean;
  /** Id da Meta da mensagem que está sendo respondida (registro do toque no lembrete). */
  incomingId: string | null;
  /** Textos próprios da clínica (item "Mensagens personalizadas", F6.6). */
  custom: Map<BotMessageKey, string>;
  /** Catálogo, lido na primeira vez que o fluxo precisa. */
  catalog(): Promise<BotCatalog>;
  /** Lista ou botões enviados nesta mensagem (id da Meta; null = foram em texto). */
  promptId?: string | null;
  /** Tipo da mensagem do paciente ("text", "audio", "image"…; F8.5d). */
  incomingType: string | null;
  /** O bot respondeu "não entendi" a esta mensagem (F8.5d). */
  notUnderstoodSaid?: boolean;
  /** Texto digitado pelo paciente (null = toque, mídia ou vazio). */
  incomingText?: string | null;
  /** Base de conhecimento (BC, Etapa 4): consultada no lugar do primeiro "não entendi" da mensagem. */
  knowledge?: KnowledgeHook;
};

/**
 * Base de conhecimento no "não entendi" (BC, Etapa 4): o router liga com a base
 * publicada e o item da matriz. `run` responde (a resposta já foi enviada e o
 * passo se repete sem o "não entendi"), não reconhece, ou pede para assumir a
 * conversa (fluxo, recepção, "Você quis dizer…?", aviso de saúde).
 */
export type KnowledgeHook = {
  /** Já consultada nesta mensagem. */
  done: boolean;
  /** Repetir o passo sem o "não entendi" (depois de uma resposta escolhida no "Você quis dizer…?"). */
  silent: boolean;
  run(b: Bot): Promise<"answered" | "none" | KnowledgeTakeover>;
};

/** A base assume a conversa: o fluxo do passo para e o router faz o resto (como no limite do "não entendi"). */
export class KnowledgeTakeover extends Error {
  constructor(readonly action: unknown) {
    super("Bot: a base de conhecimento assumiu a mensagem");
    this.name = "KnowledgeTakeover";
  }
}

/** Mensagens seguidas que o bot não entende até a conversa ir para a clínica (cliente, 27/out/2026). */
export const NOT_UNDERSTOOD_LIMIT = 4;

/** A próxima resposta seria o 4º "não entendi" seguido: o fluxo para e a conversa vai para a clínica (router). */
export class NotUnderstoodLimitReached extends Error {
  constructor() {
    super("Bot: limite de mensagens não entendidas");
    this.name = "NotUnderstoodLimitReached";
  }
}

const AUDIO_TYPES = new Set(["audio", "voice"]);
const MEDIA_TYPES = new Set(["image", "video", "sticker", "document"]);

/**
 * Cada "não entendi" passa por aqui (F8.5d): conta uma vez por mensagem do
 * paciente e, com a recepção no app (coexistência), barra o 4º seguido. Para
 * mídia, o texto próprio no lugar do "não entendi" genérico. Antes, a base de
 * conhecimento: se ela respondeu, null (o passo se repete sem o "não entendi"
 * e não conta).
 */
async function notUnderstood(b: Bot, body: string): Promise<string | null> {
  if (b.knowledge && !b.knowledge.done && !b.notUnderstoodSaid) {
    b.knowledge.done = true;
    const outcome = await b.knowledge.run(b);
    if (outcome instanceof KnowledgeTakeover) throw outcome;
    if (outcome === "answered") b.knowledge.silent = true;
  }
  if (b.knowledge?.silent) return null;
  if (!b.notUnderstoodSaid && b.receptionAvailable && b.convo.notUnderstoodCount + 1 >= NOT_UNDERSTOOD_LIMIT) throw new NotUnderstoodLimitReached();
  b.notUnderstoodSaid = true;
  if (b.incomingType && AUDIO_TYPES.has(b.incomingType)) return MEDIA_AUDIO;
  if (b.incomingType && MEDIA_TYPES.has(b.incomingType)) return MEDIA_OTHER;
  return body;
}

const NOT_UNDERSTOOD_KIND = "bot_not_understood";

/**
 * Última lista ou botões da conversa (id da Meta), no contexto: toque numa
 * mensagem anterior não vale (cliente, 23/out/2026).
 */
export const PROMPT_KEY = "_prompt";

/** Pedido de recepção esperando o Sim ou o Não (no contexto, sem trocar o passo; router e base de conhecimento). */
export const RECEPTION_CONFIRM_KEY = "_reception_confirm";

/**
 * Transferência que o bot oferece (cliente, 31/out/2026: nunca transferir sem perguntar), guardada em
 * RECEPTION_CONFIRM_KEY no lugar do `true` do pedido digitado. `kind` e `reason` são os da transferência de antes;
 * `noMenu`: clínica sem nada para marcar, o "Não" despede em vez do menu.
 */
export type ReceptionOffer = { kind: string; reason: "no_availability" | "requested" | "not_understood"; noMenu?: boolean };

/** Pergunta da transferência: com a recepção no app, "Você quer falar com a recepção?"; sem, se a clínica entra em contato. */
export async function offerReception(b: Bot, offer: ReceptionOffer, lead: string | null): Promise<void> {
  await mergeContext(b, { [RECEPTION_CONFIRM_KEY]: offer });
  const question = b.receptionAvailable ? RECEPTION_CONFIRM : receptionContactOffer(b.clinic.designation);
  await sendButtons(b, `${offer.kind}_offer`, lead ? `${lead}\n\n${question}` : question, RECEPTION_CONFIRM_BUTTONS);
}

export const currentPrompt = (convo: Conversation): string | null => ((convo.context ?? {}) as Record<string, unknown>)[PROMPT_KEY] as string | null ?? null;

export async function loadBotClinic(env: BotEnv): Promise<BotClinic> {
  const [clinic, settings] = await Promise.all([
    env.db.from("clinics").select("name").eq("id", env.clinicId).maybeSingle().then((r) => unwrapOne(r, "Clínica")),
    env.db
      .from("clinic_settings")
      .select("profile, timezone, consultation_age_limit_years, bot_payment_info, bot_insurance_info, bot_notes, message_noun, message_noun_article, booking_horizon_days")
      .eq("clinic_id", env.clinicId)
      .maybeSingle()
      .then((r) => unwrapOne(r, "Configuração da clínica")),
  ]);
  return {
    name: clinic.name,
    label: env.sender.clinicLabel,
    profile: settings.profile,
    timeZone: settings.timezone,
    today: todayIn(settings.timezone, env.now),
    ageLimitYears: settings.consultation_age_limit_years,
    paymentInfo: settings.bot_payment_info?.trim() || null,
    insuranceInfo: settings.bot_insurance_info?.trim() || null,
    notes: settings.bot_notes?.trim() || null,
    designation: { noun: settings.message_noun, article: settings.message_noun_article as NounArticle },
    horizonDays: settings.booking_horizon_days,
  };
}

export async function createBot(env: BotEnv, convo: Conversation, incomingId: string | null = null, incomingType: string | null = null): Promise<Bot> {
  const [clinic, features, connection] = await Promise.all([
    loadBotClinic(env),
    getClinicFeatures(env.db, env.clinicId),
    getWhatsappConnection(env.db, env.clinicId),
  ]);
  const custom = features.includes("custom_messages") ? await listBotMessages(env.db, env.clinicId) : new Map<BotMessageKey, string>();
  let catalog: Promise<BotCatalog> | null = null;
  return {
    ...env,
    phone: convo.phone,
    convo,
    clinic,
    words: wordsFor(clinic.profile),
    features,
    receptionAvailable: connection?.coexistence ?? false,
    incomingId,
    incomingType,
    custom,
    catalog: () => (catalog ??= loadCatalog(env.db, env.clinicId, features)),
  };
}

async function record(b: Bot, kind: string, outcome: SendOutcome, body: string): Promise<void> {
  await recordOutboundMessage(
    b.db,
    b.clinicId,
    {
      phone: b.phone,
      contactId: b.convo.contactId,
      messageType: kind,
      body: outcome.body ?? body,
      status: outcome.sent ? "sent" : "failed",
      waMessageId: outcome.sent ? outcome.messageId : null,
      // Falha passageira da Meta: reenvio rápido (cliente, 05/nov/2026).
      retry: { outcome, context: botRetryContext(b.now) },
    },
    tick(b),
  );
}

/** Texto livre (sempre dentro da janela de 24h: o paciente acabou de escrever). */
export async function say(b: Bot, kind: string, body: string): Promise<void> {
  const text = kind === NOT_UNDERSTOOD_KIND ? await notUnderstood(b, body) : body;
  if (text === null) return;
  await record(b, kind, await b.sender.text(b.phone, text), text);
}

/** Pergunta do passo sem o "não entendi" do começo (a base já respondeu). */
function withoutNotUnderstood(body: string): string {
  if (body.startsWith(NOT_UNDERSTOOD_YES_NO)) return body.slice(NOT_UNDERSTOOD_YES_NO.length).trim() || body;
  return body.replace(/^Não entendi\.\s+/, "");
}

/** Preparo com arquivo (C7.5): o documento com a legenda, como na confirmação. */
export async function sayPreparationFile(b: Bot, kind: string, examName: string, file: PreparationFile): Promise<void> {
  let outcome: SendOutcome;
  try {
    outcome = await sendPreparationFile(b.sender, b.phone, examName, await downloadPreparationFile(b.db, file), null);
  } catch (error) {
    outcome = { sent: false, reason: error instanceof Error ? error.message : String(error) };
  }
  await record(b, kind, outcome, `[${file.name}] ${preparationFileCaption(examName)}`);
}

export async function sendList(b: Bot, kind: string, body: string, sections: ListSection[]): Promise<void> {
  if (kind === NOT_UNDERSTOOD_KIND && (await notUnderstood(b, body)) === null) body = withoutNotUnderstood(body);
  const outcome = await b.sender.list(b.phone, body, LIST_BUTTON, sections);
  await record(b, kind, outcome, body);
  await rememberPrompt(b, outcome.sent ? outcome.messageId : null);
  if (!outcome.sent) await textFallback(b, kind, outcome, body, sections.flatMap((section) => section.rows));
}

export async function sendButtons(b: Bot, kind: string, body: string, buttons: ReplyButton[]): Promise<void> {
  if (kind === NOT_UNDERSTOOD_KIND && (await notUnderstood(b, body)) === null) body = withoutNotUnderstood(body);
  const outcome = await b.sender.buttons(b.phone, body, buttons);
  await record(b, kind, outcome, body);
  await rememberPrompt(b, outcome.sent ? outcome.messageId : null);
  if (!outcome.sent) await textFallback(b, kind, outcome, body, buttons.map((button, index) => ({ ...button, title: `${index + 1}. ${button.title}` })));
}

/**
 * Data de nascimento não entendida (cliente, 30/out/2026): conta no "não entendi" (na 4ª seguida, a conversa vai
 * para a clínica) e, da 2ª seguida em diante, vem com "Voltar ao menu" e "Falar com a recepção". Digitar a data
 * continua valendo.
 */
export async function sayInvalidBirthdate(b: Bot): Promise<void> {
  const again = b.convo.notUnderstoodCount > 0;
  const body = await notUnderstood(b, again ? INVALID_BIRTHDATE_AGAIN : INVALID_BIRTHDATE);
  // A base respondeu: a pergunta da data de novo, sem o "não entendi".
  if (body === null) return say(b, "bot_ask_birthdate_again", ASK_BIRTHDATE_AGAIN);
  if (again) return sendButtons(b, "bot_invalid_birthdate", body, wayOutButtons(b.receptionAvailable));
  await record(b, "bot_invalid_birthdate", await b.sender.text(b.phone, body), body);
}

/**
 * Sim/Não não entendido: o aviso e a pergunta de novo numa mensagem com Sim e Não; da 2ª seguida em diante
 * (cliente, 30/out/2026), também com "Voltar ao menu".
 */
export async function repeatYesNo(b: Bot, kind: string, question: string): Promise<void> {
  // Sempre com os botões (cliente, 01/nov/2026); da 2ª seguida, com "Voltar ao menu".
  await sendButtons(b, NOT_UNDERSTOOD_KIND, `${NOT_UNDERSTOOD_YES_NO}\n\n${question}`, b.convo.notUnderstoodCount > 0 ? YES_NO_BACK_BUTTONS : YES_NO_BUTTONS);
}

/** Botões de Sim/Não: com "Voltar ao menu" quando esta é a 2ª resposta não entendida seguida (cliente, 30/out/2026). */
export const yesNoButtonsFor = (b: Bot) => (b.notUnderstoodSaid && b.convo.notUnderstoodCount > 0 ? YES_NO_BACK_BUTTONS : YES_NO_BUTTONS);

/** Junta valores ao contexto da conversa sem trocar o passo (undefined tira a chave). */
export async function mergeContext(b: Bot, values: Record<string, unknown>): Promise<void> {
  const context = { ...((b.convo.context ?? {}) as Record<string, unknown>), ...values };
  for (const key of Object.keys(values)) if (values[key] === undefined) delete context[key];
  unwrap(await b.db.from("conversation_state").update({ context: context as never }).eq("id", b.convo.id), "Conversa do WhatsApp");
  b.convo = { ...b.convo, context };
}

/** Guarda a lista ou os botões que valem agora (o passo pode continuar o mesmo, sem `go`). */
async function rememberPrompt(b: Bot, id: string | null): Promise<void> {
  b.promptId = id;
  const context = { ...((b.convo.context ?? {}) as Record<string, unknown>), [PROMPT_KEY]: id };
  unwrap(await b.db.from("conversation_state").update({ context: context as never }).eq("id", b.convo.id), "Conversa do WhatsApp");
  b.convo = { ...b.convo, context };
}

/**
 * Lista ou botões recusados pela Meta (ex.: erro 131000, passageiro): as
 * mesmas opções em texto, para a conversa não parar (cliente, 23/out/2026).
 * O número digitado vale como o toque.
 */
async function textFallback(b: Bot, kind: string, outcome: SendOutcome, body: string, options: { title: string; description?: string }[]): Promise<void> {
  if (!outcome.sent && outcome.reason === "contato anonimizado") return;
  const lines = options.map((o) => (o.description ? `${o.title} (${o.description})` : o.title));
  await say(b, `${kind}_text`, `${body}\n\n${lines.join("\n")}\n\nResponda com o número da opção.`);
}

/** Horário do próximo passo do funil: 1 ms depois do anterior, para a ordem dos passos de uma mesma mensagem. */
export function tick(b: Bot): Date {
  b.now = new Date(b.now.getTime() + 1);
  return b.now;
}

/** Troca o estado (e o contexto) da conversa; dentro de uma tentativa, vira passo do funil. */
export async function go(b: Bot, state: string, context: object = {}): Promise<void> {
  // Opções enviadas nesta mensagem; senão, as de antes só no mesmo passo (passo novo sem opções: nenhum toque vale).
  const prompt = b.promptId !== undefined ? b.promptId : state === b.convo.state ? currentPrompt(b.convo) : null;
  b.convo = await setConversationState(b.db, b.clinicId, b.phone, state, { context: { ...(context as Record<string, unknown>), [PROMPT_KEY]: prompt } }, tick(b));
}

/** Passo avulso no funil da tentativa em andamento. */
export function step(b: Bot, name: string, metadata: Record<string, unknown> = {}): Promise<void> {
  return logFunnelStep(b.db, b.convo, b.clinicId, name, metadata, tick(b));
}

/** Fim da tentativa (link enviado, bloqueio, erro): resultado no funil e conversa do começo. */
export async function end(b: Bot, outcome: string, metadata: Record<string, unknown> = {}): Promise<void> {
  await step(b, outcome, metadata);
  await go(b, WELCOME);
}

/** O contato passou a existir no meio da conversa (cadastro pelo bot). */
export async function attachContact(b: Bot, contactId: string): Promise<void> {
  unwrap(await b.db.from("conversation_state").update({ contact_id: contactId }).eq("id", b.convo.id), "Conversa do WhatsApp");
  b.convo = { ...b.convo, contactId };
}

/** Texto da mensagem: o próprio da clínica (com os valores nos marcadores) ou o padrão. */
export function textFor(b: Bot, key: BotMessageKey, fallback: string, values: Record<string, string> = {}): string {
  const custom = b.custom.get(key);
  return custom ? renderMarkers(custom, values) : fallback;
}

/** Boas-vindas: o texto próprio da clínica ou o padrão (com a base ligada, convida a escrever; EA, 02/nov/2026). */
export function welcomeText(b: Bot): string {
  return textFor(b, "welcome", welcome(b.clinic.label, b.features.includes("knowledge_base")), { clinica: b.clinic.label });
}

/** Depois de passar a conversa para a recepção (jornada E4): pergunta o assunto, uma vez por pausa. */
export async function askHandoffSubject(b: Bot): Promise<void> {
  if (!(await markHandoffSubjectAsked(b.db, b.clinicId, b.phone, b.now))) return;
  await say(b, "bot_handoff_subject", HANDOFF_SUBJECT_QUESTION);
}
