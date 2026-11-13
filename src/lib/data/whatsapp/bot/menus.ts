import { preparationMessageText } from "../../../preparationMessage";
import type { BotService } from "./catalog";
import { contactFirstName, go, notUnderstood as countNotUnderstood, say, sayPreparationFile, sendList, textFor, type Bot } from "./engine";
import { renderWelcome } from "../customMessages";
import { sendPortalShortcut, type ShortcutPurpose } from "./portalLink";
import { pick, type Selection } from "./input";
import * as t from "./texts";
import { handoff } from "./manage";

type Item = { id: string; label: string; description?: string | null };

// Bot enxuto (F3f, BE-2, cliente, 11/nov/2026): o menu leva ao portal. Agendar · Minhas consultas · Profissionais ·
// Falar com a recepção (esta só com a recepção no app, coexistência; cliente, 07/out). Sem a especialidade e o
// profissional antes do menu, sem os submenus e sem Informações gerais.
function mainItems(b: Bot): Item[] {
  const exams = b.features.includes("exams");
  return t.LEAN_MENU.filter((item) => item.id !== "menu_reception" || b.receptionAvailable).map((item) => ({
    ...item,
    description: item.id === "menu_book" && !exams ? t.LEAN_BOOK_DESCRIPTION_NO_EXAM : item.description,
  }));
}

/** Corpo do 1º menu da conversa: as boas-vindas próprias da clínica ou as do bot enxuto, com o primeiro nome. */
async function leanWelcomeBody(b: Bot): Promise<string> {
  const custom = b.custom.get("welcome");
  const name = await contactFirstName(b);
  return custom ? renderWelcome(custom, b.clinic.label, name) : t.leanWelcome(name, { exams: b.features.includes("exams"), reception: b.receptionAvailable });
}

/**
 * Menu principal. O 1º da conversa (`withWelcome` ou `intro`) é uma mensagem só: o nome da clínica no cabeçalho, as
 * boas-vindas e a lista (BE-2); nas outras vezes, o corpo curto.
 */
export async function showMenu(b: Bot, { withWelcome = false, notUnderstood = false, intro = false } = {}): Promise<void> {
  // "Não entendi" e o menu numa mensagem só (cliente, 12/nov/2026): o texto do "não entendi" vira o corpo da lista.
  // Passa pela contagem do "não entendi"; null = a base de conhecimento já respondeu (o menu volta com o corpo normal).
  const misunderstood = notUnderstood ? await countNotUnderstood(b, textFor(b, "not_understood", t.notUnderstood(true))) : null;
  const first = withWelcome || intro;
  const body = misunderstood ?? (first ? await leanWelcomeBody(b) : textFor(b, "menu", b.features.includes("knowledge_base") ? t.MENU_BODY_ASK : t.MENU_BODY));
  // Sem o número na frente (título com até 24 caracteres, como no canvas); digitar o número continua valendo.
  const rows = mainItems(b).map((item) => ({ id: item.id, title: item.label, description: item.description ?? undefined }));
  await sendList(b, "bot_menu", body, [{ rows }], first && misunderstood === null ? t.leanMenuHeader(b.clinic.name) : undefined);
  await go(b, "MENU");
}

/**
 * Começo da conversa (bot enxuto, BE-2): o menu com as boas-vindas, numa mensagem; sem a pergunta "Identificamos um
 * agendamento…" e sem a data de nascimento (as consultas ficam em Minhas consultas, no portal). Pergunta da base na
 * 1ª mensagem (BE-7): a resposta e depois o menu; false = a base assumiu a conversa.
 */
export async function startConversation(b: Bot, { afterWelcome }: { afterWelcome?: () => Promise<boolean> } = {}): Promise<void> {
  if (afterWelcome && !(await afterWelcome())) return;
  return showMenu(b, { withWelcome: true });
}

/** "voltar" digitado: no bot enxuto, sempre o menu principal. */
export async function showPreviousMenu(b: Bot): Promise<void> {
  return showMenu(b);
}

/** Sem o portal (F3-5/F3-7): a recepção atende; sem a recepção no app, o aviso de que a clínica responde. */
async function portalClosed(b: Bot): Promise<void> {
  if (b.receptionAvailable) return handoff(b, "no_portal");
  await say(b, "bot_kb_will_reply", t.willReply(b.clinic.designation));
  await go(b, "WELCOME");
}

/** Agendar, Minhas consultas ou Profissionais (BE-3): o link do portal; fechado, a recepção. */
export async function portalShortcut(b: Bot, purpose: ShortcutPurpose, serviceId?: string): Promise<void> {
  if (!(await sendPortalShortcut(b, purpose, serviceId))) await portalClosed(b);
}

const SHORTCUT: Partial<Record<t.LeanMenuId, ShortcutPurpose>> = { menu_book: "book", menu_mine: "my_appointments", menu_professionals: "professionals" };

export async function handleMenu(b: Bot, selection: Selection): Promise<void> {
  const choice = pick(selection, mainItems(b), (i) => i.id);
  const purpose = choice ? SHORTCUT[choice.id as t.LeanMenuId] : undefined;
  if (purpose) return portalShortcut(b, purpose);
  // BE-4: a recepção numa mensagem, sem perguntar o motivo antes.
  if (choice?.id === "menu_reception") return handoff(b, "menu");
  await showMenu(b, { notUnderstood: true });
}

// ---------------------------------------------------------------------------
// Preparo de exame (pela base de conhecimento; Informações gerais saiu do menu, BE-2)
// ---------------------------------------------------------------------------

const preparationExams = (services: BotService[]) => services.filter((s) => s.category === "exam" && (s.preparation || s.preparationFile)).slice(0, t.MAX_LIST_ROWS - 1);

/** Lista dos exames com preparo (Informações e base de conhecimento). */
export async function showPreparationChoice(b: Bot): Promise<void> {
  const exams = preparationExams((await b.catalog()).services);
  await sendList(b, "bot_info_preparation_choice", t.PREPARATION_QUESTION, t.numberedList(exams.map((s) => ({ id: `prep_${s.id}`, label: s.name }))));
  await go(b, "INFO_PREP_SELECT");
}

export async function handlePreparationChoice(b: Bot, selection: Selection): Promise<void> {
  const exams = preparationExams((await b.catalog()).services);
  const exam = pick(selection, exams, (s) => `prep_${s.id}`);
  if (!exam) {
    await say(b, "bot_not_understood", textFor(b, "not_understood", t.notUnderstood()));
    await sendList(b, "bot_info_preparation_choice", t.PREPARATION_QUESTION, t.numberedList(exams.map((s) => ({ id: `prep_${s.id}`, label: s.name }))));
    return;
  }
  // Como na confirmação, sem o link (C7.5; cliente, 28/out/2026): o arquivo, ou as instruções.
  if (exam.preparationFile) await sayPreparationFile(b, "bot_info_preparation", exam.name, exam.preparationFile);
  else await say(b, "bot_info_preparation", preparationMessageText(exam.name, exam.preparation!));
  await showMenu(b);
}
