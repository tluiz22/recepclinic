import { isAdult, isOverConsultationAgeLimit } from "../../../age";
import { bookingPath } from "../../../publicId";
import { evaluateReturnEligibility, findBlockingAppointment, findReturnOrigin, listUpcomingAppointments, type ReturnEligibility } from "../../agenda/appointments";
import { BOT_LINK_TTL_MS, createBookingLink } from "../../agenda/links";
import { agendasAcceptingPlan, bookableAgendaLocations } from "../../agenda/publicBooking";
import { earliestDate, horizonLastDate } from "../../agenda/slots";
import type { LocationType } from "../../config/locations";
import { DataError, unwrap } from "../../errors";
import { getContact, listContactPatients, registerPatient, type ContactChoice, type Patient } from "../../patients";
import { pauseForHuman, startFunnel } from "../conversations";
import { checkBookingLimits, checkNewPatientLimit, contactForLimits, recordBotLimitEvent } from "../botLimits";
import { formatAppointmentWhen } from "../templates";
import { copyAt, mixesCopies, servicesOf, type BotService } from "./catalog";
import { askHandoffSubject, attachContact, end, go, offerReception, repeatYesNo, say, sayInvalidBirthdate, sendButtons, sendList, step, textFor, type Bot } from "./engine";
import { formatBirthdate, parseBirthdate, pick, yesNo, type Selection } from "./input";
import { showMenu, showSubmenu } from "./menus";
import * as t from "./texts";
import { logError } from "../../../log";

// Marcar pelo bot (F6.3), com as regras do piloto (Fases 3b, 6, 16, 17, 21)
// no modelo novo: serviço → "com quem?" (D2) → local → endereço do
// domiciliar → para quem → identificação do paciente → link de /agendar.
// A data e o horário são escolhidos na página (F5.2). Retorno: só quem tem
// direito, com o profissional da consulta de origem; sem trava de idade
// (cliente, 07/out). Limites do contato (F9.6a): atendimentos futuros e
// faltas logo ao escolher marcar; cadastros ao pedir para cadastrar outra
// pessoa.

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
  | "self_confirm"
  | "coverage"
  | "plan_choice"
  | "plan_name"
  | "private_offer";

type Candidate = { id: string; name: string; birthdate?: string };
type ReturnCandidate = Candidate & { originId: string; agendaId: string; serviceId: string };
type Plan = { id: string; name: string };

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
  /** Veio do "Encaixe ou antecipar" sem nada marcado: ao confirmar pela página, entra na lista de espera (F6.4). */
  joinWaitlist?: boolean;
  /** Agendas do serviço com horário livre no prazo e os tipos de local de cada uma (cliente, 11/out/2026). */
  bookable?: Record<string, LocationType[]>;
  /** Particular ou convênio, já respondido (cliente, 31/out/2026). */
  coverage?: "private" | "insurance";
  /** Convênio aceito: vai no link e fica no atendimento. */
  insurancePlanId?: string;
  planCandidates?: Plan[];
  refusedPlan?: { name: string | null; forThisService: boolean };
  /** Número novo, paciente menor: quem escreve é o responsável. */
  guardian?: boolean;
};

/** Estados dos fluxos de marcar (cada um vira passo do funil). */
export const BOOKING_STATES = new Set([
  "BOOK_SERVICE",
  "BOOK_AGENDA",
  "BOOK_LOCATION",
  "BOOK_HOME_ADDRESS",
  "BOOK_COVERAGE",
  "BOOK_FOR_WHOM",
  "BOOK_PATIENT_SELECT",
  "BOOK_PATIENT_NEW",
  "BOOK_AGE_LIMIT",
  "RETURN_SELECT",
]);

const ctxOf = (b: Bot) => b.convo.context as BookingContext;

async function serviceOf(b: Bot, ctx: BookingContext): Promise<BotService | null> {
  const catalog = await b.catalog();
  // Escolhida a agenda, o contexto guarda a cópia dela (MS).
  if (ctx.agendaId && ctx.serviceId) {
    const copy = catalog.copies.find((s) => s.id === ctx.serviceId);
    if (copy) return copy;
  }
  return catalog.services.find((s) => s.id === ctx.serviceId) ?? catalog.copies.find((s) => s.id === ctx.serviceId) ?? null;
}

async function open(b: Bot, flow: "booking" | "exam" | "return_booking", metadata: Record<string, unknown> = {}): Promise<void> {
  b.now = new Date(b.now.getTime() + 1);
  const sessionId = await startFunnel(b.db, b.clinicId, b.phone, flow, metadata, b.now);
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
  joinWaitlist: ctx.joinWaitlist,
  coverage: ctx.coverage,
  insurancePlanId: ctx.insurancePlanId,
});

// ---------------------------------------------------------------------------
// Serviço, profissional e local
// ---------------------------------------------------------------------------

export async function startBooking(
  b: Bot,
  category: "consultation" | "exam",
  { joinWaitlist = false, serviceId }: { joinWaitlist?: boolean; serviceId?: string } = {},
): Promise<void> {
  await open(b, category === "exam" ? "exam" : "booking", joinWaitlist ? { waitlist: true } : {});
  if (await stoppedByBotLimit(b, "booking")) return;
  const services = servicesOf(await b.catalog(), category);
  if (!services.length) return handOver(b, "bot_nothing_to_book", t.NOTHING_TO_BOOK, "no_service", "no_availability", true);
  const ctx: BookingContext = { category, ...(joinWaitlist ? { joinWaitlist } : {}) };
  // Um serviço só, ou o citado na pergunta (base de conhecimento): escolhe sozinho e avisa qual é
  // (cliente, 31/out/2026; revoga a lista sempre de 07/out).
  const chosen = services.length === 1 ? services[0] : services.find((s) => s.id === serviceId);
  if (chosen) {
    await say(b, "bot_book_service_auto", t.serviceAuto(chosen.name));
    return chooseService(b, ctx, chosen);
  }
  await askService(b, ctx, services);
}

async function askService(b: Bot, ctx: BookingContext, services: BotService[]): Promise<void> {
  await sendList(
    b,
    "bot_book_service",
    t.serviceQuestion(ctx.category === "exam" ? "exam" : "consultation"),
    // Sem preço na lista: o valor vem depois das escolhas (cliente, 31/out/2026).
    t.numberedList(services.map((s) => ({ id: `service_${s.id}`, label: s.name }))),
  );
  await go(b, "BOOK_SERVICE", ctx);
}

async function handleService(b: Bot, selection: Selection): Promise<void> {
  const ctx = ctxOf(b);
  const services = servicesOf(await b.catalog(), ctx.category);
  const service = pick(selection, services, (s) => `service_${s.id}`);
  if (!service) {
    await say(b, "bot_not_understood", textFor(b, "not_understood", t.notUnderstood()));
    return askService(b, ctx, services);
  }
  await chooseService(b, ctx, service);
}

/**
 * Logo depois da escolha do serviço, antes de qualquer cadastro (cliente,
 * 11/out/2026): só segue com as agendas (e os locais) que têm horário livre no
 * prazo da clínica; sem nenhum, avisa e a recepção assume.
 */
async function chooseService(b: Bot, ctx: BookingContext, service: BotService): Promise<void> {
  // Cada agenda com a cópia dela (MS) e no prazo do profissional dela (cliente, 08/nov/2026).
  const found = new Map<string, Set<LocationType>>();
  const groups = new Map<string, { serviceId: string; days: number; agendaIds: string[] }>();
  for (const a of service.agendas) {
    const key = `${a.serviceId}|${a.attendance.bookingHorizonDays}`;
    const group = groups.get(key) ?? { serviceId: a.serviceId, days: a.attendance.bookingHorizonDays, agendaIds: [] };
    group.agendaIds.push(a.id);
    groups.set(key, group);
  }
  for (const { serviceId, days, agendaIds } of groups.values()) {
    const lastDate = horizonLastDate(b.clinic.today, days);
    for (const [id, types] of await bookableAgendaLocations(b.db, b.clinicId, { serviceId, agendaIds, lastDate }, b.now)) found.set(id, types);
  }
  const agendas = service.agendas.filter((a) => found.has(a.id));
  if (!agendas.length) return handOver(b, "bot_book_no_free_times", t.noFreeTimesOffer(service.name), "no_free_times");
  const bookable = Object.fromEntries([...found].map(([id, types]) => [id, [...types]]));
  const next: BookingContext = { ...ctx, serviceId: service.id, serviceName: service.name, bookable };
  if (agendas.length > 1) return askAgenda(b, next, service);
  await afterAgenda(b, { ...next, agendaId: agendas[0].id }, service);
}

/** Agendas do serviço que têm horário (sem a conferência, todas). */
const bookableAgendas = (service: BotService, ctx: BookingContext) => (ctx.bookable ? service.agendas.filter((a) => ctx.bookable![a.id]) : service.agendas);

const agendaItems = (service: BotService, ctx: BookingContext) => [
  // Cópias diferentes (MS) não têm um "primeiro horário" comum: o paciente escolhe com quem.
  ...(mixesCopies(service) ? [] : [{ id: "agenda_any", label: t.FIRST_AVAILABLE, description: t.FIRST_AVAILABLE_DESCRIPTION }]),
  ...bookableAgendas(service, ctx).map((a) => ({ id: `agenda_${a.id}`, label: a.professionalName ?? a.name, description: a.specialty })),
];

async function askAgenda(b: Bot, ctx: BookingContext, service: BotService): Promise<void> {
  await sendList(b, "bot_book_agenda", t.AGENDA_QUESTION, t.numberedList(agendaItems(service, ctx)));
  await go(b, "BOOK_AGENDA", ctx);
}

async function handleAgenda(b: Bot, selection: Selection): Promise<void> {
  const ctx = ctxOf(b);
  const service = await serviceOf(b, ctx);
  if (!service) return restart(b);
  const choice = pick(selection, agendaItems(service, ctx), (i) => i.id);
  if (!choice) {
    await say(b, "bot_not_understood", textFor(b, "not_understood", t.notUnderstood()));
    return askAgenda(b, ctx, service);
  }
  await afterAgenda(b, { ...ctx, agendaId: choice.id === "agenda_any" ? null : choice.id.slice("agenda_".length) }, service);
}

function locationTypes(service: BotService, agendaId: string | null | undefined, ctx: BookingContext): LocationType[] {
  let types = agendaId
    ? (service.agendas.find((a) => a.id === agendaId)?.locationTypes ?? [])
    : (Object.keys(service.locationPrices) as LocationType[]);
  // Só os locais com horário livre no prazo (na agenda escolhida ou em qualquer uma).
  if (ctx.bookable) {
    const free = new Set(agendaId ? (ctx.bookable[agendaId] ?? []) : Object.values(ctx.bookable).flat());
    types = types.filter((type) => free.has(type));
  }
  // Consultório antes do domiciliar, como no piloto.
  return (["clinic", "home_visit"] as const).filter((type) => types.includes(type));
}

async function afterAgenda(b: Bot, ctx: BookingContext, merged: BotService): Promise<void> {
  // Com a agenda escolhida, segue com a cópia do serviço dela (MS).
  const service = ctx.agendaId ? copyAt(await b.catalog(), merged, ctx.agendaId) : merged;
  ctx = { ...ctx, serviceId: service.id, serviceName: service.name };
  const types = locationTypes(service, ctx.agendaId, ctx);
  if (types.length > 1) return askLocation(b, ctx, service, types);
  await afterLocation(b, { ...ctx, locationCategory: types[0] ?? null });
}

async function askLocation(b: Bot, ctx: BookingContext, service: BotService, types: LocationType[]): Promise<void> {
  await sendList(
    b,
    "bot_book_location",
    t.LOCATION_QUESTION,
        // Sem preço: o valor vem depois das escolhas (cliente, 31/out/2026).
    t.numberedList(types.map((type) => ({ id: `location_${type}`, label: t.LOCATION_LABELS[type] }))),
  );
  await go(b, "BOOK_LOCATION", ctx);
}

async function handleLocation(b: Bot, selection: Selection): Promise<void> {
  const ctx = ctxOf(b);
  const service = await serviceOf(b, ctx);
  if (!service) return restart(b);
  const types = locationTypes(service, ctx.agendaId, ctx);
  const type = pick(selection, types, (type) => `location_${type}`);
  if (!type) {
    await say(b, "bot_not_understood", textFor(b, "not_understood", t.notUnderstood()));
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
    await sendButtons(b, "bot_book_home_address_confirm_default", t.homeAddressConfirmDefault(saved), t.YES_NO_BUTTONS);
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
    await sendButtons(b, "bot_book_home_address_confirm_new", t.homeAddressConfirmNew(address), t.YES_NO_BUTTONS);
    return go(b, "BOOK_HOME_ADDRESS", { ...ctx, awaiting: "address_new", pendingAddress: address });
  }
  const answer = yesNo(selection);
  if (answer === null) {
    const address = ctx.pendingAddress ?? "";
    const isDefault = ctx.awaiting === "address_default";
    await repeatYesNo(b, isDefault ? "bot_book_home_address_confirm_default" : "bot_book_home_address_confirm_new", isDefault ? t.homeAddressConfirmDefault(address) : t.homeAddressConfirmNew(address));
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
// Particular ou convênio e valor (cliente, 31/out/2026)
// ---------------------------------------------------------------------------
// Depois de serviço, profissional e local. Clínica sem convênios (recurso
// desligado ou nenhum plano ativo): particular direto. Convênio: só planos
// ativos da clínica, atendidos por algum profissional do caminho escolhido;
// sem o valor particular. O retorno não passa por aqui.

/** Planos com lista (mais o "Outro convênio" e o "Voltar ao menu"); acima disso, o paciente escreve. */
const MAX_PLANS_IN_LIST = t.MAX_LIST_ROWS - 2;

/**
 * Planos ativos que o caminho escolhido atende (MC, 07/nov/2026): os ligados a
 * algum profissional das agendas do caminho; agenda sem profissional (exames)
 * atende todos. Sem nenhum (profissional só particular), o bot não pergunta.
 */
async function activePlans(b: Bot, ctx: BookingContext): Promise<Plan[]> {
  if (!b.features.includes("insurance")) return [];
  const plans: Plan[] = unwrap(await b.db.from("insurance_plans").select("id, name").eq("clinic_id", b.clinicId).eq("is_active", true).order("name"), "Convênios");
  const service = await serviceOf(b, ctx);
  if (!plans.length || !service) return plans;
  const ids = new Set(pathAgendas(service, ctx));
  const agendas = service.agendas.filter((a) => ids.has(a.id));
  if (agendas.some((a) => !a.professionalId)) return plans;
  const professionalIds = agendas.map((a) => a.professionalId!);
  if (!professionalIds.length) return [];
  const links = unwrap(
    await b.db.from("professional_insurance_plans").select("insurance_plan_id").eq("clinic_id", b.clinicId).in("professional_id", professionalIds),
    "Convênios atendidos",
  );
  const accepted = new Set(links.map((l) => l.insurance_plan_id));
  return plans.filter((p) => accepted.has(p.id));
}

/** Agendas do caminho escolhido: a do profissional ou, no "Primeiro horário", as com horário no local escolhido. */
function pathAgendas(service: BotService, ctx: BookingContext): string[] {
  if (ctx.agendaId) return [ctx.agendaId];
  return bookableAgendas(service, ctx)
    .filter((a) => !ctx.locationCategory || (ctx.bookable?.[a.id] ?? a.locationTypes).includes(ctx.locationCategory))
    .map((a) => a.id);
}

/**
 * Algum profissional do caminho atende particular (F1 da recepção digital, 08/nov/2026: "Atende particular" no
 * cadastro). Sem o item Convênios ou com agenda sem profissional (exames), sempre.
 */
async function pathAcceptsPrivate(b: Bot, ctx: BookingContext): Promise<boolean> {
  if (!b.features.includes("insurance")) return true;
  const service = await serviceOf(b, ctx);
  if (!service) return true;
  const ids = new Set(pathAgendas(service, ctx));
  const agendas = service.agendas.filter((a) => ids.has(a.id));
  if (!agendas.length || agendas.some((a) => !a.professionalId)) return true;
  const rows = unwrap(
    await b.db.from("professionals").select("accepts_private").eq("clinic_id", b.clinicId).in("id", agendas.map((a) => a.professionalId!)),
    "Atende particular",
  );
  return rows.some((row) => row.accepts_private);
}

async function enterCoverage(b: Bot, ctx: BookingContext): Promise<void> {
  const acceptsPrivate = await pathAcceptsPrivate(b, ctx);
  if (!(await activePlans(b, ctx)).length) {
    if (acceptsPrivate) return choosePrivate(b, ctx);
    // Só convênio e nenhum plano ativo (ex.: planos desativados): não há como marcar por aqui.
    return handOver(b, "bot_book_no_coverage", t.NO_COVERAGE_OPTION, "no_coverage_option", "requested");
  }
  // Só convênio: não pergunta "particular ou convênio", vai direto ao plano.
  if (!acceptsPrivate) {
    await step(b, "coverage", { answer: "insurance" });
    return askPlan(b, ctx);
  }
  await sendButtons(b, "bot_book_coverage", t.COVERAGE_QUESTION, t.COVERAGE_BUTTONS);
  await go(b, "BOOK_COVERAGE", { ...ctx, awaiting: "coverage" });
}

async function choosePrivate(b: Bot, ctx: BookingContext): Promise<void> {
  const service = await serviceOf(b, ctx);
  if (!service) return restart(b);
  const cents = (ctx.locationCategory ? service.locationPrices[ctx.locationCategory] : undefined) ?? service.priceCents;
  if (cents > 0) await say(b, "bot_book_price", t.priceInfo(ctx.category === "exam" ? "exam" : "consultation", cents, b.clinic.paymentInfo));
  await afterPlace(b, { ...ctx, awaiting: undefined, planCandidates: undefined, refusedPlan: undefined, coverage: "private", insurancePlanId: undefined });
}

const planItems = (plans: Plan[]) => [
  ...plans.map((p) => ({ id: `plan_${p.id}`, label: p.name })),
  { id: t.PLAN_OTHER_ID, label: t.PLAN_OTHER_LABEL },
];

async function askPlanChoice(b: Bot, ctx: BookingContext, plans: Plan[]): Promise<void> {
  await sendList(b, "bot_book_plan_choice", t.PLAN_LIST_QUESTION, t.numberedList(planItems(plans)));
  await go(b, "BOOK_COVERAGE", { ...ctx, awaiting: "plan_choice", planCandidates: plans });
}

async function askPlan(b: Bot, ctx: BookingContext): Promise<void> {
  const plans = await activePlans(b, ctx);
  if (plans.length <= MAX_PLANS_IN_LIST) return askPlanChoice(b, ctx, plans);
  await say(b, "bot_book_plan_ask", t.PLAN_TEXT_QUESTION);
  await go(b, "BOOK_COVERAGE", { ...ctx, awaiting: "plan_name" });
}

async function acceptPlan(b: Bot, ctx: BookingContext, service: BotService, plan: Plan): Promise<void> {
  const accepting = await agendasAcceptingPlan(b.db, b.clinicId, pathAgendas(service, ctx), plan.id);
  if (!accepting.length) return refusePlan(b, ctx, plan.name, true);
  await step(b, "insurance_accepted");
  await say(b, "bot_book_plan_accepted", t.planAccepted(plan.name));
  await afterPlace(b, { ...ctx, awaiting: undefined, planCandidates: undefined, refusedPlan: undefined, coverage: "insurance", insurancePlanId: plan.id });
}

async function refusePlan(b: Bot, ctx: BookingContext, planName: string | null, forThisService: boolean): Promise<void> {
  await step(b, "insurance_not_accepted");
  // Só convênio: não oferece particular; a recepção ajuda (item 8 da jornada).
  if (!(await pathAcceptsPrivate(b, ctx))) {
    return handOver(b, "bot_book_plan_not_accepted", t.planNotAcceptedNoPrivate(planName, b.clinic.designation, forThisService), "insurance_not_accepted", "requested");
  }
  await sendButtons(b, "bot_book_plan_not_accepted", t.planNotAccepted(planName, b.clinic.designation, forThisService), t.YES_NO_BUTTONS);
  await go(b, "BOOK_COVERAGE", { ...ctx, awaiting: "private_offer", planCandidates: undefined, refusedPlan: { name: planName, forThisService } });
}

async function handleCoverage(b: Bot, selection: Selection): Promise<void> {
  const ctx = ctxOf(b);
  const service = await serviceOf(b, ctx);
  if (!service) return restart(b);
  switch (ctx.awaiting) {
    case "coverage": {
      const text = selection.text.trim().toLowerCase();
      const isPrivate = selection.id === t.COVERAGE_IDS.private || text === "1" || text.startsWith("particular");
      const isInsurance = selection.id === t.COVERAGE_IDS.insurance || text === "2" || /^(conv[eê]nio|plano)/.test(text);
      if (!isPrivate && !isInsurance) {
        await say(b, "bot_not_understood", textFor(b, "not_understood", t.notUnderstood()));
        return sendButtons(b, "bot_book_coverage", t.COVERAGE_QUESTION, t.COVERAGE_BUTTONS);
      }
      await step(b, "coverage", { answer: isPrivate ? "private" : "insurance" });
      return isPrivate ? choosePrivate(b, ctx) : askPlan(b, ctx);
    }
    case "plan_choice": {
      const plans = ctx.planCandidates ?? [];
      const choice = pick(selection, planItems(plans), (i) => i.id);
      if (!choice) {
        await say(b, "bot_not_understood", textFor(b, "not_understood", t.notUnderstood()));
        return askPlanChoice(b, ctx, plans);
      }
      const plan = plans.find((p) => `plan_${p.id}` === choice.id);
      return plan ? acceptPlan(b, ctx, service, plan) : refusePlan(b, ctx, null, false);
    }
    case "plan_name": {
      const text = selection.text.trim();
      if (!text) return say(b, "bot_book_plan_ask", t.PLAN_TEXT_QUESTION);
      // Só os planos ativos da clínica, pelo nome ou pelos outros nomes; o paciente confirma na lista (nunca pelo nome digitado).
      const found = unwrap(await b.db.rpc("search_insurance_plans", { p_clinic_id: b.clinicId, p_query: text }), "Convênios").map((p) => ({ id: p.id, name: p.name }));
      if (!found.length) return refusePlan(b, ctx, null, false);
      return askPlanChoice(b, ctx, found);
    }
    case "private_offer": {
      const refused = ctx.refusedPlan ?? { name: null, forThisService: false };
      const answer = yesNo(selection);
      if (answer === null) return repeatYesNo(b, "bot_book_plan_not_accepted", t.planNotAccepted(refused.name, b.clinic.designation, refused.forThisService));
      if (answer) return choosePrivate(b, ctx);
      return handOver(b, "bot_book_insurance_reception", "Tudo bem.", "insurance_not_accepted", "requested");
    }
    default:
      return restart(b);
  }
}

// ---------------------------------------------------------------------------
// Para quem e identificação do paciente
// ---------------------------------------------------------------------------

/**
 * Perfil e idade limite da marcação (cliente, 08/nov/2026; antes, da clínica): os da agenda escolhida; sem agenda
 * ("Primeiro horário"), os comuns às agendas do serviço; diferentes, os da conversa (o profissional em uso).
 */
async function attendanceOf(b: Bot, ctx: BookingContext): Promise<{ profile: Bot["clinic"]["profile"]; ageLimitYears: number | null }> {
  const agendas = (await serviceOf(b, ctx))?.agendas ?? [];
  const chosen = agendas.find((a) => a.id === ctx.agendaId);
  const pool = chosen ? [chosen] : agendas;
  const common = <T>(get: (a: (typeof pool)[number]) => T): T | undefined =>
    pool.length > 0 && pool.every((a) => get(a) === get(pool[0])) ? get(pool[0]) : undefined;
  const profile = common((a) => a.attendance.profile);
  const age = common((a) => a.attendance.consultationAgeLimitYears);
  return { profile: profile ?? b.clinic.profile, ageLimitYears: age === undefined ? b.clinic.ageLimitYears : age };
}

/** "É para você ou para outra pessoa?" pelo perfil (cliente, 07/out): Pediátrica só no exame; Adultos e Mista na consulta e no exame. */
async function asksForWhom(b: Bot, ctx: BookingContext): Promise<boolean> {
  return ctx.category === "exam" || (ctx.category === "consultation" && (await attendanceOf(b, ctx)).profile !== "pediatric");
}

async function afterPlace(b: Bot, ctx: BookingContext): Promise<void> {
  if (ctx.category !== "return_visit" && !ctx.coverage) return enterCoverage(b, ctx);
  if (!(await asksForWhom(b, ctx))) return enterPatientSelect(b, ctx);
  await sendButtons(b, "bot_book_for_whom", t.FOR_WHOM_QUESTION, t.FOR_WHOM_BUTTONS);
  await go(b, "BOOK_FOR_WHOM", ctx);
}

async function handleForWhom(b: Bot, selection: Selection): Promise<void> {
  const ctx = ctxOf(b);
  const text = selection.text.toLowerCase();
  const self = selection.id === t.FOR_WHOM_IDS.self || text === "1" || text.startsWith("para mim") || text === "eu";
  const other = selection.id === t.FOR_WHOM_IDS.other || text === "2" || text.startsWith("outra");
  if (!self && !other) {
    await say(b, "bot_not_understood", textFor(b, "not_understood", t.notUnderstood()));
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
  await sayAgeLimitNotice(b, base);
  // Número novo: o paciente primeiro (nome e nascimento), depois quem escreve (cliente, 31/out/2026).
  if (!b.convo.contactId) return askPatientName(b, base);
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

/** Consulta com idade limite na clínica: avisa antes de identificar o paciente (cliente, 31/out/2026). */
async function sayAgeLimitNotice(b: Bot, ctx: BookingContext): Promise<void> {
  const limit = (await attendanceOf(b, ctx)).ageLimitYears;
  if (ctx.category !== "consultation" || limit === null) return;
  await say(b, "bot_book_age_limit_notice", t.ageLimitNotice(await chosenProfessional(b, ctx), b.clinic.designation, limit));
}

/** Nome do profissional escolhido; null no "Primeiro horário" (os textos usam a clínica). */
async function chosenProfessional(b: Bot, ctx: BookingContext): Promise<string | null> {
  if (!ctx.agendaId) return null;
  return (await serviceOf(b, ctx))?.agendas.find((a) => a.id === ctx.agendaId)?.professionalName ?? null;
}

/** Número novo, depois do paciente: o nome de quem escreve (paciente menor: "do responsável"). */
async function askContactName(b: Bot, ctx: BookingContext, guardian: boolean): Promise<void> {
  await say(b, "bot_book_ask_contact_name", guardian ? t.ASK_GUARDIAN_NAME : t.ASK_SELF_NAME);
  await go(b, "BOOK_PATIENT_NEW", { ...ctx, awaiting: "contact_name", contactName: undefined, guardian });
}

const confirmContactText = (ctx: BookingContext, name: string) => (ctx.guardian ? t.confirmGuardianName(name) : t.confirmContactName(name));

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
  if (await stoppedByBotLimit(b, "new_patient")) return;
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
      await say(b, "bot_not_understood", textFor(b, "not_understood", t.notUnderstood()));
      return sendPatientChoice(b, candidates, ctx.knownBirthdate ? t.birthdateMatches(b.words) : t.patientChoice(b.words));
    }
    return finish(b, ctx, chosen);
  }

  if (ctx.awaiting === "birthdate_search") {
    const birthdate = parseBirthdate(selection.text, b.clinic.today);
    if (!birthdate) return sayInvalidBirthdate(b);
    if (await refusedByAgeLimit(b, ctx, birthdate)) return;
    const matches = (await activePatients(b))
      .filter((p) => !p.isContactSelf && p.birthdate === birthdate)
      .map((p) => ({ id: p.id, name: p.fullName, birthdate: p.birthdate }));
    if (!matches.length) return askPatientName(b, ctx, birthdate);
    if (matches.length === 1) {
      await sendButtons(b, "bot_book_confirm_patient", t.confirmPatient(b.words, matches[0].name, formatBirthdate(birthdate)), t.YES_NO_BUTTONS);
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
    return repeatYesNo(b, "bot_book_confirm_patient", t.confirmPatient(b.words, pending.name, formatBirthdate(pending.birthdate)));
  }
  if (answer) return finish(b, ctx, pending);
  await askPatientName(b, ctx, pending.birthdate);
}

async function handlePatientNew(b: Bot, selection: Selection): Promise<void> {
  const ctx = ctxOf(b);
  const text = selection.text.trim();
  switch (ctx.awaiting) {
    case "contact_name": {
      if (!text) return askContactName(b, ctx, ctx.guardian ?? false);
      await sendButtons(b, "bot_book_confirm_contact_name", confirmContactText(ctx, text), t.YES_NO_BUTTONS);
      return go(b, "BOOK_PATIENT_NEW", { ...ctx, awaiting: "contact_confirm", contactName: text });
    }
    case "contact_confirm": {
      const answer = yesNo(selection);
      if (answer === null) {
        return repeatYesNo(b, "bot_book_confirm_contact_name", confirmContactText(ctx, ctx.contactName ?? ""));
      }
      if (answer && ctx.contactName) {
        // O paciente já foi informado: só falta conferir os dados dele.
        if (ctx.newName && ctx.newBirthdate) return askNewConfirm(b, ctx, ctx.newName, ctx.newBirthdate);
        return askPatientName(b, ctx);
      }
      return askContactName(b, ctx, ctx.guardian ?? false);
    }
    case "patient_name": {
      if (!text) return say(b, "bot_book_ask_patient_name", t.askPatientName(b.words));
      if (ctx.knownBirthdate) return askNewConfirm(b, ctx, text, ctx.knownBirthdate);
      await say(b, "bot_book_ask_birthdate", t.askBirthdate(b.words));
      return go(b, "BOOK_PATIENT_NEW", { ...ctx, awaiting: "patient_birthdate", newName: text });
    }
    case "patient_birthdate": {
      const birthdate = parseBirthdate(text, b.clinic.today);
      if (!birthdate) return sayInvalidBirthdate(b);
      if (await refusedByAgeLimit(b, ctx, birthdate)) return;
      if (!b.convo.contactId && !ctx.contactName) return askContactName(b, { ...ctx, newBirthdate: birthdate }, !isAdult(birthdate, b.clinic.today));
      return askNewConfirm(b, ctx, ctx.newName ?? "", birthdate);
    }
    case "new_confirm": {
      const answer = yesNo(selection);
      if (answer === null) {
        return repeatYesNo(b, "bot_book_confirm_new_patient", t.confirmNewPatient(b.words, ctx.newName ?? "", formatBirthdate(ctx.newBirthdate ?? "")));
      }
      if (!answer) return b.convo.contactId ? beginNew(b, ctx) : askPatientName(b, ctx);
      const contact: ContactChoice = b.convo.contactId
        ? { mode: "existing", contactId: b.convo.contactId }
        : { mode: "new", fullName: ctx.contactName ?? "", phone: b.phone };
      return registerAndFinish(b, ctx, ctx.newName ?? "", ctx.newBirthdate ?? "", contact);
    }
    case "self_birthdate": {
      const birthdate = parseBirthdate(text, b.clinic.today);
      if (!birthdate) return sayInvalidBirthdate(b);
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
        return repeatYesNo(b, "bot_book_confirm_self", t.confirmSelf(ctx.selfName ?? "", formatBirthdate(ctx.selfBirthdate ?? "")));
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
  await sendButtons(b, "bot_book_confirm_new_patient", t.confirmNewPatient(b.words, name, formatBirthdate(birthdate)), t.YES_NO_BUTTONS);
  await go(b, "BOOK_PATIENT_NEW", { ...ctx, awaiting: "new_confirm", newName: name, newBirthdate: birthdate });
}

// --- para mim ---------------------------------------------------------------

async function startSelf(b: Bot, ctx: BookingContext): Promise<void> {
  const self = (await activePatients(b)).find((p) => p.isContactSelf);
  if (self) return finish(b, ctx, { id: self.id, name: self.fullName, birthdate: self.birthdate });
  await askSelfBirthdate(b, ctx);
}

async function askSelfBirthdate(b: Bot, ctx: BookingContext): Promise<void> {
  if (await stoppedByBotLimit(b, "new_patient")) return;
  await say(b, "bot_book_ask_self_birthdate", t.SELF_BIRTHDATE);
  await go(b, "BOOK_PATIENT_NEW", { ...keepPath(ctx), awaiting: "self_birthdate", selfAskName: ctx.selfAskName });
}

async function askSelfConfirm(b: Bot, ctx: BookingContext, name: string, birthdate: string): Promise<void> {
  await sendButtons(b, "bot_book_confirm_self", t.confirmSelf(name, formatBirthdate(birthdate)), t.YES_NO_BUTTONS);
  await go(b, "BOOK_PATIENT_NEW", { ...ctx, awaiting: "self_confirm", selfName: name, selfBirthdate: birthdate });
}

/** Cadastra o paciente (e o contato, se o número é novo) e segue para o link. */
async function registerAndFinish(b: Bot, ctx: BookingContext, name: string, birthdate: string, contact: ContactChoice): Promise<void> {
  try {
    let result = await registerPatient(b.db, b.clinicId, { fullName: name, birthdate, contact, confirmDuplicate: true, createdVia: "whatsapp" }, b.clinic.today);
    if (result.status === "confirm_same_person") {
      result = await registerPatient(
        b.db,
        b.clinicId,
        { fullName: name, birthdate, contact: { mode: "self", phone: b.phone, confirmedContactId: result.contact.id }, confirmDuplicate: true, createdVia: "whatsapp" },
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
    logError("bot: cadastro do paciente", error, { clinica: b.clinicId });
    await say(b, "bot_book_link_error", t.linkError(b.clinic.designation));
    await end(b, "error", { reason: "register_failed" });
  }
}

// ---------------------------------------------------------------------------
// Limites do contato (F9.6a)
// ---------------------------------------------------------------------------

/**
 * Limite atingido: o bot não marca e responde neutro, sem revelar a regra.
 * Com coexistência, passa a conversa para a recepção (pausa); sem ela, ninguém
 * responderia pelo app: só avisa que a recepção entra em contato, sem repetir
 * o menu (a próxima mensagem recomeça; cliente, 10/out). Número sem contato
 * ainda não tem o que contar; contato liberado pelo Administrador não entra.
 * O contato desativado conta (a conversa o trata como número novo).
 */
async function stoppedByBotLimit(b: Bot, check: "booking" | "new_patient"): Promise<boolean> {
  const contact = await contactForLimits(b.db, b.clinicId, b.phone);
  if (!contact || contact.exempt) return false;
  const contactId = contact.id;
  const hit =
    check === "booking" ? await checkBookingLimits(b.db, b.clinicId, contactId, b.now) : await checkNewPatientLimit(b.db, b.clinicId, contactId, b.now);
  if (!hit) return false;
  const pause = b.receptionAvailable;
  await recordBotLimitEvent(b.db, b.clinicId, contactId, hit, pause, b.now);
  await say(b, "bot_limit_reached", pause ? t.LIMIT_HANDOFF : t.LIMIT_RECEPTION_WILL_CONTACT);
  await end(b, "blocked", { reason: `limit_${hit.reason}` });
  if (pause) {
    await pauseForHuman(b.db, b.clinicId, b.phone, { contactId, reason: "bot_limit" }, b.now);
    await askHandoffSubject(b);
  }
  return true;
}

/**
 * Nada para o bot marcar (clínica sem serviço, serviço sem horário livre no
 * prazo) ou convênio não aceito: a tentativa termina e o bot pergunta se a
 * pessoa quer a recepção (cliente, 31/out/2026: nunca transferir sem
 * perguntar). O Sim e o Não estão no router (`acceptReceptionOffer`).
 */
export async function handOver(b: Bot, kind: string, lead: string | null, reason: string, handoff: "no_availability" | "requested" = "no_availability", noMenu = false): Promise<void> {
  await end(b, "blocked", { reason });
  await offerReception(b, { kind, reason: handoff, ...(noMenu ? { noMenu } : {}) }, lead);
}

// ---------------------------------------------------------------------------
// Idade limite (Fase 21)
// ---------------------------------------------------------------------------

/** Consulta para quem já completou a idade limite: avisa e pergunta se é para outra pessoa. */
async function refusedByAgeLimit(b: Bot, ctx: BookingContext, birthdate: string): Promise<boolean> {
  const limit = (await attendanceOf(b, ctx)).ageLimitYears;
  if (ctx.category !== "consultation" || limit === null || !isOverConsultationAgeLimit(birthdate, b.clinic.today, limit)) return false;
  await sendButtons(b, "bot_book_consultation_age_limit", t.ageLimit(await chosenProfessional(b, ctx), b.clinic.designation, limit, b.words), t.YES_NO_BUTTONS);
  await go(b, "BOOK_AGE_LIMIT", keepPath(ctx));
  return true;
}

async function handleAgeLimit(b: Bot, selection: Selection): Promise<void> {
  const ctx = ctxOf(b);
  const answer = yesNo(selection, t.YES_NO_IDS);
  if (answer === null) {
    const buttons = b.convo.notUnderstoodCount > 0 ? t.YES_NO_BACK_BUTTONS : t.YES_NO_BUTTONS;
    await sendButtons(b, "bot_not_understood", `${t.NOT_UNDERSTOOD_YES_NO}\n\n${t.ageLimit(await chosenProfessional(b, ctx), b.clinic.designation, (await attendanceOf(b, ctx)).ageLimitYears ?? 0, b.words)}`, buttons);
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
    const group = ctx.category === "exam" ? "exam" : "consultation";
    await say(b, "bot_book_already_scheduled", t.alreadyScheduled(patient.name, blockingName, formatAppointmentWhen(first.scheduledAt, b.clinic.timeZone), group));
    // Já mostra o menu com o Remarcar (cliente, 11/out/2026).
    await end(b, "blocked", { reason: "already_scheduled" });
    return showSubmenu(b, group === "exam" ? "EXAMES_MENU" : "CONSULTAS_MENU");
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
        joinWaitlist: ctx.joinWaitlist ?? false,
        insurancePlanId: ctx.insurancePlanId ?? null,
        ttlMs: BOT_LINK_TTL_MS,
      },
      b.now,
    );
    const url = `${b.sender.baseUrl}${bookingPath(link.id)}`;
    await say(b, "bot_booking_link", textFor(b, "booking_link", t.bookingLink(service.name, patient.name, url), { servico: service.name, paciente: patient.name, link: url }));
    // Serviço e agenda no passo (M3 das Métricas): o filtro por serviço e agenda no Agendamento digital.
    await end(b, "link_sent", { booking_link_id: link.id, service_id: service.id, agenda_id: link.agendaId });
  } catch (error) {
    logError("bot: link de agendamento", error, { clinica: b.clinicId });
    await say(b, "bot_book_link_error", t.linkError(b.clinic.designation));
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

export async function startReturn(b: Bot, { joinWaitlist = false } = {}): Promise<void> {
  await open(b, "return_booking", joinWaitlist ? { waitlist: true } : {});
  if (await stoppedByBotLimit(b, "booking")) return;
  // Cada cópia do retorno com a agenda dela (MS): a origem é a consulta naquela agenda.
  const services = (await b.catalog()).copies.filter((s) => s.category === "return_visit");
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
  // O retorno nunca fala de valor (cliente, 31/out/2026).
  await sendList(
    b,
    "bot_book_return_patient_choice",
    t.returnChoice(b.words, first.returnDeadlineDays),
    t.numberedList(shown.map((c) => ({ id: `return_${c.id}`, label: c.name }))),
  );
  await go(b, "RETURN_SELECT", {
    category: "return_visit",
    returnCandidates: shown.map(({ service: _service, ...c }) => c),
    ...(joinWaitlist ? { joinWaitlist } : {}),
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
    await say(
      b,
      "bot_book_already_scheduled",
      t.alreadyScheduled(future.patient.fullName, "atendimento", formatAppointmentWhen(future.result.futureScheduledAt, b.clinic.timeZone), "consultation"),
    );
    await end(b, "blocked", { reason: "already_scheduled" });
    return showSubmenu(b, "CONSULTAS_MENU");
  }
  await say(b, "bot_book_return_no_recent_consultation", t.returnNoRecent(deadline));
  await end(b, "blocked", { reason: "return_no_recent_consultation" });
}

async function handleReturn(b: Bot, selection: Selection): Promise<void> {
  const ctx = ctxOf(b);
  const candidates = ctx.returnCandidates ?? [];
  const chosen = pick(selection, candidates, (c) => `return_${c.id}`);
  if (!chosen) {
    await say(b, "bot_not_understood", textFor(b, "not_understood", t.notUnderstood()));
    await sendList(b, "bot_book_return_patient_choice", t.patientChoice(b.words), t.numberedList(candidates.map((c) => ({ id: `return_${c.id}`, label: c.name }))));
    return;
  }
  const service = (await b.catalog()).copies.find((s) => s.id === chosen.serviceId);
  if (!service) return restart(b);
  const agenda = service.agendas.find((a) => a.id === chosen.agendaId);
  // Horário livre até o fim do prazo do retorno e do prazo da clínica (cliente, 11/out/2026).
  const origin = await findReturnOrigin(
    b.db,
    b.clinicId,
    { patientId: chosen.id, agendaId: chosen.agendaId, returnServiceId: service.id, originAppointmentId: chosen.originId },
    b.now,
  );
  const lastDate = earliestDate(origin?.lastDate ?? null, horizonLastDate(b.clinic.today, agenda?.attendance.bookingHorizonDays ?? b.clinic.horizonDays));
  const free = (await bookableAgendaLocations(b.db, b.clinicId, { serviceId: service.id, agendaIds: [chosen.agendaId], lastDate }, b.now)).get(chosen.agendaId);
  if (!free) return handOver(b, "bot_book_no_free_times", t.noFreeTimesOffer(service.name), "no_free_times");
  // Retorno no consultório, como no piloto (o domiciliar não dá direito a retorno).
  const types = (agenda?.locationTypes ?? []).filter((type) => free.has(type));
  const locationCategory = types.includes("clinic") ? "clinic" : (types[0] ?? null);
  await finish(
    b,
    {
      category: "return_visit",
      serviceId: service.id,
      serviceName: service.name,
      agendaId: chosen.agendaId,
      locationCategory,
      originAppointmentId: chosen.originId,
      joinWaitlist: ctx.joinWaitlist,
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
    case "BOOK_COVERAGE":
      return handleCoverage(b, selection);
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
