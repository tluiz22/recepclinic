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
import { linkBody, sendPreparationFile, type ClinicSender, type LinkButton, type ListSection, type ReplyButton } from "../send";
import { downloadPreparationFile } from "../preparation";
import type { PreparationFile } from "../../config/preparationFile";
import { preparationFileCaption } from "../../../preparationMessage";
import { logError } from "../../../log";
import { firstName } from "../templates";
import { loadCatalog, type BotCatalog } from "./catalog";
import { buildScope, EXAMS_CHOICE, PROFESSIONAL_KEY, scopeAttendance, scopeCatalog, type ProfessionalScope } from "./professionalScope";
import { BOOKING_HORIZON_DEFAULT } from "../../config/clinic";
import {
  HANDOFF_SUBJECT_QUESTION,
  LIST_BUTTON,
  MEDIA_AUDIO,
  MEDIA_OTHER,
  NOT_UNDERSTOOD_YES_NO,
  RECEPTION_CONFIRM,
  RECEPTION_CONFIRM_BUTTONS,
  receptionContactOffer,
  wordsFor,
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
  /** Informações que o bot responde: as do profissional em uso (MI, 07/nov/2026); null sem profissional. */
  paymentInfo: string | null;
  insuranceInfo: string | null;
  notes: string | null;
  /** Convênios que o profissional em uso atende (null: item "Convênios" desligado ou sem profissional; vazio: só particular). */
  insurancePlans: string[] | null;
  /** Nome do profissional em uso (Informações › Convênios). */
  professionalName: string | null;
  /** O profissional em uso atende particular ("Atende particular" no cadastro; F1). Sem profissional: true. */
  acceptsPrivate: boolean;
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
  /** Catálogo no contexto do profissional escolhido (MB). */
  catalog(): Promise<BotCatalog>;
  /** Profissionais da clínica e a escolha da conversa (MB, 07/nov/2026). */
  scope: ProfessionalScope;
  /** Catálogo da clínica inteira (a escolha da especialidade e do profissional). */
  fullCatalog: BotCatalog;
  /** Perfil calculado da clínica (antes da escolha do profissional; cliente, 08/nov/2026). */
  clinicProfile: ClinicProfile;
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
  /** A equipe assumiu a conversa enquanto o bot respondia (CN4b): nada mais sai nesta mensagem. */
  heldByStaff?: boolean;
};

/**
 * O bot relê a pausa antes de cada envio (Central de atendimento, CN4b; plano, seção 3.4): se a equipe assumiu a
 * conversa (resposta pela Central ou pelo app) depois que o bot começou a responder, ele para. A pausa pedida pelo
 * próprio fluxo (o paciente pediu a recepção, limite do contato) não conta: ali o bot ainda avisa o paciente.
 */
async function staffTookOver(b: Bot): Promise<boolean> {
  if (b.heldByStaff) return true;
  if (b.convo.humanHandoff) return false;
  let data: { human_handoff: boolean; handoff_changed_by: string | null } | null = null;
  try {
    const result = await b.db
      .from("conversation_state")
      .select("human_handoff, handoff_changed_by")
      .eq("clinic_id", b.clinicId)
      .eq("contact_phone", b.phone)
      .maybeSingle();
    data = result.error ? null : result.data;
  } catch {
    // Sem a leitura, o bot segue (como antes da Central).
  }
  if (!data) return false;
  b.heldByStaff = data.human_handoff && data.handoff_changed_by === "reception";
  return b.heldByStaff;
}

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
export async function notUnderstood(b: Bot, body: string): Promise<string | null> {
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
      .select("profile, timezone, message_noun, message_noun_article")
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
    // Perfil, prazo e idade limite são do profissional (cliente, 08/nov/2026): createBot troca pelos da conversa.
    ageLimitYears: null,
    // MI (07/nov/2026): as informações são do profissional (createBot); aqui, nenhuma.
    paymentInfo: null,
    insuranceInfo: null,
    notes: null,
    insurancePlans: null,
    acceptsPrivate: true,
    professionalName: null,
    designation: { noun: settings.message_noun, article: settings.message_noun_article as NounArticle },
    horizonDays: BOOKING_HORIZON_DEFAULT,
  };
}

export async function createBot(env: BotEnv, convo: Conversation, incomingId: string | null = null, incomingType: string | null = null): Promise<Bot> {
  const [clinic, features, connection] = await Promise.all([
    loadBotClinic(env),
    getClinicFeatures(env.db, env.clinicId),
    getWhatsappConnection(env.db, env.clinicId),
  ]);
  const custom = features.includes("custom_messages") ? await listBotMessages(env.db, env.clinicId) : new Map<BotMessageKey, string>();
  // O catálogo diz quem atende pelo bot: com mais de um profissional, a conversa segue no contexto do escolhido (MB).
  const fullCatalog = await loadCatalog(env.db, env.clinicId, features);
  const scope = buildScope(fullCatalog, convo.context);
  const b: Bot = {
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
    scope,
    fullCatalog,
    clinicProfile: clinic.profile,
    catalog: async () => scopeCatalog(fullCatalog, scope),
  };
  await loadProfessionalInfo(b);
  return b;
}

type ProfessionalInfo = Pick<BotClinic, "paymentInfo" | "insuranceInfo" | "notes" | "insurancePlans" | "professionalName" | "acceptsPrivate">;

/** Informações que o bot responde e convênios de um profissional (MI e MC, 07/nov/2026); sem profissional, nada. */
export async function professionalInfoFor(
  db: DbClient,
  clinicId: string,
  features: readonly FeatureKey[],
  current: ProfessionalScope["current"],
): Promise<ProfessionalInfo> {
  if (!current) return { paymentInfo: null, insuranceInfo: null, notes: null, insurancePlans: null, professionalName: null, acceptsPrivate: true };
  const [info, links, professional] = await Promise.all([
    db
      .from("professional_bot_info")
      .select("payment_info, insurance_info, notes")
      .eq("clinic_id", clinicId)
      .eq("professional_id", current.id)
      .maybeSingle()
      .then((r) => unwrap(r, "Informações do bot")),
    features.includes("insurance")
      ? db
          .from("professional_insurance_plans")
          .select("insurance_plans(name, is_active)")
          .eq("clinic_id", clinicId)
          .eq("professional_id", current.id)
          .then((r) => unwrap(r, "Convênios atendidos"))
      : Promise.resolve(null),
    db.from("professionals").select("accepts_private").eq("clinic_id", clinicId).eq("id", current.id).maybeSingle().then((r) => unwrap(r, "Profissional")),
  ]);
  // Clínica sem nenhum plano ativo: o bot não fala de convênio (nem "só particular").
  const anyPlan =
    links !== null &&
    (links.length > 0 ||
      unwrap(await db.from("insurance_plans").select("id").eq("clinic_id", clinicId).eq("is_active", true).limit(1), "Convênios").length > 0);
  return {
    paymentInfo: info?.payment_info?.trim() || null,
    insuranceInfo: info?.insurance_info?.trim() || null,
    notes: info?.notes?.trim() || null,
    insurancePlans: links && anyPlan
      ? links
          .map((l) => l.insurance_plans)
          .filter((plan): plan is { name: string; is_active: boolean } => !!plan && plan.is_active)
          .map((plan) => plan.name)
          .sort((x, y) => x.localeCompare(y, "pt-BR"))
      : null,
    professionalName: current.name,
    acceptsPrivate: professional?.accepts_private ?? true,
  };
}

async function loadProfessionalInfo(b: Bot): Promise<void> {
  b.clinic = {
    ...b.clinic,
    ...(await professionalInfoFor(b.db, b.clinicId, b.features, b.scope.current)),
    ...scopeAttendance(b.fullCatalog, b.scope, b.clinicProfile),
  };
  b.words = wordsFor(b.clinic.profile);
}

export { EXAMS_CHOICE };

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
  if (text === null || (await staffTookOver(b))) return;
  await record(b, kind, await b.sender.text(b.phone, text), text);
}

/** Pergunta do passo sem o "não entendi" do começo (a base já respondeu). */
function withoutNotUnderstood(body: string): string {
  if (body.startsWith(NOT_UNDERSTOOD_YES_NO)) return body.slice(NOT_UNDERSTOOD_YES_NO.length).trim() || body;
  return body.replace(/^Não entendi\.\s+/, "");
}

/** Preparo com arquivo (C7.5): o documento com a legenda, como na confirmação. */
export async function sayPreparationFile(b: Bot, kind: string, examName: string, file: PreparationFile): Promise<void> {
  if (await staffTookOver(b)) return;
  let outcome: SendOutcome;
  try {
    outcome = await sendPreparationFile(b.sender, b.phone, examName, await downloadPreparationFile(b.db, file), null);
  } catch (error) {
    outcome = { sent: false, reason: error instanceof Error ? error.message : String(error) };
  }
  await record(b, kind, outcome, `[${file.name}] ${preparationFileCaption(examName)}`);
}

export async function sendList(b: Bot, kind: string, body: string, sections: ListSection[], header?: string): Promise<void> {
  if (kind === NOT_UNDERSTOOD_KIND && (await notUnderstood(b, body)) === null) body = withoutNotUnderstood(body);
  if (await staffTookOver(b)) return;
  const outcome = await b.sender.list(b.phone, body, LIST_BUTTON, sections, header);
  await record(b, kind, outcome, body);
  await rememberPrompt(b, outcome.sent ? outcome.messageId : null);
  if (!outcome.sent) await textFallback(b, kind, outcome, body, sections.flatMap((section) => section.rows));
}

export async function sendButtons(b: Bot, kind: string, body: string, buttons: ReplyButton[]): Promise<void> {
  if (kind === NOT_UNDERSTOOD_KIND && (await notUnderstood(b, body)) === null) body = withoutNotUnderstood(body);
  if (await staffTookOver(b)) return;
  const outcome = await b.sender.buttons(b.phone, body, buttons);
  await record(b, kind, outcome, body);
  await rememberPrompt(b, outcome.sent ? outcome.messageId : null);
  if (!outcome.sent) await textFallback(b, kind, outcome, body, buttons.map((button, index) => ({ ...button, title: `${index + 1}. ${button.title}` })));
}

/**
 * Mensagem com o botão de link (bot enxuto, BE-3): uma mensagem só. Sem o botão (sender sem `link`, ou a Meta
 * recusou), o mesmo texto com o endereço, para a conversa não parar.
 */
export async function sendLink(b: Bot, kind: string, body: string, button: LinkButton): Promise<void> {
  if (await staffTookOver(b)) return;
  const outcome = b.sender.link ? await b.sender.link(b.phone, body, button) : null;
  if (outcome) await record(b, kind, outcome, linkBody(body, button));
  if (outcome?.sent || (outcome && outcome.reason === "contato anonimizado")) return;
  const text = `${body}\n${button.url}`;
  await record(b, outcome ? `${kind}_text` : kind, await b.sender.text(b.phone, text), text);
}

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
  // O profissional escolhido segue com a conversa até ela recomeçar (MB, 07/nov/2026).
  const next: Record<string, unknown> = { ...(context as Record<string, unknown>), [PROMPT_KEY]: prompt };
  const chosen = ((b.convo.context ?? {}) as Record<string, unknown>)[PROFESSIONAL_KEY];
  if (state !== WELCOME && chosen !== undefined && !(PROFESSIONAL_KEY in next)) next[PROFESSIONAL_KEY] = chosen;
  b.convo = await setConversationState(b.db, b.clinicId, b.phone, state, { context: next }, tick(b));
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

/** Texto da mensagem: o próprio da clínica (com os valores nos marcadores) ou o padrão. */
export function textFor(b: Bot, key: BotMessageKey, fallback: string, values: Record<string, string> = {}): string {
  const custom = b.custom.get(key);
  return custom ? renderMarkers(custom, values) : fallback;
}

/** Primeiro nome do contato da conversa (número cadastrado); null sem cadastro ou se a leitura falhar. */
export async function contactFirstName(b: Bot): Promise<string | null> {
  if (!b.convo.contactId) return null;
  const { data, error } = await b.db.from("contacts").select("full_name").eq("clinic_id", b.clinicId).eq("id", b.convo.contactId).maybeSingle();
  if (error) logError("bot: nome do contato", error, { clinica: b.clinicId });
  const name = data?.full_name?.trim();
  return name ? firstName(name) : null;
}

/** Depois de passar a conversa para a recepção (jornada E4): pergunta o assunto, uma vez por pausa. */
export async function askHandoffSubject(b: Bot): Promise<void> {
  if (!(await markHandoffSubjectAsked(b.db, b.clinicId, b.phone, b.now))) return;
  await say(b, "bot_handoff_subject", HANDOFF_SUBJECT_QUESTION);
}
