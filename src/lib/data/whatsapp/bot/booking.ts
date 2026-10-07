import { isAdult, isOverConsultationAgeLimit } from "../../../age";
import { evaluateReturnEligibility, findBlockingAppointment, findReturnOrigin, listUpcomingAppointments, type ReturnEligibility } from "../../agenda/appointments";
import { BOT_LINK_TTL_MS, createBookingLink } from "../../agenda/links";
import type { LocationType } from "../../config/locations";
import { DataError, unwrap } from "../../errors";
import { getContact, listContactPatients, registerPatient, type ContactChoice, type Patient } from "../../patients";
import { startFunnel } from "../conversations";
import { formatAppointmentWhen } from "../templates";
import { servicesOf, type BotService } from "./catalog";
import { attachContact, end, go, say, sendButtons, sendList, step, type Bot } from "./engine";
import { formatBirthdate, parseBirthdate, pick, yesNo, type Selection } from "./input";
import { showMenu } from "./menus";
import * as t from "./texts";

// Marcar pelo bot (F6.3), com as regras do piloto (Fases 3b, 6, 16, 17, 21)
// no modelo novo: serviço → "com quem?" (D2) → local → endereço do
// domiciliar → para quem → identificação do paciente → link de /agendar.
// A data e o horário são escolhidos na página (F5.2). Retorno: só quem tem
// direito, com o profissional da consulta de origem; sem trava de idade
// (cliente, 07/out).

type Category = "consultation" | "exam" | "return_visit";

type Awaiting =
  | "address_default"
  | "address_input"
  | "address_new"
  | "patient_choice"
  | "birthdate_search"
  | "confirm_patient"
  | "contact_name"
  | "contact_confirm"
  | "patient_name"
  | "patient_birthdate"
  | "new_confirm"
  | "self_birthdate"
  | "self_name"
  | "self_confirm";

type Candidate = { id: string; name: string; birthdate?: string };
type ReturnCandidate = Candidate & { originId: string; agendaId: string; serviceId: string };

export type BookingContext = {
  category: Category;
  serviceId?: string;
  serviceName?: string;
  /** null = "Primeiro horário disponível" entre as agendas do serviço. */
  agendaId?: string | null;
  locationCategory?: LocationType | null;
  homeAddress?: string;
  /** Endereço novo: vira o padrão do contato. */
  saveAddress?: boolean;
  pendingAddress?: string;
  awaiting?: Awaiting;
  candidates?: Candidate[];
  pending?: Candidate & { birthdate: string };
  knownBirthdate?: string;
  duplicateCheck?: boolean;
  contactName?: string;
  newName?: string;
  newBirthdate?: string;
  selfBirthdate?: string;
  selfName?: string;
  selfAskName?: boolean;
  originAppointmentId?: string;
  returnCandidates?: ReturnCandidate[];
};

/** Estados dos fluxos de marcar (cada um vira passo do funil). */
export const BOOKING_STATES = new Set([
  "BOOK_SERVICE",
  "BOOK_AGENDA",
  "BOOK_LOCATION",
  "BOOK_HOME_ADDRESS",
  "BOOK_FOR_WHOM",
  "BOOK_PATIENT_SELECT",
  "BOOK_PATIENT_NEW",
  "BOOK_AGE_LIMIT",
  "RETURN_SELECT",
]);

const ctxOf = (b: Bot) => b.convo.context as BookingContext;

async function serviceOf(b: Bot, ctx: BookingContext): Promise<BotService | null> {
  return (await b.catalog()).services.find((s) => s.id === ctx.serviceId) ?? null;
}

async function open(b: Bot, flow: "booking" | "exam" | "return_booking"): Promise<void> {
  b.now = new Date(b.now.getTime() + 1);
  const sessionId = await startFunnel(b.db, b.clinicId, b.phone, flow, {}, b.now);
  b.convo = { ...b.convo, funnelSessionId: sessionId, funnelFlow: flow };
}

/** Dados do caminho já escolhido (serviço, agenda, local), sem o que é da identificação. */
const keepPath = (ctx: BookingContext): BookingContext => ({
  category: ctx.category,
  serviceId: ctx.serviceId,
  serviceName: ctx.serviceName,
  agendaId: ctx.agendaId,
  locationCategory: ctx.locationCategory,
  homeAddress: ctx.homeAddress,
  saveAddress: ctx.saveAddress,
  contactName: ctx.contactName,
  originAppointmentId: ctx.originAppointmentId,
});

// ---------------------------------------------------------------------------
// Serviço, profissional e local
// ---------------------------------------------------------------------------

export async function startBooking(b: Bot, category: "consultation" | "exam"): Promise<void> {
  await open(b, category === "exam" ? "exam" : "booking");
  const services = servicesOf(await b.catalog(), category);
  if (!services.length) {
    await say(b, "bot_nothing_to_book", t.NOTHING_TO_BOOK);
    return end(b, "blocked", { reason: "no_service" });
  }
  // Sempre mostra a lista, mesmo com um serviço só: o paciente vê e confirma o que está marcando (cliente, 07/out).
  await askService(b, { category }, services);
}

const minPrice = (s: BotService) => {
  const values = Object.values(s.locationPrices);
  return values.length ? Math.min(...values) : s.priceCents;
};

async function askService(b: Bot, ctx: BookingContext, services: BotService[]): Promise<void> {
  await sendList(
    b,
    "bot_book_service",
    t.serviceQuestion(ctx.category === "exam" ? "exam" : "consultation"),
    t.numberedList(services.map((s) => ({ id: `service_${s.id}`, label: s.name, description: t.price(minPrice(s)) }))),
  );
  await go(b, "BOOK_SERVICE", ctx);
}

async function handleService(b: Bot, selection: Selection): Promise<void> {
  const ctx = ctxOf(b);
  const services = servicesOf(await b.catalog(), ctx.category);
  const service = pick(selection, services, (s) => `service_${s.id}`);
  if (!service) {
    await say(b, "bot_not_understood", t.notUnderstood());
    return askService(b, ctx, services);
  }
  await chooseService(b, ctx, service);
}

async function chooseService(b: Bot, ctx: BookingContext, service: BotService): Promise<void> {
  const next: BookingContext = { ...ctx, serviceId: service.id, serviceName: service.name };
  if (service.agendas.length > 1) return askAgenda(b, next, service);
  await afterAgenda(b, { ...next, agendaId: service.agendas[0].id }, service);
}

const agendaItems = (service: BotService) => [
  { id: "agenda_any", label: t.FIRST_AVAILABLE, description: t.FIRST_AVAILABLE_DESCRIPTION },
  ...service.agendas.map((a) => ({ id: `agenda_${a.id}`, label: a.professionalName ?? a.name, description: a.specialty })),
];

async function askAgenda(b: Bot, ctx: BookingContext, service: BotService): Promise<void> {
  await sendList(b, "bot_book_agenda", t.AGENDA_QUESTION, t.numberedList(agendaItems(service)));
  await go(b, "BOOK_AGENDA", ctx);
}

async function handleAgenda(b: Bot, selection: Selection): Promise<void> {
  const ctx = ctxOf(b);
  const service = await serviceOf(b, ctx);
  if (!service) return restart(b);
  const choice = pick(selection, agendaItems(service), (i) => i.id);
  if (!choice) {
    await say(b, "bot_not_understood", t.notUnderstood());
    return askAgenda(b, ctx, service);
  }
  await afterAgenda(b, { ...ctx, agendaId: choice.id === "agenda_any" ? null : choice.id.slice("agenda_".length) }, service);
}

function locationTypes(service: BotService, agendaId: string | null | undefined): LocationType[] {
  const types = agendaId
    ? (service.agendas.find((a) => a.id === agendaId)?.locationTypes ?? [])
    : (Object.keys(service.locationPrices) as LocationType[]);
  // Consultório antes do domiciliar, como no piloto.
  return (["clinic", "home_visit"] as const).filter((type) => types.includes(type));
}

async function afterAgenda(b: Bot, ctx: BookingContext, service: BotService): Promise<void> {
  const types = locationTypes(service, ctx.agendaId);
  if (types.length > 1) return askLocation(b, ctx, service, types);
  await afterLocation(b, { ...ctx, locationCategory: types[0] ?? null });
}

async function askLocation(b: Bot, ctx: BookingContext, service: BotService, types: LocationType[]): Promise<void> {
  await sendList(
    b,
    "bot_book_location",
    t.LOCATION_QUESTION,
    t.numberedList(types.map((type) => ({ id: `location_${type}`, label: t.LOCATION_LABELS[type], description: t.price(service.locationPrices[type]) }))),
  );
  await go(b, "BOOK_LOCATION", ctx);
}

async function handleLocation(b: Bot, selection: Selection): Promise<void> {
  const ctx = ctxOf(b);
  const service = await serviceOf(b, ctx);
  if (!service) return restart(b);
  const types = locationTypes(service, ctx.agendaId);
  const type = pick(selection, types, (type) => `location_${type}`);
  if (!type) {
    await say(b, "bot_not_understood", t.notUnderstood());
    return askLocation(b, ctx, service, types);
  }
  await afterLocation(b, { ...ctx, locationCategory: type });
}

async function afterLocation(b: Bot, ctx: BookingContext): Promise<void> {
  if (ctx.locationCategory === "home_visit") return enterAddress(b, ctx);
  await afterPlace(b, ctx);
}

// ---------------------------------------------------------------------------
// Endereço do domiciliar (Fase 16)
// ---------------------------------------------------------------------------

async function enterAddress(b: Bot, ctx: BookingContext): Promise<void> {
  const saved = b.convo.contactId ? (await getContact(b.db, b.clinicId, b.convo.contactId)).defaultHomeAddress : null;
  if (saved) {
    await say(b, "bot_book_home_address_confirm_default", t.homeAddressConfirmDefault(saved));
    return go(b, "BOOK_HOME_ADDRESS", { ...ctx, awaiting: "address_default", pendingAddress: saved });
  }
  await askAddress(b, ctx);
}

async function askAddress(b: Bot, ctx: BookingContext): Promise<void> {
  await say(b, "bot_book_home_address_ask", t.HOME_ADDRESS_ASK);
  await go(b, "BOOK_HOME_ADDRESS", { ...ctx, awaiting: "address_input", pendingAddress: undefined });
}

async function handleAddress(b: Bot, selection: Selection): Promise<void> {
  const ctx = ctxOf(b);
  if (ctx.awaiting === "address_input") {
    const address = selection.text.trim();
    if (!address) return askAddress(b, ctx);
    await say(b, "bot_book_home_address_confirm_new", t.homeAddressConfirmNew(address));
    return go(b, "BOOK_HOME_ADDRESS", { ...ctx, awaiting: "address_new", pendingAddress: address });
  }
  const answer = yesNo(selection);
  if (answer === null) {
    await say(b, "bot_not_understood", t.NOT_UNDERSTOOD_YES_NO);
    const address = ctx.pendingAddress ?? "";
    const isDefault = ctx.awaiting === "address_default";
    await say(b, isDefault ? "bot_book_home_address_confirm_default" : "bot_book_home_address_confirm_new", isDefault ? t.homeAddressConfirmDefault(address) : t.homeAddressConfirmNew(address));
    return;
  }
  if (!answer) return askAddress(b, ctx);
  await afterPlace(b, {
    ...ctx,
    awaiting: undefined,
    pendingAddress: undefined,
    homeAddress: ctx.pendingAddress,
    saveAddress: ctx.awaiting === "address_new",
  });
}

// ---------------------------------------------------------------------------
// Para quem e identificação do paciente
// ---------------------------------------------------------------------------

/** "É para você ou para outra pessoa?" pelo perfil (cliente, 07/out): Pediátrica só no exame; Adultos e Mista na consulta e no exame. */
function asksForWhom(b: Bot, ctx: BookingContext): boolean {
  return ctx.category === "exam" || (ctx.category === "consultation" && b.clinic.profile !== "pediatric");
}

async function afterPlace(b: Bot, ctx: BookingContext): Promise<void> {
  if (!asksForWhom(b, ctx)) return enterPatientSelect(b, ctx);
  await sendButtons(b, "bot_book_for_whom", t.FOR_WHOM_QUESTION, t.FOR_WHOM_BUTTONS);
  await go(b, "BOOK_FOR_WHOM", ctx);
}

async function handleForWhom(b: Bot, selection: Selection): Promise<void> {
  const ctx = ctxOf(b);
  const text = selection.text.toLowerCase();
  const self = selection.id === t.FOR_WHOM_IDS.self || text === "1" || text.startsWith("para mim") || text === "eu";
  const other = selection.id === t.FOR_WHOM_IDS.other || text === "2" || text.startsWith("outra");
  if (!self && !other) {
    await say(b, "bot_not_understood", t.notUnderstood());
    await sendButtons(b, "bot_book_for_whom", t.FOR_WHOM_QUESTION, t.FOR_WHOM_BUTTONS);
    return;
  }
  await step(b, "for_whom", { answer: self ? "self" : "other" });
  if (other) return enterPatientSelect(b, ctx);
  await startSelf(b, ctx);
}

const activePatients = async (b: Bot): Promise<Patient[]> =>
  b.convo.contactId ? listContactPatients(b.db, b.clinicId, b.convo.contactId) : [];

/** Lista os pacientes do contato com atendimento futuro do mesmo tipo; nunca todos (convênio com muitas crianças, piloto). */
async function enterPatientSelect(b: Bot, ctx: BookingContext): Promise<void> {
  const base = keepPath(ctx);
  if (!b.convo.contactId) {
    await say(b, "bot_book_ask_contact_name", t.ASK_CONTACT_NAME);
    return go(b, "BOOK_PATIENT_NEW", { ...base, awaiting: "contact_name" });
  }
  const patients = (await activePatients(b)).filter((p) => !p.isContactSelf);
  const upcoming = await listUpcomingAppointments(
    b.db,
    b.clinicId,
    patients.map((p) => p.id),
    b.now,
  );
  const sameKind = (category: string) => (ctx.category === "exam" ? category === "exam" : category !== "exam");
  const candidates = patients
    .filter((p) => (upcoming.get(p.id) ?? []).some((a) => sameKind(a.category)))
    .map((p) => ({ id: p.id, name: p.fullName, birthdate: p.birthdate }));
  if (!candidates.length) return beginNew(b, base);
  if (candidates.length > 3) {
    await say(b, "bot_book_ask_birthdate", t.askBirthdate(b.words));
    return go(b, "BOOK_PATIENT_SELECT", { ...base, awaiting: "birthdate_search" });
  }
  await sendPatientChoice(b, candidates, t.patientChoice(b.words));
  await go(b, "BOOK_PATIENT_SELECT", { ...base, awaiting: "patient_choice", candidates });
}

async function sendPatientChoice(b: Bot, candidates: Candidate[], body: string): Promise<void> {
  const items = [...candidates.map((c) => ({ id: `patient_${c.id}`, label: c.name })), { id: t.PATIENT_NEW_ID, label: t.otherPatientLabel(b.words) }];
  await sendList(b, "bot_book_patient_choice", body, t.numberedList(items));
}

/** Paciente novo: contato conhecido começa pela data (acha um cadastro com o nome escrito diferente); número novo, pelo nome. */
async function beginNew(b: Bot, ctx: BookingContext): Promise<void> {
  const base = keepPath(ctx);
  if (!b.convo.contactId) return askPatientName(b, base);
  await say(b, "bot_book_ask_birthdate", t.askBirthdate(b.words));
  await go(b, "BOOK_PATIENT_SELECT", { ...base, awaiting: "birthdate_search", duplicateCheck: true });
}

async function askPatientName(b: Bot, ctx: BookingContext, knownBirthdate?: string): Promise<void> {
  await say(b, "bot_book_ask_patient_name", t.askPatientName(b.words));
  await go(b, "BOOK_PATIENT_NEW", { ...keepPath(ctx), awaiting: "patient_name", knownBirthdate });
}

async function handlePatientSelect(b: Bot, selection: Selection): Promise<void> {
  const ctx = ctxOf(b);
  if (ctx.awaiting === "patient_choice") {
    const candidates = ctx.candidates ?? [];
    if (selection.id === t.PATIENT_NEW_ID || selection.text.trim() === String(candidates.length + 1)) {
      return ctx.knownBirthdate ? askPatientName(b, ctx, ctx.knownBirthdate) : beginNew(b, ctx);
    }
    const chosen = pick(selection, candidates, (c) => `patient_${c.id}`);
    if (!chosen) {
      await say(b, "bot_not_understood", t.notUnderstood());
      return sendPatientChoice(b, candidates, ctx.knownBirthdate ? t.birthdateMatches(b.words) : t.patientChoice(b.words));
    }
    return finish(b, ctx, chosen);
  }

  if (ctx.awaiting === "birthdate_search") {
    const birthdate = parseBirthdate(selection.text, b.clinic.today);
    if (!birthdate) return say(b, "bot_invalid_birthdate", t.INVALID_BIRTHDATE);
    if (await refusedByAgeLimit(b, ctx, birthdate)) return;
    const matches = (await activePatients(b))
      .filter((p) => !p.isContactSelf && p.birthdate === birthdate)
      .map((p) => ({ id: p.id, name: p.fullName, birthdate: p.birthdate }));
    if (!matches.length) return askPatientName(b, ctx, birthdate);
    if (matches.length === 1) {
      await say(b, "bot_book_confirm_patient", t.confirmPatient(b.words, matches[0].name, formatBirthdate(birthdate)));
      return go(b, "BOOK_PATIENT_SELECT", { ...keepPath(ctx), awaiting: "confirm_patient", pending: matches[0] });
    }
    await sendPatientChoice(b, matches, t.birthdateMatches(b.words));
    return go(b, "BOOK_PATIENT_SELECT", { ...keepPath(ctx), awaiting: "patient_choice", candidates: matches, knownBirthdate: birthdate });
  }

  // confirm_patient
  const pending = ctx.pending;
  if (!pending) return askPatientName(b, ctx);
  const answer = yesNo(selection);
  if (answer === null) {
    await say(b, "bot_not_understood", t.NOT_UNDERSTOOD_YES_NO);
    return say(b, "bot_book_confirm_patient", t.confirmPatient(b.words, pending.name, formatBirthdate(pending.birthdate)));
  }
  if (answer) return finish(b, ctx, pending);
  await askPatientName(b, ctx, pending.birthdate);
}

async function handlePatientNew(b: Bot, selection: Selection): Promise<void> {
  const ctx = ctxOf(b);
  const text = selection.text.trim();
  switch (ctx.awaiting) {
    case "contact_name": {
      if (!text) return say(b, "bot_book_ask_contact_name", t.ASK_CONTACT_NAME);
      await say(b, "bot_book_confirm_contact_name", t.confirmContactName(text));
      return go(b, "BOOK_PATIENT_NEW", { ...ctx, awaiting: "contact_confirm", contactName: text });
    }
    case "contact_confirm": {
      const answer = yesNo(selection);
      if (answer === null) {
        await say(b, "bot_not_understood", t.NOT_UNDERSTOOD_YES_NO);
        return say(b, "bot_book_confirm_contact_name", t.confirmContactName(ctx.contactName ?? ""));
      }
      if (answer && ctx.contactName) return askPatientName(b, ctx);
      await say(b, "bot_book_ask_contact_name", t.ASK_CONTACT_NAME);
      return go(b, "BOOK_PATIENT_NEW", { ...ctx, awaiting: "contact_name", contactName: undefined });
    }
    case "patient_name": {
      if (!text) return say(b, "bot_book_ask_patient_name", t.askPatientName(b.words));
      if (ctx.knownBirthdate) return askNewConfirm(b, ctx, text, ctx.knownBirthdate);
      await say(b, "bot_book_ask_birthdate", t.askBirthdate(b.words));
      return go(b, "BOOK_PATIENT_NEW", { ...ctx, awaiting: "patient_birthdate", newName: text });
    }
    case "patient_birthdate": {
      const birthdate = parseBirthdate(text, b.clinic.today);
      if (!birthdate) return say(b, "bot_invalid_birthdate", t.INVALID_BIRTHDATE);
      if (await refusedByAgeLimit(b, ctx, birthdate)) return;
      return askNewConfirm(b, ctx, ctx.newName ?? "", birthdate);
    }
    case "new_confirm": {
      const answer = yesNo(selection);
      if (answer === null) {
        await say(b, "bot_not_understood", t.NOT_UNDERSTOOD_YES_NO);
        return say(b, "bot_book_confirm_new_patient", t.confirmNewPatient(b.words, ctx.newName ?? "", formatBirthdate(ctx.newBirthdate ?? "")));
      }
      if (!answer) return b.convo.contactId ? beginNew(b, ctx) : askPatientName(b, ctx);
      const contact: ContactChoice = b.convo.contactId
        ? { mode: "existing", contactId: b.convo.contactId }
        : { mode: "new", fullName: ctx.contactName ?? "", phone: b.phone };
      return registerAndFinish(b, ctx, ctx.newName ?? "", ctx.newBirthdate ?? "", contact);
    }
    case "self_birthdate": {
      const birthdate = parseBirthdate(text, b.clinic.today);
      if (!birthdate) return say(b, "bot_invalid_birthdate", t.INVALID_BIRTHDATE);
      if (!isAdult(birthdate, b.clinic.today)) {
        await say(b, "bot_book_self_minor", t.SELF_MINOR);
        return end(b, "blocked", { reason: "self_minor" });
      }
      if (await refusedByAgeLimit(b, ctx, birthdate)) return;
      const knownName = b.convo.contactId && !ctx.selfAskName ? (await getContact(b.db, b.clinicId, b.convo.contactId)).fullName : null;
      if (knownName) return askSelfConfirm(b, ctx, knownName, birthdate);
      await say(b, "bot_book_ask_self_name", t.ASK_SELF_NAME);
      return go(b, "BOOK_PATIENT_NEW", { ...ctx, awaiting: "self_name", selfBirthdate: birthdate });
    }
    case "self_name": {
      if (!text || !ctx.selfBirthdate) return say(b, "bot_book_ask_self_name", t.ASK_SELF_NAME);
      return askSelfConfirm(b, ctx, text, ctx.selfBirthdate);
    }
    case "self_confirm": {
      const answer = yesNo(selection);
      if (answer === null) {
        await say(b, "bot_not_understood", t.NOT_UNDERSTOOD_YES_NO);
        return say(b, "bot_book_confirm_self", t.confirmSelf(ctx.selfName ?? "", formatBirthdate(ctx.selfBirthdate ?? "")));
      }
      if (!answer) return askSelfBirthdate(b, { ...ctx, selfAskName: true });
      return registerAndFinish(b, ctx, ctx.selfName ?? "", ctx.selfBirthdate ?? "", {
        mode: "self",
        phone: b.phone,
        confirmedContactId: b.convo.contactId ?? undefined,
      });
    }
    default:
      return restart(b);
  }
}

async function askNewConfirm(b: Bot, ctx: BookingContext, name: string, birthdate: string): Promise<void> {
  await say(b, "bot_book_confirm_new_patient", t.confirmNewPatient(b.words, name, formatBirthdate(birthdate)));
  await go(b, "BOOK_PATIENT_NEW", { ...ctx, awaiting: "new_confirm", newName: name, newBirthdate: birthdate });
}

// --- para mim ---------------------------------------------------------------

async function startSelf(b: Bot, ctx: BookingContext): Promise<void> {
  const self = (await activePatients(b)).find((p) => p.isContactSelf);
  if (self) return finish(b, ctx, { id: self.id, name: self.fullName, birthdate: self.birthdate });
  await askSelfBirthdate(b, ctx);
}

async function askSelfBirthdate(b: Bot, ctx: BookingContext): Promise<void> {
  await say(b, "bot_book_ask_self_birthdate", t.SELF_BIRTHDATE);
  await go(b, "BOOK_PATIENT_NEW", { ...keepPath(ctx), awaiting: "self_birthdate", selfAskName: ctx.selfAskName });
}

async function askSelfConfirm(b: Bot, ctx: BookingContext, name: string, birthdate: string): Promise<void> {
  await say(b, "bot_book_confirm_self", t.confirmSelf(name, formatBirthdate(birthdate)));
  await go(b, "BOOK_PATIENT_NEW", { ...ctx, awaiting: "self_confirm", selfName: name, selfBirthdate: birthdate });
}

/** Cadastra o paciente (e o contato, se o número é novo) e segue para o link. */
async function registerAndFinish(b: Bot, ctx: BookingContext, name: string, birthdate: string, contact: ContactChoice): Promise<void> {
  try {
    let result = await registerPatient(b.db, b.clinicId, { fullName: name, birthdate, contact, confirmDuplicate: true }, b.clinic.today);
    if (result.status === "confirm_same_person") {
      result = await registerPatient(
        b.db,
        b.clinicId,
        { fullName: name, birthdate, contact: { mode: "self", phone: b.phone, confirmedContactId: result.contact.id }, confirmDuplicate: true },
        b.clinic.today,
      );
    }
    if (result.status !== "created") throw new Error(`cadastro pelo bot: ${result.status}`);
    if (b.convo.contactId !== result.contact.id) await attachContact(b, result.contact.id);
    await finish(b, ctx, { id: result.patient.id, name: result.patient.fullName, birthdate });
  } catch (error) {
    // "Para mim" de quem já é o próprio paciente (cadastrado em outra conversa).
    if (error instanceof DataError && error.code === "duplicate") {
      const self = (await activePatients(b)).find((p) => p.isContactSelf);
      if (self) return finish(b, ctx, { id: self.id, name: self.fullName, birthdate: self.birthdate });
    }
    console.error("[bot] cadastro do paciente", error instanceof Error ? error.message : String(error));
    await say(b, "bot_book_link_error", t.LINK_ERROR);
    await end(b, "error", { reason: "register_failed" });
  }
}

// ---------------------------------------------------------------------------
// Idade limite (Fase 21)
// ---------------------------------------------------------------------------

/** Consulta para quem já completou a idade limite: avisa e pergunta se é para outra pessoa. */
async function refusedByAgeLimit(b: Bot, ctx: BookingContext, birthdate: string): Promise<boolean> {
  const limit = b.clinic.ageLimitYears;
  if (ctx.category !== "consultation" || limit === null || !isOverConsultationAgeLimit(birthdate, b.clinic.today, limit)) return false;
  await sendButtons(b, "bot_book_consultation_age_limit", t.ageLimit(ctx.serviceName ?? "A consulta", limit, b.words), t.YES_NO_BUTTONS);
  await go(b, "BOOK_AGE_LIMIT", keepPath(ctx));
  return true;
}

async function handleAgeLimit(b: Bot, selection: Selection): Promise<void> {
  const ctx = ctxOf(b);
  const answer = yesNo(selection, t.YES_NO_IDS);
  if (answer === null) {
    await sendButtons(b, "bot_not_understood", `${t.NOT_UNDERSTOOD_YES_NO}\n\n${t.ageLimit(ctx.serviceName ?? "A consulta", b.clinic.ageLimitYears ?? 0, b.words)}`, t.YES_NO_BUTTONS);
    return;
  }
  if (answer) {
    await step(b, "age_limit_other_child");
    return beginNew(b, ctx);
  }
  await step(b, "blocked", { reason: "consultation_age_limit" });
  await showMenu(b);
}

// ---------------------------------------------------------------------------
// Fim: link de /agendar
// ---------------------------------------------------------------------------

async function finish(b: Bot, ctx: BookingContext, patient: Candidate): Promise<void> {
  await step(b, "patient_identified", { patient_id: patient.id });
  const service = await serviceOf(b, ctx);
  if (!service || !ctx.serviceId) return restart(b);

  // Paciente escolhido numa lista: a idade limite ainda não foi conferida.
  if (ctx.category === "consultation" && patient.birthdate && (await refusedByAgeLimit(b, ctx, patient.birthdate))) return;

  // Já tem atendimento futuro que impede marcar outro (mesma agenda; exame: o mesmo exame).
  const upcoming = (await listUpcomingAppointments(b.db, b.clinicId, [patient.id], b.now)).get(patient.id) ?? [];
  const agendaIds = ctx.agendaId ? [ctx.agendaId] : service.agendas.map((a) => a.id);
  const blocking = agendaIds.map((agendaId) => findBlockingAppointment(upcoming, { serviceId: service.id, agendaId, category: service.category }));
  if (blocking.every(Boolean)) {
    const first = blocking[0]!;
    const blockingName = (await b.catalog()).services.find((s) => s.id === first.serviceId)?.name ?? "atendimento";
    await say(b, "bot_book_already_scheduled", t.alreadyScheduled(patient.name, blockingName, formatAppointmentWhen(first.scheduledAt, b.clinic.timeZone)));
    await step(b, "already_scheduled");
    if (ctx.category === "return_visit") return end(b, "blocked", { reason: "already_scheduled" });
    return enterPatientSelect(b, ctx);
  }

  const contactId = b.convo.contactId;
  if (!contactId) return restart(b);
  try {
    if (ctx.locationCategory === "home_visit" && ctx.homeAddress && ctx.saveAddress) {
      unwrap(
        await b.db.from("contacts").update({ default_home_address: ctx.homeAddress }).eq("clinic_id", b.clinicId).eq("id", contactId),
        "Contato",
      );
    }
    const link = await createBookingLink(
      b.db,
      b.clinicId,
      {
        mode: "create",
        contactId,
        patientId: patient.id,
        serviceId: service.id,
        agendaId: ctx.agendaId ?? null,
        locationId: null,
        locationCategory: ctx.locationCategory ?? null,
        appointmentId: null,
        originAppointmentId: ctx.originAppointmentId ?? null,
        contactPhone: b.phone,
        homeVisitAddress: ctx.locationCategory === "home_visit" ? (ctx.homeAddress ?? null) : null,
        funnelSessionId: b.convo.funnelSessionId,
        ttlMs: BOT_LINK_TTL_MS,
      },
      b.now,
    );
    await say(b, "bot_booking_link", t.bookingLink(service.name, patient.name, `${b.sender.baseUrl}/agendar/${link.id}`));
    await end(b, "link_sent", { booking_link_id: link.id });
  } catch (error) {
    console.error("[bot] link de agendamento", error instanceof Error ? error.message : String(error));
    await say(b, "bot_book_link_error", t.LINK_ERROR);
    await end(b, "error", { reason: "link_error" });
  }
}

/** Contexto perdido (ex.: serviço desativado no meio da conversa): volta ao menu. */
async function restart(b: Bot): Promise<void> {
  await step(b, "error", { reason: "lost_context" });
  await showMenu(b);
}

// ---------------------------------------------------------------------------
// Retorno (Fase 17)
// ---------------------------------------------------------------------------

export async function startReturn(b: Bot): Promise<void> {
  await open(b, "return_booking");
  const services = servicesOf(await b.catalog(), "return_visit");
  const deadline = services[0]?.returnDeadlineDays ?? null;
  const patients = await activePatients(b);
  const upcoming = await listUpcomingAppointments(
    b.db,
    b.clinicId,
    patients.map((p) => p.id),
    b.now,
  );

  const candidates: (ReturnCandidate & { service: BotService })[] = [];
  const reasons: { patient: Patient; result: ReturnEligibility }[] = [];
  for (const patient of patients) {
    let found = false;
    for (const service of services) {
      for (const agenda of service.agendas) {
        const origin = await findReturnOrigin(b.db, b.clinicId, { patientId: patient.id, agendaId: agenda.id, returnServiceId: service.id }, b.now);
        if (!origin) continue;
        const blocking = findBlockingAppointment(upcoming.get(patient.id) ?? [], { serviceId: service.id, agendaId: agenda.id, category: "return_visit" });
        const result = evaluateReturnEligibility(origin, b.clinic.today, blocking);
        if (result.status === "eligible") {
          candidates.push({ id: patient.id, name: patient.fullName, originId: origin.id, agendaId: agenda.id, serviceId: service.id, service });
          found = true;
          break;
        }
        reasons.push({ patient, result });
      }
      if (found) break;
    }
  }

  if (!candidates.length) return refuseReturn(b, reasons, deadline);
  const shown = candidates.slice(0, t.MAX_LIST_ROWS - 1);
  const first = shown[0].service;
  const priceLine = t.returnPriceLine(first.locationPrices.clinic ?? first.priceCents);
  await sendList(
    b,
    "bot_book_return_patient_choice",
    t.returnChoice(b.words, priceLine, first.returnDeadlineDays),
    t.numberedList(shown.map((c) => ({ id: `return_${c.id}`, label: c.name }))),
  );
  await go(b, "RETURN_SELECT", {
    category: "return_visit",
    returnCandidates: shown.map(({ service: _service, ...c }) => c),
  } satisfies BookingContext);
}

/** Ninguém com direito: um motivo só, do mais específico ao mais geral (piloto). */
async function refuseReturn(b: Bot, reasons: { patient: Patient; result: ReturnEligibility }[], deadline: number | null): Promise<void> {
  const find = (status: ReturnEligibility["status"]) => reasons.find((r) => r.result.status === status);
  const homeVisit = find("home_visit");
  const used = find("return_used");
  const future = find("future_appointment");
  if (homeVisit) {
    await say(b, "bot_book_return_home_visit", t.RETURN_HOME_VISIT);
    return end(b, "blocked", { reason: "return_home_visit" });
  }
  if (used) {
    await say(b, "bot_book_return_already_used", t.returnUsed(used.patient.fullName));
    return end(b, "blocked", { reason: "return_already_used" });
  }
  if (future && future.result.status === "future_appointment") {
    await say(b, "bot_book_already_scheduled", t.alreadyScheduled(future.patient.fullName, "atendimento", formatAppointmentWhen(future.result.futureScheduledAt, b.clinic.timeZone)));
    return end(b, "blocked", { reason: "already_scheduled" });
  }
  await say(b, "bot_book_return_no_recent_consultation", t.returnNoRecent(deadline));
  await end(b, "blocked", { reason: "return_no_recent_consultation" });
}

async function handleReturn(b: Bot, selection: Selection): Promise<void> {
  const ctx = ctxOf(b);
  const candidates = ctx.returnCandidates ?? [];
  const chosen = pick(selection, candidates, (c) => `return_${c.id}`);
  if (!chosen) {
    await say(b, "bot_not_understood", t.notUnderstood());
    await sendList(b, "bot_book_return_patient_choice", t.patientChoice(b.words), t.numberedList(candidates.map((c) => ({ id: `return_${c.id}`, label: c.name }))));
    return;
  }
  const service = (await b.catalog()).services.find((s) => s.id === chosen.serviceId);
  if (!service) return restart(b);
  const agenda = service.agendas.find((a) => a.id === chosen.agendaId);
  // Retorno no consultório, como no piloto (o domiciliar não dá direito a retorno).
  const locationCategory = agenda?.locationTypes.includes("clinic") ? "clinic" : (agenda?.locationTypes[0] ?? null);
  await finish(
    b,
    {
      category: "return_visit",
      serviceId: service.id,
      serviceName: service.name,
      agendaId: chosen.agendaId,
      locationCategory,
      originAppointmentId: chosen.originId,
    },
    chosen,
  );
}

// ---------------------------------------------------------------------------
// Despacho
// ---------------------------------------------------------------------------

export async function handleBookingState(b: Bot, state: string, selection: Selection): Promise<void> {
  switch (state) {
    case "BOOK_SERVICE":
      return handleService(b, selection);
    case "BOOK_AGENDA":
      return handleAgenda(b, selection);
    case "BOOK_LOCATION":
      return handleLocation(b, selection);
    case "BOOK_HOME_ADDRESS":
      return handleAddress(b, selection);
    case "BOOK_FOR_WHOM":
      return handleForWhom(b, selection);
    case "BOOK_PATIENT_SELECT":
      return handlePatientSelect(b, selection);
    case "BOOK_PATIENT_NEW":
      return handlePatientNew(b, selection);
    case "BOOK_AGE_LIMIT":
      return handleAgeLimit(b, selection);
    case "RETURN_SELECT":
      return handleReturn(b, selection);
  }
}
