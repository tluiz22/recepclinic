import { todayIn } from "../../../clinicTime";
import type { Designation, NounArticle } from "../../../designation";
import type { FeatureKey } from "../../../features";
import type { ClinicProfile } from "../../../vocabulary";
import type { DbClient } from "../../clients";
import { unwrap, unwrapOne } from "../../errors";
import { getClinicFeatures } from "../../features";
import { getWhatsappConnection } from "../connection";
import { listBotMessages, renderMarkers, type BotMessageKey } from "../customMessages";
import { logFunnelStep, setConversationState, WELCOME, type Conversation } from "../conversations";
import { recordOutboundMessage, type SendOutcome } from "../messages";
import type { ClinicSender, ListSection, ReplyButton } from "../send";
import { loadCatalog, type BotCatalog } from "./catalog";
import { LIST_BUTTON, wordsFor, type Words } from "./texts";

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
};

/**
 * Última lista ou botões da conversa (id da Meta), no contexto: toque numa
 * mensagem anterior não vale (cliente, 23/out/2026).
 */
export const PROMPT_KEY = "_prompt";

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

export async function createBot(env: BotEnv, convo: Conversation, incomingId: string | null = null): Promise<Bot> {
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
    },
    tick(b),
  );
}

/** Texto livre (sempre dentro da janela de 24h: o paciente acabou de escrever). */
export async function say(b: Bot, kind: string, body: string): Promise<void> {
  await record(b, kind, await b.sender.text(b.phone, body), body);
}

export async function sendList(b: Bot, kind: string, body: string, sections: ListSection[]): Promise<void> {
  const outcome = await b.sender.list(b.phone, body, LIST_BUTTON, sections);
  await record(b, kind, outcome, body);
  await rememberPrompt(b, outcome.sent ? outcome.messageId : null);
  if (!outcome.sent) await textFallback(b, kind, outcome, body, sections.flatMap((section) => section.rows));
}

export async function sendButtons(b: Bot, kind: string, body: string, buttons: ReplyButton[]): Promise<void> {
  const outcome = await b.sender.buttons(b.phone, body, buttons);
  await record(b, kind, outcome, body);
  await rememberPrompt(b, outcome.sent ? outcome.messageId : null);
  if (!outcome.sent) await textFallback(b, kind, outcome, body, buttons.map((button, index) => ({ ...button, title: `${index + 1}. ${button.title}` })));
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
function tick(b: Bot): Date {
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
