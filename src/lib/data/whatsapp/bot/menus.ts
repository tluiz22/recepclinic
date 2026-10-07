import { servicesOf, type BotService } from "./catalog";
import { go, say, sendList, type Bot } from "./engine";
import { pick, type Selection } from "./input";
import * as t from "./texts";
import { startBooking, startReturn } from "./booking";
import { handoff, startManage } from "./manage";

// Menus do bot, na estrutura do piloto: Consultas › Marcar consulta / Marcar
// retorno / Remarcar / Cancelar / Encaixe ou antecipar; Exames › Marcar exame
// / Remarcar / Cancelar / Encaixe ou antecipar (F6.4; o Encaixe só com o item
// "Lista de espera"); Informações (itens com conteúdo); Falar com a recepção
// só com o número em coexistência (cliente, 07/out).

type Item = { id: string; label: string; description?: string | null };

async function mainItems(b: Bot): Promise<Item[]> {
  const catalog = await b.catalog();
  const items: Item[] = [];
  if (servicesOf(catalog, "consultation").length || servicesOf(catalog, "return_visit").length) items.push({ id: "menu_consultations", label: "Consultas" });
  if (servicesOf(catalog, "exam").length) items.push({ id: "menu_exams", label: "Exames" });
  if ((await infoItems(b)).length) items.push({ id: "menu_info", label: "Informações" });
  if (b.receptionAvailable) items.push({ id: "menu_reception", label: "Falar com a recepção" });
  return items;
}

async function consultationItems(b: Bot): Promise<Item[]> {
  const catalog = await b.catalog();
  return [
    ...(servicesOf(catalog, "consultation").length ? [{ id: "book_consultation", label: "Marcar consulta" }] : []),
    ...(servicesOf(catalog, "return_visit").length ? [{ id: "book_return", label: "Marcar retorno" }] : []),
    ...manageItems(b),
  ];
}

const manageItems = (b: Bot): Item[] => [
  { id: "manage_reschedule", label: "Remarcar" },
  { id: "manage_cancel", label: "Cancelar" },
  ...(b.features.includes("waitlist") ? [{ id: "manage_waitlist", label: "Encaixe ou antecipar", description: "Lista de espera para um horário mais cedo" }] : []),
];

const examItems = (b: Bot): Item[] => [{ id: "book_exam", label: "Marcar exame" }, ...manageItems(b)];

/** Menu principal; clínica sem nada para mostrar recebe o aviso e a conversa fica no começo. */
export async function showMenu(b: Bot, { withWelcome = false, notUnderstood = false } = {}): Promise<void> {
  if (withWelcome) await say(b, "bot_welcome", t.welcome(b.clinic.label));
  const items = await mainItems(b);
  if (!items.length) {
    await say(b, "bot_nothing_to_book", t.NOTHING_TO_BOOK);
    await go(b, "WELCOME");
    return;
  }
  if (notUnderstood) await say(b, "bot_not_understood", t.notUnderstood(true));
  await sendList(b, "bot_menu", t.MENU_BODY, t.numberedList(items, false));
  await go(b, "MENU");
}

export async function handleMenu(b: Bot, selection: Selection): Promise<void> {
  const choice = pick(selection, await mainItems(b), (i) => i.id);
  if (choice?.id === "menu_consultations") return showSubmenu(b, "CONSULTAS_MENU");
  if (choice?.id === "menu_exams") return showSubmenu(b, "EXAMES_MENU");
  if (choice?.id === "menu_info") return showInfo(b);
  if (choice?.id === "menu_reception") return handoff(b);
  await showMenu(b, { notUnderstood: true });
}

async function showSubmenu(b: Bot, state: "CONSULTAS_MENU" | "EXAMES_MENU", notUnderstood = false): Promise<void> {
  if (notUnderstood) await say(b, "bot_not_understood", t.notUnderstood());
  const consultations = state === "CONSULTAS_MENU";
  await sendList(
    b,
    consultations ? "bot_consultations_menu" : "bot_exams_menu",
    consultations ? t.CONSULTATIONS_BODY : t.EXAMS_BODY,
    t.numberedList(consultations ? await consultationItems(b) : examItems(b)),
  );
  await go(b, state);
}

export async function handleSubmenu(b: Bot, state: "CONSULTAS_MENU" | "EXAMES_MENU", selection: Selection): Promise<void> {
  const items = state === "CONSULTAS_MENU" ? await consultationItems(b) : examItems(b);
  const group = state === "CONSULTAS_MENU" ? "consultation" : "exam";
  const choice = pick(selection, items, (i) => i.id);
  if (choice?.id === "book_consultation") return startBooking(b, "consultation");
  if (choice?.id === "book_return") return startReturn(b);
  if (choice?.id === "book_exam") return startBooking(b, "exam");
  if (choice?.id === "manage_reschedule") return startManage(b, "reschedule", group);
  if (choice?.id === "manage_cancel") return startManage(b, "cancel", group);
  if (choice?.id === "manage_waitlist") return startManage(b, "waitlist", group);
  await showSubmenu(b, state, true);
}

// ---------------------------------------------------------------------------
// Informações
// ---------------------------------------------------------------------------

type InfoKey = keyof typeof t.INFO_ITEMS;

async function infoItems(b: Bot): Promise<InfoKey[]> {
  const catalog = await b.catalog();
  const keys: InfoKey[] = [];
  if (catalog.services.length) keys.push("prices");
  if (b.clinic.insuranceInfo) keys.push("insurance");
  if (addressLocations(b, catalog.locations).length) keys.push("address");
  if (preparationExams(catalog.services).length) keys.push("preparation");
  if (b.clinic.notes) keys.push("notes");
  return keys;
}

const addressLocations = (_b: Bot, locations: { name: string; type: string; address: string | null }[]) =>
  locations.filter((l): l is typeof l & { address: string } => l.type === "clinic" && !!l.address);

const preparationExams = (services: BotService[]) => services.filter((s) => s.category === "exam" && s.preparation).slice(0, t.MAX_LIST_ROWS - 1);

async function showInfo(b: Bot, notUnderstood = false): Promise<void> {
  if (notUnderstood) await say(b, "bot_not_understood", t.notUnderstood());
  const items = (await infoItems(b)).map((key) => ({ id: `info_${key}`, label: t.INFO_ITEMS[key] }));
  await sendList(b, "bot_info_menu", t.INFO_BODY, t.numberedList(items));
  await go(b, "INFO_MENU");
}

function priceLines(service: BotService): string[] {
  const types = Object.keys(service.locationPrices) as (keyof typeof t.LOCATION_LABELS)[];
  const value = (cents: number) => (cents === 0 ? "Sem custo" : t.price(cents)!);
  if (types.length <= 1) return [value(types.length ? service.locationPrices[types[0]]! : service.priceCents)];
  return types.map((type) => `${t.LOCATION_LABELS[type]}: ${value(service.locationPrices[type]!)}`);
}

export async function handleInfo(b: Bot, selection: Selection): Promise<void> {
  const catalog = await b.catalog();
  const keys = await infoItems(b);
  const choice = pick(selection, keys, (key) => `info_${key}`);
  switch (choice) {
    case "prices":
      await say(b, "bot_info_prices", t.pricesText(catalog.services.map((s) => ({ name: s.name, lines: priceLines(s) })), b.clinic.paymentInfo));
      break;
    case "insurance":
      await say(b, "bot_info_insurance", b.clinic.insuranceInfo!);
      break;
    case "address":
      await say(b, "bot_info_address", t.addressText(addressLocations(b, catalog.locations)));
      break;
    case "notes":
      await say(b, "bot_info_notes", b.clinic.notes!);
      break;
    case "preparation": {
      const exams = preparationExams(catalog.services);
      await sendList(b, "bot_info_preparation_choice", t.PREPARATION_QUESTION, t.numberedList(exams.map((s) => ({ id: `prep_${s.id}`, label: s.name }))));
      await go(b, "INFO_PREP_SELECT");
      return;
    }
    default:
      return showInfo(b, true);
  }
  await showInfo(b);
}

export async function handlePreparationChoice(b: Bot, selection: Selection): Promise<void> {
  const exams = preparationExams((await b.catalog()).services);
  const exam = pick(selection, exams, (s) => `prep_${s.id}`);
  if (!exam) {
    await say(b, "bot_not_understood", t.notUnderstood());
    await sendList(b, "bot_info_preparation_choice", t.PREPARATION_QUESTION, t.numberedList(exams.map((s) => ({ id: `prep_${s.id}`, label: s.name }))));
    return;
  }
  await say(b, "bot_info_preparation", t.preparationText(exam.preparation!, `${b.sender.baseUrl}/preparo/${exam.id}`));
  await showInfo(b);
}
