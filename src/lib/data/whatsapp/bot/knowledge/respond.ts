import { preparationMessageText } from "../../../../preparationMessage";
import type { KbFlow } from "../../../../knowledge/lists";
import { matchQuestion, type CompiledKb, type DetectedTerms, type KbEntry } from "../../../../knowledge/match";
import { publishedKnowledge } from "../../../knowledge/published";
import { logAbandonment, WELCOME, type HandoffOrigin } from "../../conversations";
import { logFunnelEvent } from "../../funnel";
import { BOOKING_STATES, startBooking, startReturn, type BookingContext } from "../booking";
import { applyProfessionalChoice, EXAMS_CHOICE, go, KnowledgeTakeover, mergeContext, RECEPTION_CONFIRM_KEY, say, sayPreparationFile, sendButtons, sendList, tick, type Bot, type KnowledgeHook } from "../engine";
import { startIdentification } from "../entry";
import { asksForReception, pick, withoutReceptionWords, yesNo, type Selection } from "../input";
import { askWaitlistType, handoff, startManage } from "../manage";
import { showMenu, showPreparationChoice, showSubmenu } from "../menus";
import * as t from "../texts";
import { CLINICAL_NOTICE, clinicTermsOf, composeAnswer, type KbAnswer, type KbClinicData, type KbContext } from "./answers";
import type { ServiceCategory } from "../../../config/services";
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

/**
 * Evolução do assistente (EA, cliente, 02/nov/2026). Resposta fora de um fluxo: "Resolvido" ou não, pendente no
 * contexto, e a dúvida vira tentativa no funil (flow "info": started → answered → resolved | escalated |
 * not_resolved). Pedido de recepção sem motivo: o motivo pendente no contexto.
 */
const CONFIRM_KEY = "_kb_confirm";
export const REASON_KEY = "_reception_reason";

/** De onde veio a dúvida respondida: o motivo de um pedido de recepção, a 1ª mensagem ou o menu. */
type ConfirmOrigin = "reception" | "first_message" | "menu";
type Book = { category: ServiceCategory; serviceId?: string };
type PendingConfirm = { sessionId: string; origin: ConfirmOrigin; handoffOrigin: HandoffOrigin; subject: string };
type PendingReason = { origin: HandoffOrigin };

/** Mensagem que é o motivo de um pedido de recepção (a resposta vem com "ainda quer falar com a recepção?"). */
const receptionAsks = new WeakMap<Bot, { origin: HandoffOrigin; subject: string }>();

type Takeover =
  | { kind: "flow"; flow: KbFlow; group: t.Group; typed?: "consultation" | "return_visit" | "exam" }
  | { kind: "reception"; text: string }
  | { kind: "offer_reception" }
  | { kind: "clinical" }
  | { kind: "confirm"; code: string; book?: Book; message: string }
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
  // No motivo de um pedido de recepção: a resposta e "Conseguiu resolver…?" (EA). Fora de um fluxo: a resposta e o
  // passo de novo (menu ou submenu), sem o "Isso resolve sua dúvida?" (cliente, 04/nov/2026).
  const confirm = async (book?: Book): Promise<"answered" | KnowledgeTakeover> => {
    if (receptionAsks.has(b)) return new KnowledgeTakeover({ kind: "confirm", code: entry.code, book, message: text } satisfies Takeover);
    await logAnsweredInfo(b, entry.code);
    return "answered";
  };
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
      return inFlow(b) ? "answered" : confirm();
    }
    case "text":
      await say(b, kind, answer.text);
      // Fora de um fluxo: a dúvida no funil e o menu de novo; no pedido de recepção, "Conseguiu resolver…?" com
      // "Marcar" quando a resposta leva a uma marcação. Cortesia ("obrigado"): só a resposta e o menu, como antes.
      if (!inFlow(b) && entry.answerType !== "fixed") return confirm(answer.book);
      // Dentro: só a resposta e o passo de novo.
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

// ---------------------------------------------------------------------------
// Dúvida respondida: "Resolvido?" e o funil (EA)
// ---------------------------------------------------------------------------

async function logInfo(b: Bot, sessionId: string, step: string, metadata: Record<string, unknown> = {}): Promise<void> {
  await logFunnelEvent(b.db, b.clinicId, { sessionId, flow: "info", step, phone: b.phone, contactId: b.convo.contactId, metadata }, tick(b));
}

const bookId = (book: Book) => `${BOOK_PREFIX}${book.category}${book.serviceId ? `_${book.serviceId}` : ""}`;
/** "Agendar Atendimento" sem serviço: pergunta o tipo. */
const BOOK_ANY_ID = `${BOOK_PREFIX}any`;
const BOOK_ID = /^kb_book_(consultation|return_visit|exam|any)(?:_(.+))?$/;
const BOOK_TYPES = ["consultation", "return_visit", "exam"] as const;

/** Tipos que a clínica marca pelo bot (serviço ativo no catálogo). */
async function bookTypes(b: Bot): Promise<(typeof BOOK_TYPES)[number][]> {
  const services = (await b.catalog()).services;
  return BOOK_TYPES.filter((category) => services.some((s) => s.category === category));
}

async function startBookingOf(b: Bot, category: (typeof BOOK_TYPES)[number], serviceId?: string): Promise<void> {
  if (category === "return_visit") return startReturn(b);
  return startBooking(b, category, { serviceId });
}

/** "Agendar Atendimento": um tipo só vai direto; mais de um, Consulta · Retorno · Exame (só os que a clínica tem). */
async function askBookType(b: Bot): Promise<void> {
  const types = await bookTypes(b);
  if (types.length === 1) return startBookingOf(b, types[0]);
  if (!types.length) return showMenu(b);
  await sendButtons(b, "bot_kb_book_type", t.KB_BOOK_TYPE_QUESTION, types.map((category) => t.button(bookId({ category }), t.KB_BOOK_TYPE_LABELS[category])));
}

/** Botões do "Conseguiu resolver…?" (pedido de recepção): Resolvido, a recepção e "Marcar" quando a resposta leva a uma marcação. */
async function confirmButtons(b: Bot, book: Book | undefined) {
  const resolved = t.button(t.KB_CONFIRM_IDS.resolved, t.KB_RESOLVED_LABEL);
  const reception = b.receptionAvailable ? [t.button(t.KB_CONFIRM_IDS.reception, t.KB_RECEPTION_LABEL)] : [];
  // Serviço citado na resposta: abre ele; senão, "Agendar Atendimento" pergunta o tipo (cliente, 02/nov/2026).
  const marcar = book ? [t.button(bookId(book), t.KB_BOOK)] : (await bookTypes(b)).length ? [t.button(BOOK_ANY_ID, t.KB_BOOK)] : [];
  return [resolved, ...reception, ...marcar];
}

/**
 * Dúvida respondida fora de um fluxo, sem pergunta de confirmação (cliente, 04/nov/2026): a tentativa no funil
 * marcada `implicit`. Nas Métricas, conta como resolvida se o paciente não pedir a recepção nos 30 minutos seguintes.
 */
async function logAnsweredInfo(b: Bot, code: string): Promise<void> {
  const origin: ConfirmOrigin = b.convo.state === WELCOME ? "first_message" : "menu";
  const sessionId = crypto.randomUUID();
  await logInfo(b, sessionId, "started", { code, origin, implicit: true });
  await logInfo(b, sessionId, "answered");
}

async function askConfirmation(b: Bot, takeover: Extract<Takeover, { kind: "confirm" }>): Promise<void> {
  const ask = receptionAsks.get(b)!;
  const sessionId = crypto.randomUUID();
  await logInfo(b, sessionId, "started", { code: takeover.code, origin: "reception" });
  await logInfo(b, sessionId, "answered");
  // Respondida na 1ª mensagem: a conversa sai do começo (a próxima mensagem não recebe as boas-vindas de novo).
  if (b.convo.state === WELCOME) await go(b, "MENU");
  const pending: PendingConfirm = { sessionId, origin: "reception", handoffOrigin: ask.origin, subject: ask.subject };
  await mergeContext(b, { [CONFIRM_KEY]: pending });
  await sendButtons(b, "bot_kb_confirm", t.KB_CONFIRM_AFTER_RECEPTION, await confirmButtons(b, takeover.book));
}

const RESOLVED_WORDS = /^(?:sim\b|s\b|resolvid[oa]|resolveu|resolve|ajudou|obrigad[oa]|obg|valeu|vlw|ok\b|okay|certo|perfeito|otimo|entendi|beleza|blz)/;

/** Resposta ao "Resolvido?" digitada: true = resolveu; false = não; null = outra coisa (segue o passo). */
function typedConfirm(selection: Selection): boolean | null {
  if (selection.id) return null;
  const text = selection.text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (/^(?:nao|n)\b/.test(text)) return false;
  if (RESOLVED_WORDS.test(text) && text.length <= 40) return true;
  return yesNo(selection);
}

/** Toque ou resposta ao "Resolvido?". "pass" = outra mensagem (a dúvida fica sem confirmação: inconclusiva). */
async function handleConfirmReply(b: Bot, pending: PendingConfirm, selection: Selection): Promise<"handled" | "pass"> {
  await mergeContext(b, { [CONFIRM_KEY]: undefined });
  const escalate = async () => {
    await logInfo(b, pending.sessionId, "escalated");
    if (!b.receptionAvailable) {
      await say(b, "bot_kb_will_reply", t.willReply(b.clinic.designation));
      return showMenu(b);
    }
    return handoff(b, pending.handoffOrigin, { subject: pending.subject, infoSessionId: pending.sessionId });
  };
  if (selection.id === t.KB_CONFIRM_IDS.resolved) {
    await logInfo(b, pending.sessionId, "resolved");
    await say(b, "bot_kb_resolved", t.KB_RESOLVED_THANKS);
    await go(b, WELCOME);
    return "handled";
  }
  if (selection.id === t.KB_CONFIRM_IDS.reception) {
    await escalate();
    return "handled";
  }
  if (selection.id === t.KB_CONFIRM_IDS.menu) {
    await showMenu(b);
    return "handled";
  }
  // "Marcar" depois da resposta: a dúvida foi resolvida e a marcação segue pelo fluxo (que conta à parte).
  if (selection.id?.startsWith(BOOK_PREFIX)) {
    await logInfo(b, pending.sessionId, "resolved", { via: "book" });
    return "pass";
  }
  // Pediu a recepção de novo: transfere direto (nunca uma barreira).
  if (b.receptionAvailable && asksForReception(selection)) {
    await escalate();
    return "handled";
  }
  const answer = typedConfirm(selection);
  if (answer === true) {
    await logInfo(b, pending.sessionId, "resolved", { typed: true });
    await say(b, "bot_kb_resolved", t.KB_RESOLVED_THANKS);
    await go(b, WELCOME);
    return "handled";
  }
  if (answer === false) {
    // Veio de um pedido de recepção: transfere. Fora dele, o menu (que tem "Falar com a recepção").
    if (pending.origin === "reception") {
      await escalate();
      return "handled";
    }
    await logInfo(b, pending.sessionId, "not_resolved");
    await showMenu(b);
    return "handled";
  }
  return "pass";
}

// ---------------------------------------------------------------------------
// Pedido de recepção: o motivo antes de transferir (EA)
// ---------------------------------------------------------------------------

/**
 * Pedido de recepção: a opção do menu transfere direto, sem perguntar o motivo (cliente, 06/nov/2026). Digitado
 * ("secretária", "atendente"): pergunta antes "Você quer falar com a recepção?" com Sim · Não (cliente, 06/nov/2026;
 * o Sim transfere pelo router). Motivo na mesma mensagem ("atendente, quanto custa a consulta?"): vai direto para a base.
 */
export async function askReceptionReason(b: Bot, origin: HandoffOrigin, text: string | null = null): Promise<void> {
  if (text && (await reasonInMessage(b, text))) return handleReceptionReason(b, text, origin);
  if (origin === "typed") return askReception(b, "bot_reception_confirm", t.RECEPTION_CONFIRM);
  await handoff(b, origin);
}

/** O pedido digitado já diz o que a pessoa precisa (e a base sabe responder ou abrir o fluxo). */
async function reasonInMessage(b: Bot, text: string): Promise<boolean> {
  const session = sessionOf(b);
  const rest = withoutReceptionWords(text);
  if (!session || !/\p{L}{3,}/u.test(rest)) return false;
  try {
    const match = matchQuestion(session.kb, rest, clinicTermsOf(await dataOf(b, session)));
    return match.kind === "answer" && match.entry.answerType !== "fixed" && match.entry.answerType !== "reception";
  } catch (error) {
    logError("bot: motivo do pedido de recepção", error, { clinica: b.clinicId });
    return false;
  }
}

export const pendingReasonOf = (b: Bot) => ((b.convo.context ?? {}) as Record<string, unknown>)[REASON_KEY] as PendingReason | undefined;

/**
 * O motivo contado (EA, cliente, 02/nov/2026). A: a base responde (ou abre o fluxo) e pergunta se resolveu.
 * B: sem resposta segura, transfere dizendo isso. C: entrada do tipo "recepção" (reclamação, reembolso…), cortesia
 * ou pergunta clínica: transfere. Transferido, o motivo vira o assunto (não é perguntado de novo).
 */
export async function handleReceptionReason(b: Bot, text: string, origin: HandoffOrigin): Promise<void> {
  const transfer = (lead?: string) => handoff(b, origin, { subject: text, lead });
  const session = sessionOf(b);
  if (!session) return transfer();
  let data: KbClinicData;
  try {
    data = await dataOf(b, session);
  } catch (error) {
    logError("bot: dados da base de conhecimento", error, { clinica: b.clinicId });
    return transfer();
  }
  b.knowledge!.done = true;
  const match = matchQuestion(session.kb, withoutReceptionWords(text) || text, clinicTermsOf(data));
  if (match.kind === "clinical") {
    await say(b, "bot_kb_clinical", CLINICAL_NOTICE);
    return transfer();
  }
  if (match.kind === "none") {
    await logUnmatched(b, text);
    return transfer(t.KB_NO_SAFE_ANSWER);
  }
  // Empate: não adivinha.
  if (match.kind === "ambiguous") return transfer(t.KB_NO_SAFE_ANSWER);
  if (match.entry.answerType === "fixed" || match.entry.answerType === "reception") return transfer();
  const answer = composeAnswer(session.kb, match.entry, match.terms, text, data);
  if (!answer || answer.kind === "reception") return transfer(answer ? undefined : t.KB_NO_SAFE_ANSWER);
  // No meio de um fluxo: a tentativa para aqui (pediu a recepção) e a conversa volta ao começo.
  if (inFlow(b)) {
    if (b.convo.funnelSessionId) await logAbandonment(b.db, b.clinicId, b.convo, "reception_requested", b.now);
    await go(b, WELCOME);
  }
  receptionAsks.set(b, { origin, subject: text });
  const outcome = await send(b, answer, match.entry, match.terms, data, text);
  if (outcome instanceof KnowledgeTakeover) await performTakeover(b, outcome.action);
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
      if (flow === "book_exam") {
        // Exame só na agenda de Exames (cliente, 08/nov/2026): com um profissional escolhido, passa para "Exames".
        if (b.scope.multi && b.scope.choice && b.scope.choice !== EXAMS_CHOICE && b.scope.examsOption) await applyProfessionalChoice(b, EXAMS_CHOICE);
        return showSubmenu(b, "EXAMES_MENU");
      }
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
    case "confirm":
      return askConfirmation(b, takeover);
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
  const pending = ((b.convo.context ?? {}) as Record<string, unknown>)[CONFIRM_KEY] as PendingConfirm | undefined;
  if (pending && (await handleConfirmReply(b, pending, selection)) === "handled") return "handled";
  const book = selection.id?.match(BOOK_ID);
  if (book) {
    // "return_visit" tem "_": o id é lido inteiro (antes, o retorno abria a consulta).
    const [, category, serviceId] = book;
    if (category === "any") await askBookType(b);
    else await startBookingOf(b, category as (typeof BOOK_TYPES)[number], serviceId);
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
    // Resposta de texto: a resposta e o menu (cliente, 04/nov/2026); fluxo: abre o fluxo.
    const outcome = await send(b, answer, match.entry, match.terms, data, text);
    if (outcome === "answered") return true;
    await performTakeover(b, outcome.action);
    return false;
  };
}

