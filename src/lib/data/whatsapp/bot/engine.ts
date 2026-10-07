import { todayIn } from "../../../clinicTime";
import type { FeatureKey } from "../../../features";
import type { ClinicProfile } from "../../../vocabulary";
import type { DbClient } from "../../clients";
import { unwrap, unwrapOne } from "../../errors";
import { getClinicFeatures } from "../../features";
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
};

export type Bot = BotEnv & {
  phone: string;
  convo: Conversation;
  clinic: BotClinic;
  words: Words;
  features: FeatureKey[];
  /** Catálogo, lido na primeira vez que o fluxo precisa. */
  catalog(): Promise<BotCatalog>;
};

export async function loadBotClinic(env: BotEnv): Promise<BotClinic> {
  const [clinic, settings] = await Promise.all([
    env.db.from("clinics").select("name").eq("id", env.clinicId).maybeSingle().then((r) => unwrapOne(r, "Clínica")),
    env.db
      .from("clinic_settings")
      .select("profile, timezone, consultation_age_limit_years, bot_payment_info, bot_insurance_info, bot_notes")
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
  };
}

export async function createBot(env: BotEnv, convo: Conversation): Promise<Bot> {
  const [clinic, features] = await Promise.all([loadBotClinic(env), getClinicFeatures(env.db, env.clinicId)]);
  let catalog: Promise<BotCatalog> | null = null;
  return {
    ...env,
    phone: convo.phone,
    convo,
    clinic,
    words: wordsFor(clinic.profile),
    features,
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
  await record(b, kind, await b.sender.list(b.phone, body, LIST_BUTTON, sections), body);
}

export async function sendButtons(b: Bot, kind: string, body: string, buttons: ReplyButton[]): Promise<void> {
  await record(b, kind, await b.sender.buttons(b.phone, body, buttons), body);
}

/** Horário do próximo passo do funil: 1 ms depois do anterior, para a ordem dos passos de uma mesma mensagem. */
function tick(b: Bot): Date {
  b.now = new Date(b.now.getTime() + 1);
  return b.now;
}

/** Troca o estado (e o contexto) da conversa; dentro de uma tentativa, vira passo do funil. */
export async function go(b: Bot, state: string, context: object = {}): Promise<void> {
  b.convo = await setConversationState(b.db, b.clinicId, b.phone, state, { context: context as Record<string, unknown> }, tick(b));
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
