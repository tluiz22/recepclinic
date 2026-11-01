import { preparationMessageText } from "../../../../preparationMessage";
import type { KbFlow } from "../../../../knowledge/lists";
import { matchQuestion, type CompiledKb, type DetectedTerms, type KbEntry } from "../../../../knowledge/match";
import { publishedKnowledge } from "../../../knowledge/published";
import { logAbandonment } from "../../conversations";
import { BOOKING_STATES, startBooking, startReturn, type BookingContext } from "../booking";
import { KnowledgeTakeover, mergeContext, RECEPTION_CONFIRM_KEY, say, sayPreparationFile, sendButtons, sendList, type Bot, type KnowledgeHook } from "../engine";
import { startIdentification } from "../entry";
import { BACK_TO_MENU_ID, pick, type Selection } from "../input";
import { askWaitlistType, startManage } from "../manage";
import { showMenu, showPreparationChoice, showSubmenu } from "../menus";
import * as t from "../texts";
import { CLINICAL_NOTICE, clinicTermsOf, composeAnswer, type KbAnswer, type KbClinicData, type KbContext } from "./answers";
import { loadKbClinicData } from "./clinicData";
import { logError } from "../../../../log";

// Base de conhecimento no bot (BC, Etapa 4; docs/base-de-conhecimento.md).
// Entra só onde o bot diria "não entendi" (decisão 2): o motor chama `run` no
// primeiro "não entendi" da mensagem. Resposta em texto: enviada, e o passo se
// repete sem o "não entendi" (não conta para o limite). Fluxo, recepção, aviso
// de saúde, "Você quis dizer…?" e "Marcar": o passo para e a base assume. Não
// reconhecida: o "não entendi" de hoje, e o texto fica para o Suporte (decisão 4).
// Toque, número, sim/não, data, "menu" e o pedido de recepção vêm antes, como hoje.

/** Fora destes passos a pessoa está num fluxo (marcar, remarcar, cancelar…): a resposta não tira dele. */
const FREE_STATES = new Set(["WELCOME", "MENU", "CONSULTAS_MENU", "EXAMES_MENU", "INFO_MENU", "INFO_PREP_SELECT"]);
export const inFlow = (b: Bot) => !FREE_STATES.has(b.convo.state);

/** "Você quis dizer…?" pendente: as opções e a mensagem original (no contexto, sem trocar o passo). */
const OPTIONS_KEY = "_kb_options";
const MESSAGE_KEY = "_kb_message";
const PICK_PREFIX = "kb_pick_";
const NONE_ID = "kb_none";
const BOOK_PREFIX = "kb_book_";

type Takeover =
  | { kind: "flow"; flow: KbFlow; group: t.Group; typed?: "consultation" | "return_visit" | "exam" }
  | { kind: "reception"; text: string }
  | { kind: "offer_reception" }
  | { kind: "clinical" }
  | { kind: "book_offer"; text: string; category: "consultation" | "exam" | "return_visit"; serviceId?: string }
  | { kind: "preparation_list" }
  | { kind: "ambiguous"; options: KbEntry[]; message: string };

type Session = { kb: CompiledKb; data: KbClinicData | null };

/** A base compilada e os dados da clínica desta mensagem (lidos uma vez só). */
const sessions = new WeakMap<KnowledgeHook, Session>();

/** Liga a base nesta mensagem: item da matriz e base publicada. */
export async function knowledgeHookFor(b: Bot): Promise<KnowledgeHook | undefined> {
  if (!b.features.includes("knowledge_base")) return undefined;
  let kb: CompiledKb | null;
  try {
    kb = await publishedKnowledge(b.db);
  } catch (error) {
    logError("bot: base de conhecimento", error, { clinica: b.clinicId });
    return undefined;
  }
  if (!kb) return undefined;
  const session: Session = { kb, data: null };
  const hook: KnowledgeHook = { done: false, silent: false, run: (bot) => run(bot, session) };
  sessions.set(hook, session);
  return hook;
}

const sessionOf = (b: Bot) => (b.knowledge ? sessions.get(b.knowledge) : undefined);

async function dataOf(b: Bot, session: Session): Promise<KbClinicData> {
  session.data ??= await loadKbClinicData(b);
  return session.data;
}

function contextOf(b: Bot): KbContext {
  if (!BOOKING_STATES.has(b.convo.state)) return {};
  const ctx = b.convo.context as BookingContext;
  return { serviceId: ctx.serviceId, locationType: ctx.locationCategory ?? undefined };
}

/** Tipo dito na mensagem (exame, retorno ou consulta, ou o serviço citado); undefined = não disse. */
const typedCategory = (terms: DetectedTerms, data: KbClinicData, message: string): "consultation" | "return_visit" | "exam" | undefined => {
  const named = data.catalog.services.filter((s) => terms.serviceIds.includes(s.id));
  if (named.length) return named[0].category as "consultation" | "return_visit" | "exam";
  if (/\bexames?\b/i.test(message)) return "exam";
  if (/\bretornos?\b/i.test(message)) return "return_visit";
  if (/\bconsultas?\b/i.test(message)) return "consultation";
  return undefined;
};

const groupOf = (terms: DetectedTerms, data: KbClinicData, message: string): t.Group => {
  const named = data.catalog.services.filter((s) => terms.serviceIds.includes(s.id));
  if (named.some((s) => s.category === "exam") || /\bexames?\b/i.test(message)) return "exam";
  return "consultation";
};

async function logUnmatched(b: Bot, text: string): Promise<void> {
  try {
    await b.db.from("kb_unmatched").insert({ clinic_id: b.clinicId, text: text.slice(0, 500), conversation_state: b.convo.state });
  } catch (error) {
    logError("bot: pergunta não reconhecida", error, { clinica: b.clinicId });
  }
}

/** Primeiro "não entendi" da mensagem: a base responde, assume ou não reconhece. */
async function run(b: Bot, session: Session): Promise<"answered" | "none" | KnowledgeTakeover> {
  const text = b.incomingText?.trim();
  // Sem letras (número de opção, data, emoji): não é pergunta.
  if (!text || !/\p{L}/u.test(text)) return "none";
  let data: KbClinicData;
  try {
    data = await dataOf(b, session);
  } catch (error) {
    logError("bot: dados da base de conhecimento", error, { clinica: b.clinicId });
    return "none";
  }
  const match = matchQuestion(session.kb, text, clinicTermsOf(data));
  if (match.kind === "none") {
    await logUnmatched(b, text);
    return "none";
  }
  if (match.kind === "clinical") return new KnowledgeTakeover({ kind: "clinical" } satisfies Takeover);
  if (match.kind === "ambiguous") return new KnowledgeTakeover({ kind: "ambiguous", options: match.options, message: text } satisfies Takeover);
  return deliver(b, session, data, match.entry, match.terms, text);
}

/** Resposta da entrada reconhecida (ou escolhida no "Você quis dizer…?"). */
async function deliver(b: Bot, session: Session, data: KbClinicData, entry: KbEntry, terms: DetectedTerms, text: string): Promise<"answered" | "none" | KnowledgeTakeover> {
  const answer = composeAnswer(session.kb, entry, terms, text, data, contextOf(b));
  if (!answer) return "none";
  return send(b, answer, entry, terms, data, text);
}

async function send(b: Bot, answer: KbAnswer, entry: KbEntry, terms: DetectedTerms, data: KbClinicData, text: string): Promise<"answered" | KnowledgeTakeover> {
  const kind = `bot_kb_${entry.code.toLowerCase()}`;
  switch (answer.kind) {
    case "flow":
      return new KnowledgeTakeover({ kind: "flow", flow: answer.flow, group: groupOf(terms, data, text), typed: typedCategory(terms, data, text) } satisfies Takeover);
    case "reception":
      return new KnowledgeTakeover({ kind: "reception", text: answer.text } satisfies Takeover);
    case "preparation": {
      if (answer.serviceIds.length > 1) return new KnowledgeTakeover({ kind: "preparation_list" } satisfies Takeover);
      const exam = data.catalog.services.find((s) => s.id === answer.serviceIds[0])!;
      if (exam.preparationFile) await sayPreparationFile(b, kind, exam.name, exam.preparationFile);
      else await say(b, kind, preparationMessageText(exam.name, exam.preparation!));
      return "answered";
    }
    case "text":
      // Fora de um fluxo, "Marcar" junto da resposta; dentro, só a resposta e o passo de novo.
      if (answer.book && !inFlow(b)) {
        return new KnowledgeTakeover({ kind: "book_offer", text: answer.text, category: answer.book.category, serviceId: answer.book.serviceId } satisfies Takeover);
      }
      await say(b, kind, answer.text);
      if (answer.offerReception) return new KnowledgeTakeover({ kind: "offer_reception" } satisfies Takeover);
      return "answered";
  }
}

async function askReception(b: Bot, kind: string, body: string): Promise<void> {
  await mergeContext(b, { [RECEPTION_CONFIRM_KEY]: true });
  await sendButtons(b, kind, body, t.RECEPTION_CONFIRM_BUTTONS);
}

async function leaveFlow(b: Bot): Promise<void> {
  if (inFlow(b) && b.convo.funnelSessionId) await logAbandonment(b.db, b.clinicId, b.convo, "back_to_menu", b.now);
}

/** A base assumiu a mensagem (o router chama ao pegar o KnowledgeTakeover). */
export async function performTakeover(b: Bot, action: unknown): Promise<void> {
  const takeover = action as Takeover;
  switch (takeover.kind) {
    case "flow": {
      await leaveFlow(b);
      const { flow, group, typed } = takeover;
      // Marcar pela base: o submenu, com marcar, retorno, remarcar, cancelar e encaixe (cliente, 31/out/2026).
      if (flow === "book_consultation") return showSubmenu(b, "CONSULTAS_MENU");
      if (flow === "book_exam") return showSubmenu(b, "EXAMES_MENU");
      if (flow === "book_return") return startReturn(b);
      if (flow === "reschedule" || flow === "cancel") return startManage(b, flow, group);
      // Encaixe (cliente, 31/out/2026): o "Encaixe ou antecipar"; sem o item Lista de espera, é com a recepção.
      if (flow === "waitlist") {
        // Sem o tipo na mensagem, pergunta consulta, retorno ou exame (cliente, 01/nov/2026).
        if (b.features.includes("waitlist")) return typed ? startManage(b, "waitlist", typed === "exam" ? "exam" : "consultation", typed) : askWaitlistType(b);
        return performTakeover(b, { kind: "reception", text: t.KB_WAITLIST_RECEPTION } satisfies Takeover);
      }
      return startIdentification(b);
    }
    case "reception":
      if (b.receptionAvailable) return askReception(b, "bot_kb_reception", takeover.text);
      await say(b, "bot_kb_will_reply", t.willReply(b.clinic.designation));
      return showMenu(b);
    case "offer_reception":
      return askReception(b, "bot_reception_confirm", t.RECEPTION_CONFIRM);
    case "clinical":
      await say(b, "bot_kb_clinical", CLINICAL_NOTICE);
      if (b.receptionAvailable) return askReception(b, "bot_reception_confirm", t.RECEPTION_CONFIRM);
      return showMenu(b);
    case "book_offer": {
      const id = `${BOOK_PREFIX}${takeover.category}${takeover.serviceId ? `_${takeover.serviceId}` : ""}`;
      return sendButtons(b, "bot_kb_book_offer", takeover.text, [t.button(id, t.KB_BOOK), t.button(BACK_TO_MENU_ID, "Voltar ao menu")]);
    }
    case "preparation_list":
      await leaveFlow(b);
      return showPreparationChoice(b);
    case "ambiguous": {
      await mergeContext(b, { [OPTIONS_KEY]: takeover.options.map((o) => o.code), [MESSAGE_KEY]: takeover.message });
      const rows = [
        ...takeover.options.map((o) => ({ id: `${PICK_PREFIX}${o.code}`, label: o.question })),
        { id: NONE_ID, label: t.KB_NONE_OF_THESE },
      ];
      return sendList(b, "bot_kb_did_you_mean", t.KB_DID_YOU_MEAN, t.numberedList(rows, false));
    }
  }
}

/**
 * Toques e respostas às mensagens da base, antes do passo: "Marcar" depois de
 * uma resposta, e a escolha do "Você quis dizer…?". "handled" = respondido;
 * "redispatch" = o passo segue com a mensagem (repetido, sem ou com o "não
 * entendi", conforme a escolha); "pass" = não era para a base.
 */
export async function handleKnowledgeReply(b: Bot, selection: Selection): Promise<"handled" | "redispatch" | "pass"> {
  if (selection.id?.startsWith(BOOK_PREFIX)) {
    const [category, serviceId] = selection.id.slice(BOOK_PREFIX.length).split("_");
    if (category === "return_visit") await startReturn(b);
    else await startBooking(b, category === "exam" ? "exam" : "consultation", { serviceId });
    return "handled";
  }
  const context = (b.convo.context ?? {}) as Record<string, unknown>;
  const codes = context[OPTIONS_KEY] as string[] | undefined;
  if (!codes?.length) return "pass";
  const message = String(context[MESSAGE_KEY] ?? "");
  await mergeContext(b, { [OPTIONS_KEY]: undefined, [MESSAGE_KEY]: undefined });
  const choices = [...codes.map((code) => `${PICK_PREFIX}${code}`), NONE_ID];
  const choice = pick(selection, choices, (id) => id);
  if (!choice) return "pass";
  const session = sessionOf(b);
  if (!session) return "pass";
  // A base já foi consultada: daqui, só o passo (sem "não entendi" se ela respondeu).
  b.knowledge!.done = true;
  if (choice === NONE_ID) return "redispatch";
  const entry = session.kb.entries.find((e) => e.entry.code === choice.slice(PICK_PREFIX.length))?.entry;
  if (!entry) return "redispatch";
  const data = await dataOf(b, session);
  const terms = matchQuestion(session.kb, message, clinicTermsOf(data)).terms;
  const outcome = await deliver(b, session, data, entry, terms, message);
  if (outcome instanceof KnowledgeTakeover) {
    await performTakeover(b, outcome.action);
    return "handled";
  }
  if (outcome === "answered") b.knowledge!.silent = true;
  return "redispatch";
}

/**
 * Pergunta da base na 1ª mensagem (cliente, 31/out/2026): depois das boas-vindas, a resposta e o menu. Só com
 * a entrada reconhecida com segurança; cortesia ("oi"), "Você quis dizer…?" e não reconhecida: como hoje.
 */
export async function firstMessageAnswer(b: Bot): Promise<(() => Promise<boolean>) | undefined> {
  const session = sessionOf(b);
  const text = b.incomingText?.trim();
  if (!session || !text) return undefined;
  let data: KbClinicData;
  try {
    data = await dataOf(b, session);
  } catch (error) {
    logError("bot: dados da base de conhecimento", error, { clinica: b.clinicId });
    return undefined;
  }
  const match = matchQuestion(session.kb, text, clinicTermsOf(data));
  b.knowledge!.done = true;
  if (match.kind === "clinical") {
    return async () => {
      await performTakeover(b, { kind: "clinical" } satisfies Takeover);
      return false;
    };
  }
  if (match.kind !== "answer" || match.entry.answerType === "fixed") return undefined;
  const answer = composeAnswer(session.kb, match.entry, match.terms, text, data);
  if (!answer) return undefined;
  return async () => {
    // Na 1ª mensagem o menu vem logo depois: a resposta sem o "Marcar".
    const outcome = await send(b, answer.kind === "text" ? { ...answer, book: undefined } : answer, match.entry, match.terms, data, text);
    if (outcome === "answered") return true;
    await performTakeover(b, outcome.action);
    return false;
  };
}

