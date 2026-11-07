import { applyProfessionalChoice, EXAMS_CHOICE, go, say, sendList, textFor, welcomeText, type Bot } from "./engine";
import { pick, type Selection } from "./input";
import { NO_SPECIALTY, professionalsOf, specialtyOptions, type ScopeProfessional } from "./professionalScope";
import * as t from "./texts";
import { showMenu, showSubmenu } from "./menus";

// Especialidade → profissional antes do menu (MB, cliente, 07/nov/2026): só na
// clínica com mais de um profissional. Com um profissional na especialidade, só
// o nome dele; "Exames" (agenda sem profissional, M8) vai direto aos exames.
// Mais opções do que cabem na lista: "Mais opções" mostra as seguintes.

export const CHOOSE_STATES = new Set(["PICK_SPECIALTY", "PICK_PROFESSIONAL"]);

type ChooseContext = { page?: number; specialtyId?: string };

const SPECIALTY_ROW = (id: string) => `specialty_${id}`;
const PROFESSIONAL_ROW = (id: string) => `professional_${id}`;
const MORE_ID = "choose_more";
const OTHER_SPECIALTY_ID = "choose_other_specialty";
/** Linhas por página: a lista tem 10, e a última vai para "Voltar ao menu" ou "Mais opções". */
const PAGE = t.MAX_LIST_ROWS - 1;

type Row = { id: string; label: string; description?: string | null };

const plain = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/** O número ou o toque; senão, o nome escrito ("cardiologia", "dra ana"). */
function pickRow(selection: Selection, rows: Row[]): Row | null {
  const picked = pick(selection, rows, (r) => r.id);
  if (picked || selection.id) return picked;
  const text = plain(selection.text);
  if (text.length < 3) return null;
  const hits = rows.filter((r) => r.id !== MORE_ID && plain(r.label).includes(text));
  return hits.length === 1 ? hits[0] : null;
}

/** A página pedida (volta ao começo depois da última), com "Mais opções" quando não cabe tudo. */
function paged(rows: Row[], page: number): { rows: Row[]; page: number } {
  if (rows.length <= t.MAX_LIST_ROWS) return { rows, page: 0 };
  const size = PAGE;
  const pages = Math.ceil(rows.length / size);
  const current = ((page % pages) + pages) % pages;
  return { rows: [...rows.slice(current * size, current * size + size), { id: MORE_ID, label: t.MORE_OPTIONS_LABEL }], page: current };
}

const specialtyRows = (b: Bot): Row[] => [
  ...specialtyOptions(b.scope, t.SPECIALTY_OTHERS_LABEL).map((s) => ({ id: SPECIALTY_ROW(s.id), label: s.name })),
  ...(b.scope.examsOption ? [{ id: SPECIALTY_ROW(EXAMS_CHOICE), label: t.SPECIALTY_EXAMS_LABEL, description: t.SPECIALTY_EXAMS_DESCRIPTION }] : []),
];

/** A pergunta da especialidade (com as boas-vindas, no começo da conversa). Uma só opção: segue sem perguntar. */
export async function askSpecialty(b: Bot, { withWelcome = false, notUnderstood = false, page = 0 } = {}): Promise<void> {
  if (withWelcome) await say(b, "bot_welcome", welcomeText(b));
  const all = specialtyRows(b);
  if (all.length === 1) return chooseSpecialty(b, all[0].id.slice("specialty_".length));
  if (notUnderstood) await say(b, "bot_not_understood", textFor(b, "not_understood", t.notUnderstood()));
  const view = paged(all, page);
  await sendList(b, "bot_specialty_choice", t.SPECIALTY_QUESTION, t.numberedList(view.rows, false));
  await go(b, "PICK_SPECIALTY", { page: view.page } satisfies ChooseContext);
}

async function chooseSpecialty(b: Bot, specialtyId: string): Promise<void> {
  if (specialtyId === EXAMS_CHOICE) {
    await applyProfessionalChoice(b, EXAMS_CHOICE);
    await say(b, "bot_exams_chosen", t.EXAMS_CHOSEN);
    // Direto ao submenu de exames (M8).
    return showSubmenu(b, "EXAMES_MENU");
  }
  return askProfessional(b, specialtyId);
}

const professionalRows = (b: Bot, list: ScopeProfessional[], specialtyId: string): Row[] => {
  const name = specialtyOptions(b.scope, t.SPECIALTY_OTHERS_LABEL).find((s) => s.id === specialtyId)?.name ?? null;
  return list.map((p) => ({
    id: PROFESSIONAL_ROW(p.id),
    label: p.name,
    // As outras especialidades dele, se houver.
    description: p.specialties.filter((s) => s.name !== name).map((s) => s.name).join(", ") || null,
  }));
};

export async function askProfessional(b: Bot, specialtyId: string, { notUnderstood = false, page = 0 } = {}): Promise<void> {
  const list = professionalsOf(b.scope, specialtyId);
  if (!list.length) return askSpecialty(b, { notUnderstood: true });
  if (list.length === 1) return chooseProfessional(b, list[0], specialtyId);
  if (notUnderstood) await say(b, "bot_not_understood", textFor(b, "not_understood", t.notUnderstood()));
  const others = specialtyRows(b).length > 1 ? [{ id: OTHER_SPECIALTY_ID, label: t.OTHER_SPECIALTY_LABEL }] : [];
  const view = paged([...professionalRows(b, list, specialtyId), ...others], page);
  await sendList(b, "bot_professional_choice", t.PROFESSIONAL_QUESTION, t.numberedList(view.rows, false));
  await go(b, "PICK_PROFESSIONAL", { specialtyId, page: view.page } satisfies ChooseContext);
}

async function chooseProfessional(b: Bot, professional: ScopeProfessional, specialtyId: string): Promise<void> {
  await applyProfessionalChoice(b, professional.id);
  const specialty = specialtyId === NO_SPECIALTY ? null : (professional.specialties.find((s) => s.id === specialtyId)?.name ?? null);
  await say(b, "bot_professional_chosen", t.professionalChosen(professional.name, specialty));
  return showMenu(b, { intro: true });
}

export async function handleChooseState(b: Bot, state: string, selection: Selection): Promise<void> {
  const ctx = (b.convo.context ?? {}) as ChooseContext;
  if (state === "PICK_SPECIALTY") {
    const all = specialtyRows(b);
    const view = paged(all, ctx.page ?? 0);
    // O nome escrito vale mesmo fora da página mostrada.
    const choice = pickRow(selection, view.rows) ?? (selection.id ? null : pickRow(selection, all));
    if (!choice) return askSpecialty(b, { notUnderstood: true, page: view.page });
    if (choice.id === MORE_ID) return askSpecialty(b, { page: view.page + 1 });
    return chooseSpecialty(b, choice.id.slice("specialty_".length));
  }
  const specialtyId = ctx.specialtyId ?? NO_SPECIALTY;
  const list = professionalsOf(b.scope, specialtyId);
  const others = specialtyRows(b).length > 1 ? [{ id: OTHER_SPECIALTY_ID, label: t.OTHER_SPECIALTY_LABEL }] : [];
  const rows = [...professionalRows(b, list, specialtyId), ...others];
  const view = paged(rows, ctx.page ?? 0);
  const choice = pickRow(selection, view.rows) ?? (selection.id ? null : pickRow(selection, rows));
  if (!choice) return askProfessional(b, specialtyId, { notUnderstood: true, page: view.page });
  if (choice.id === MORE_ID) return askProfessional(b, specialtyId, { page: view.page + 1 });
  if (choice.id === OTHER_SPECIALTY_ID) return askSpecialty(b);
  const professional = list.find((p) => PROFESSIONAL_ROW(p.id) === choice.id);
  if (!professional) return askProfessional(b, specialtyId, { notUnderstood: true });
  return chooseProfessional(b, professional, specialtyId);
}
