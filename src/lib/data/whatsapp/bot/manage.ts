import type { Enums } from "../../../supabase/database.types";
import { cancelAppointment, findReturnOrigin, rescheduleAppointment } from "../../agenda/appointments";
import { BOT_LINK_TTL_MS, createBookingLink } from "../../agenda/links";
import { getFreeSlotsBefore } from "../../agenda/slots";
import { DataError, unwrap } from "../../errors";
import { activeWaitlistAppointmentIds, joinBlockReason, joinWaitlist, leaveWaitlist } from "../../waitlist/entries";
import { acceptOffer, declineOffer, MIN_LEAD_MS, type OfferReplyResult, type OfferSender } from "../../waitlist/offers";
import { pauseForHuman, startFunnel } from "../conversations";
import type { WaMessage } from "../meta";
import { sendAppointmentNotice } from "../notices";
import { parseReminderTap, recordReminderTap } from "../reminders";
import { formatAppointmentWhen } from "../templates";
import { startBooking, startReturn } from "./booking";
import { servicesOf } from "./catalog";
import { end, go, say, sendButtons, sendList, step, textFor, type Bot } from "./engine";
import { formatBirthdate, parseBirthdate, pick, yesNo, type Selection } from "./input";
import { showMenu } from "./menus";
import * as t from "./texts";

// Bot II (F6.4), com as regras do piloto (Fases 3b, 16, 17, 19, 25):
// cancelar e remarcar pelo menu, botões do lembrete, Encaixe ou antecipar
// (lista de espera; antes, os horários livres antes do atendimento, cliente
// 08/out), resposta à oferta de vaga e "Falar com a recepção".
// Sessão de série: cancela ou remarca só ela (D9). Textos aprovados pelo
// cliente em 07/out.

type Category = Enums<"service_category">;

/** Atendimento futuro do contato, como o bot precisa. */
export type ManagedAppointment = {
  id: string;
  patientId: string;
  patientName: string;
  birthdate: string;
  scheduledAt: Date;
  serviceId: string;
  serviceName: string;
  category: Category;
  agendaId: string;
  locationType: Enums<"location_type">;
  homeVisitAddress: string | null;
  originAppointmentId: string | null;
  seriesId: string | null;
  status: Enums<"appointment_status">;
};

const COLUMNS =
  "id, patient_id, scheduled_at, service_id, agenda_id, home_visit_address, origin_appointment_id, series_id, status, services!inner ( name, category ), locations ( type ), patients!inner ( full_name, birthdate, contact_id )";

type Row = {
  id: string;
  patient_id: string;
  scheduled_at: string;
  service_id: string;
  agenda_id: string;
  home_visit_address: string | null;
  origin_appointment_id: string | null;
  series_id: string | null;
  status: Enums<"appointment_status">;
  services: { name: string; category: Category };
  locations: { type: Enums<"location_type"> } | null;
  patients: { full_name: string; birthdate: string; contact_id: string };
};

const toManaged = (row: Row): ManagedAppointment => ({
  id: row.id,
  patientId: row.patient_id,
  patientName: row.patients.full_name,
  birthdate: row.patients.birthdate,
  scheduledAt: new Date(row.scheduled_at),
  serviceId: row.service_id,
  serviceName: row.services.name,
  category: row.services.category,
  agendaId: row.agenda_id,
  locationType: row.locations?.type ?? "clinic",
  homeVisitAddress: row.home_visit_address,
  originAppointmentId: row.origin_appointment_id,
  seriesId: row.series_id,
  status: row.status,
});

const inGroup = (group: t.Group, category: Category) => (group === "exam" ? category === "exam" : category !== "exam");

/** Atendimentos ativos e futuros dos pacientes do contato, só do grupo (nunca mistura consulta e exame). */
async function loadUpcoming(b: Bot, group: t.Group): Promise<ManagedAppointment[]> {
  if (!b.convo.contactId) return [];
  const rows = unwrap(
    await b.db
      .from("appointments")
      .select(COLUMNS)
      .eq("clinic_id", b.clinicId)
      .eq("patients.contact_id", b.convo.contactId)
      .in("status", ["scheduled", "confirmed"])
      .gt("scheduled_at", b.now.toISOString())
      .order("scheduled_at"),
    "Atendimentos",
  ) as unknown as Row[];
  return rows.map(toManaged).filter((a) => inGroup(group, a.category));
}

/** O atendimento, se ainda é do contato, ativo e futuro (revalida a cada passo). */
async function loadActive(b: Bot, id: string): Promise<ManagedAppointment | null> {
  if (!b.convo.contactId) return null;
  const row = unwrap(
    await b.db.from("appointments").select(COLUMNS).eq("clinic_id", b.clinicId).eq("id", id).eq("patients.contact_id", b.convo.contactId).maybeSingle(),
    "Atendimento",
  ) as unknown as Row | null;
  if (!row) return null;
  const appointment = toManaged(row);
  return ["scheduled", "confirmed"].includes(appointment.status) && appointment.scheduledAt > b.now ? appointment : null;
}

const when = (b: Bot, a: { scheduledAt: Date }) => formatAppointmentWhen(a.scheduledAt, b.clinic.timeZone);
const words = (a: ManagedAppointment) => t.appointmentWords(a.category, a.serviceName);
const groupOf = (a: ManagedAppointment): t.Group => (a.category === "exam" ? "exam" : "consultation");

// ---------------------------------------------------------------------------
// Identificação do atendimento (comum a cancelar, remarcar e encaixe)
// ---------------------------------------------------------------------------

type Action = "cancel" | "reschedule" | "waitlist";

/** Lista no contexto (só o que a escolha precisa; o resto é relido do banco). */
type Candidate = { id: string; patientName: string; birthdate: string; scheduledAt: string };

export type ManageContext = {
  action: Action;
  group: t.Group;
  awaiting?: "appointment_choice" | "birthdate_search" | "confirm_appointment" | "address_current" | "address_input" | "address_new" | "book_choice";
  candidates?: Candidate[];
  pendingId?: string;
  pendingAddress?: string;
  fromReminder?: boolean;
};

export const MANAGE_STATES = new Set([
  "CANCEL_SELECT",
  "CANCEL_CONFIRM",
  "RESCHEDULE_SELECT",
  "RESCHEDULE_HOME_ADDRESS",
  "WAITLIST_SELECT",
  "WAITLIST_EARLIER",
  "WAITLIST_LEAVE_CONFIRM",
  "PRESENCE_CONFIRM",
]);

const SELECT_STATE: Record<Action, string> = { cancel: "CANCEL_SELECT", reschedule: "RESCHEDULE_SELECT", waitlist: "WAITLIST_SELECT" };
const VERB: Record<Action, "cancelar" | "remarcar" | "antecipar"> = { cancel: "cancelar", reschedule: "remarcar", waitlist: "antecipar" };

const ctxOf = (b: Bot) => b.convo.context as ManageContext;
const toCandidate = (a: ManagedAppointment): Candidate => ({ id: a.id, patientName: a.patientName, birthdate: a.birthdate, scheduledAt: a.scheduledAt.toISOString() });

async function openFunnel(b: Bot, flow: "cancel" | "reschedule", metadata: Record<string, unknown>): Promise<void> {
  b.now = new Date(b.now.getTime() + 1);
  const sessionId = await startFunnel(b.db, b.clinicId, b.phone, flow, metadata, b.now);
  b.convo = { ...b.convo, funnelSessionId: sessionId, funnelFlow: flow };
}

async function sendChoice(b: Bot, ctx: ManageContext, candidates: Candidate[]): Promise<void> {
  await sendList(
    b,
    `bot_${ctx.action}_choice`,
    t.chooseAppointment(VERB[ctx.action], ctx.group),
    t.numberedList(candidates.map((c) => ({ id: `appointment_${c.id}`, label: c.patientName, description: formatAppointmentWhen(new Date(c.scheduledAt), b.clinic.timeZone) }))),
  );
}

/** Menu › Cancelar / Remarcar / Encaixe: acha os atendimentos e segue. */
export async function startManage(b: Bot, action: Action, group: t.Group): Promise<void> {
  if (action !== "waitlist") await openFunnel(b, action, { category: group });
  if (!b.convo.contactId && action !== "waitlist") {
    await say(b, `bot_${action}_no_contact`, t.NO_REGISTRATION);
    return end(b, "blocked", { reason: "no_contact" });
  }
  let appointments = await loadUpcoming(b, group);
  if (action === "waitlist") appointments = appointments.filter((a) => joinBlockReason(a, b.now) === null);
  const ctx: ManageContext = { action, group };
  if (!appointments.length) {
    if (action === "waitlist") return offerBooking(b, ctx);
    await say(b, `bot_${action}_no_appointments`, t.noAppointments(VERB[action] as "cancelar" | "remarcar", group));
    return end(b, "blocked", { reason: "no_appointments" });
  }
  if (appointments.length === 1) return chosen(b, ctx, appointments[0], { single: true });
  if (appointments.length > 3) {
    await say(b, "bot_ask_birthdate", t.askAppointmentBirthdate(b.words));
    return go(b, SELECT_STATE[action], { ...ctx, awaiting: "birthdate_search", candidates: appointments.map(toCandidate) });
  }
  const candidates = appointments.map(toCandidate);
  await sendChoice(b, ctx, candidates);
  await go(b, SELECT_STATE[action], { ...ctx, awaiting: "appointment_choice", candidates });
}

async function handleSelect(b: Bot, selection: Selection): Promise<void> {
  const ctx = ctxOf(b);
  if (ctx.awaiting === "book_choice") return handleBookChoice(b, selection);
  const candidates = ctx.candidates ?? [];

  if (ctx.awaiting === "confirm_appointment") {
    const answer = yesNo(selection);
    if (answer === true && ctx.pendingId) return proceed(b, ctx, ctx.pendingId);
    if (answer === false) {
      await say(b, "bot_reschedule_not_identified", t.couldNotIdentify(ctx.group));
      return end(b, "blocked", { reason: "appointment_not_identified" });
    }
    await say(b, "bot_not_understood", t.NOT_UNDERSTOOD_YES_NO);
    const pending = ctx.pendingId ? await loadActive(b, ctx.pendingId) : null;
    if (pending) await say(b, "bot_reschedule_confirm", t.confirmReschedule(words(pending).phrase, pending.patientName, when(b, pending)));
    return;
  }

  if (ctx.awaiting === "birthdate_search") {
    const birthdate = parseBirthdate(selection.text, b.clinic.today);
    if (!birthdate) return say(b, "bot_invalid_birthdate", t.INVALID_BIRTHDATE);
    const matches = candidates.filter((c) => c.birthdate === birthdate);
    if (!matches.length) {
      await say(b, "bot_no_matching_appointment", t.noMatchingAppointment(ctx.group));
      return ctx.action === "waitlist" ? go(b, "WELCOME") : end(b, "blocked", { reason: "no_match" });
    }
    if (matches.length === 1) return proceed(b, ctx, matches[0].id);
    await sendChoice(b, ctx, matches);
    return go(b, SELECT_STATE[ctx.action], { ...ctx, awaiting: "appointment_choice", candidates: matches });
  }

  const choice = pick(selection, candidates, (c) => `appointment_${c.id}`);
  if (!choice) {
    await say(b, "bot_not_understood", textFor(b, "not_understood", t.notUnderstood()));
    return sendChoice(b, ctx, candidates);
  }
  await proceed(b, ctx, choice.id);
}

/** Atendimento escolhido: relê do banco (pode ter mudado) e segue a ação. */
async function proceed(b: Bot, ctx: ManageContext, id: string): Promise<void> {
  const appointment = await loadActive(b, id);
  if (!appointment) {
    await say(b, "bot_appointment_inactive", t.APPOINTMENT_INACTIVE);
    return ctx.action === "waitlist" ? go(b, "WELCOME") : end(b, "blocked", { reason: "inactive" });
  }
  await chosen(b, ctx, appointment);
}

async function chosen(b: Bot, ctx: ManageContext, appointment: ManagedAppointment, { single = false } = {}): Promise<void> {
  if (ctx.action === "cancel") return askCancel(b, ctx, appointment);
  if (ctx.action === "waitlist") return handleWaitlistAppointment(b, appointment);
  // Remarcar com um atendimento só: confirma que é ele (piloto).
  if (single) {
    const { phrase } = words(appointment);
    await say(b, "bot_reschedule_confirm", t.confirmReschedule(phrase, appointment.patientName, when(b, appointment)));
    return go(b, "RESCHEDULE_SELECT", { ...ctx, awaiting: "confirm_appointment", candidates: [toCandidate(appointment)], pendingId: appointment.id });
  }
  await rescheduleLink(b, ctx, appointment);
}

// ---------------------------------------------------------------------------
// Cancelar
// ---------------------------------------------------------------------------

async function askCancel(b: Bot, ctx: ManageContext, appointment: ManagedAppointment): Promise<void> {
  await say(b, "bot_cancel_confirm", t.confirmCancel(words(appointment).phrase, appointment.patientName, when(b, appointment)));
  await go(b, "CANCEL_CONFIRM", { ...ctx, action: "cancel", group: groupOf(appointment), pendingId: appointment.id, candidates: undefined });
}

async function handleCancelConfirm(b: Bot, selection: Selection): Promise<void> {
  const ctx = ctxOf(b);
  const appointment = ctx.pendingId ? await loadActive(b, ctx.pendingId) : null;
  if (!appointment) {
    await say(b, "bot_appointment_inactive", t.APPOINTMENT_INACTIVE);
    return end(b, "blocked", { reason: "inactive" });
  }
  const answer = yesNo(selection);
  const { phrase, end: ending } = words(appointment);
  if (answer === null) {
    await say(b, "bot_not_understood", t.NOT_UNDERSTOOD_YES_NO);
    return say(b, "bot_cancel_confirm", t.confirmCancel(phrase, appointment.patientName, when(b, appointment)));
  }
  if (answer) {
    const canceled = await cancelAppointment(b.db, b.clinicId, appointment.id, { channel: "whatsapp_bot", actorId: null }, b.now);
    if (!canceled) {
      await say(b, "bot_appointment_inactive", t.APPOINTMENT_INACTIVE);
      return end(b, "blocked", { reason: "inactive" });
    }
    await say(
      b,
      "bot_cancel_done",
      textFor(b, "cancel_done", t.cancelDone(phrase, ending, appointment.patientName, when(b, appointment), groupOf(appointment)), {
        atendimento: phrase,
        paciente: appointment.patientName,
        data: when(b, appointment),
      }),
    );
    return end(b, "canceled", { appointment_id: appointment.id });
  }
  // "Não" pelo lembrete, sem presença confirmada: pergunta se confirma (presença é um ato explícito).
  const confirmed = await presenceConfirmed(b, appointment.id);
  if (ctx.fromReminder && !confirmed) {
    await sendButtons(b, "bot_cancel_kept", t.keptAskPresence(phrase, ending), t.YES_NO_BUTTONS);
    await step(b, "declined");
    return go(b, "PRESENCE_CONFIRM", { action: "cancel", group: ctx.group, pendingId: appointment.id } satisfies ManageContext);
  }
  await say(b, "bot_cancel_kept", t.cancelKept(phrase, ending));
  await end(b, "declined");
}

async function presenceConfirmed(b: Bot, id: string): Promise<boolean> {
  const row = unwrap(await b.db.from("appointments").select("patient_confirmed_at").eq("clinic_id", b.clinicId).eq("id", id).maybeSingle(), "Atendimento");
  return !!row?.patient_confirmed_at;
}

async function handlePresenceConfirm(b: Bot, selection: Selection): Promise<void> {
  const ctx = ctxOf(b);
  const answer = yesNo(selection, t.YES_NO_IDS);
  if (answer === null) {
    await sendButtons(b, "bot_not_understood", t.PRESENCE_NOT_UNDERSTOOD, t.YES_NO_BUTTONS);
    return;
  }
  await go(b, "WELCOME");
  if (!answer) return say(b, "bot_kept_presence_declined", t.KEPT_PRESENCE_DECLINED);
  await confirmPresence(b, ctx.pendingId ?? "");
}

/** Mesmo registro do botão "Confirmar presença" do lembrete. */
async function confirmPresence(b: Bot, appointmentId: string): Promise<void> {
  const result = await recordReminderTap(b.db, b.clinicId, { button: "confirm", appointmentId, phone: b.phone, waMessageId: b.incomingId }, b.now);
  if (result.result === "inactive") return say(b, "bot_appointment_inactive", t.APPOINTMENT_INACTIVE);
  const { appointment } = result;
  const whenLabel = formatAppointmentWhen(appointment.scheduledAt, b.clinic.timeZone);
  if (!result.confirmedNow) return say(b, "bot_presence_already_confirmed", t.presenceAlreadyConfirmed(appointment.patientName, whenLabel));
  const isExam = appointment.serviceCategory === "exam";
  const custom = textFor(b, "presence_confirmed", "", { paciente: appointment.patientName, data: whenLabel });
  // Texto próprio: o lembrete do preparo do exame continua indo junto.
  const body = custom
    ? `${custom}${isExam ? "\n\nLembre-se de seguir as orientações de preparo do exame que enviamos anteriormente." : ""}`
    : t.presenceConfirmed(appointment.patientName, whenLabel, isExam);
  await say(b, "bot_presence_confirmed", body);
}

// ---------------------------------------------------------------------------
// Remarcar
// ---------------------------------------------------------------------------

async function rescheduleLink(b: Bot, ctx: ManageContext, appointment: ManagedAppointment, homeAddress?: string): Promise<void> {
  // Retorno: o prazo é o da consulta de origem; vencido, a página não teria datas (piloto, Fase 17).
  if (appointment.category === "return_visit" && appointment.originAppointmentId) {
    const origin = await findReturnOrigin(
      b.db,
      b.clinicId,
      { patientId: appointment.patientId, agendaId: appointment.agendaId, returnServiceId: appointment.serviceId, originAppointmentId: appointment.originAppointmentId },
      b.now,
    );
    if (origin?.lastDate && b.clinic.today > origin.lastDate) {
      await say(b, "bot_reschedule_return_deadline_passed", t.returnDeadlinePassed(appointment.patientName, formatBirthdate(origin.lastDate)));
      return end(b, "blocked", { reason: "return_deadline_passed" });
    }
  }
  // Domiciliar: sempre reconfirma o endereço (piloto, Fase 16).
  if (appointment.locationType === "home_visit" && homeAddress === undefined) {
    const current = appointment.homeVisitAddress;
    const next: ManageContext = { ...ctx, action: "reschedule", pendingId: appointment.id, candidates: undefined };
    if (current) {
      await say(b, "bot_reschedule_home_address_confirm_current", t.homeAddressConfirmCurrent(current));
      return go(b, "RESCHEDULE_HOME_ADDRESS", { ...next, awaiting: "address_current", pendingAddress: current });
    }
    await say(b, "bot_reschedule_home_address_ask", t.HOME_ADDRESS_ASK);
    return go(b, "RESCHEDULE_HOME_ADDRESS", { ...next, awaiting: "address_input" });
  }
  try {
    const link = await createBookingLink(
      b.db,
      b.clinicId,
      {
        mode: "reschedule",
        contactId: b.convo.contactId!,
        patientId: appointment.patientId,
        serviceId: appointment.serviceId,
        agendaId: appointment.agendaId,
        locationId: null,
        locationCategory: appointment.locationType,
        appointmentId: appointment.id,
        originAppointmentId: appointment.originAppointmentId,
        contactPhone: b.phone,
        homeVisitAddress: homeAddress ?? null,
        funnelSessionId: b.convo.funnelSessionId,
        ttlMs: BOT_LINK_TTL_MS,
      },
      b.now,
    );
    await say(b, "bot_reschedule_link", t.rescheduleLink(words(appointment).phrase, appointment.patientName, `${b.sender.baseUrl}/agendar/${link.id}`));
    await end(b, "link_sent", { booking_link_id: link.id });
  } catch (error) {
    console.error("[bot] link de remarcação", error instanceof Error ? error.message : String(error));
    await say(b, "bot_reschedule_link_error", t.LINK_ERROR);
    await end(b, "error", { reason: "link_error" });
  }
}

async function handleRescheduleAddress(b: Bot, selection: Selection): Promise<void> {
  const ctx = ctxOf(b);
  const appointment = ctx.pendingId ? await loadActive(b, ctx.pendingId) : null;
  if (!appointment) {
    await say(b, "bot_appointment_inactive", t.APPOINTMENT_INACTIVE);
    return end(b, "blocked", { reason: "inactive" });
  }
  if (ctx.awaiting === "address_input") {
    const address = selection.text.trim();
    if (!address) return say(b, "bot_reschedule_home_address_ask", t.HOME_ADDRESS_ASK);
    await say(b, "bot_reschedule_home_address_confirm_new", t.homeAddressConfirmNew(address));
    return go(b, "RESCHEDULE_HOME_ADDRESS", { ...ctx, awaiting: "address_new", pendingAddress: address });
  }
  const answer = yesNo(selection);
  const address = ctx.pendingAddress ?? "";
  if (answer === null) {
    await say(b, "bot_not_understood", t.NOT_UNDERSTOOD_YES_NO);
    return say(b, "bot_reschedule_home_address_confirm", ctx.awaiting === "address_current" ? t.homeAddressConfirmCurrent(address) : t.homeAddressConfirmNew(address));
  }
  if (!answer) {
    await say(b, "bot_reschedule_home_address_ask", t.HOME_ADDRESS_ASK);
    return go(b, "RESCHEDULE_HOME_ADDRESS", { ...ctx, awaiting: "address_input", pendingAddress: undefined });
  }
  // Endereço novo vira o padrão do contato (piloto).
  if (ctx.awaiting === "address_new" && b.convo.contactId) {
    unwrap(await b.db.from("contacts").update({ default_home_address: address }).eq("clinic_id", b.clinicId).eq("id", b.convo.contactId), "Contato");
  }
  await rescheduleLink(b, ctx, appointment, address);
}

// ---------------------------------------------------------------------------
// Botões do lembrete (Fase 19)
// ---------------------------------------------------------------------------

export const reminderTapOf = (msg: WaMessage) => parseReminderTap(msg.button?.payload ?? msg.interactive?.button_reply?.id);

/**
 * Toque num botão do lembrete, em qualquer ponto da conversa. Confirmar vale
 * até com o bot pausado; Remarcar e Cancelar respeitam a pausa (a recepção
 * vê o toque no app).
 */
export async function handleReminderTap(b: Bot, tap: NonNullable<ReturnType<typeof reminderTapOf>>, paused: boolean): Promise<void> {
  if (tap.button === "confirm") return confirmPresence(b, tap.appointmentId);
  const result = await recordReminderTap(b.db, b.clinicId, { button: tap.button, appointmentId: tap.appointmentId, phone: b.phone, waMessageId: b.incomingId }, b.now);
  if (paused) return;
  if (result.result === "inactive") {
    await say(b, "bot_appointment_inactive", t.APPOINTMENT_INACTIVE);
    return showMenu(b);
  }
  const appointment = await loadActive(b, tap.appointmentId);
  if (!appointment) {
    await say(b, "bot_appointment_inactive", t.APPOINTMENT_INACTIVE);
    return showMenu(b);
  }
  const group = groupOf(appointment);
  const flow = tap.button === "cancel" ? "cancel" : "reschedule";
  await openFunnel(b, flow, { category: group, source: "reminder" });
  const ctx: ManageContext = { action: flow, group, fromReminder: true };
  if (flow === "cancel") return askCancel(b, ctx, appointment);
  await rescheduleLink(b, ctx, appointment);
}

// ---------------------------------------------------------------------------
// Encaixe ou antecipar (lista de espera, Fase 25)
// ---------------------------------------------------------------------------

async function handleWaitlistAppointment(b: Bot, appointment: ManagedAppointment): Promise<void> {
  const { phrase, end: ending } = words(appointment);
  try {
    const inList = (await activeWaitlistAppointmentIds(b.db, b.clinicId, [appointment.id])).has(appointment.id);
    if (inList) {
      await sendButtons(b, "bot_waitlist_already_in", t.waitlistAlreadyIn(appointment.patientName, phrase, ending, when(b, appointment)), t.WAITLIST_ALREADY_BUTTONS);
      return go(b, "WAITLIST_LEAVE_CONFIRM", { action: "waitlist", group: groupOf(appointment), pendingId: appointment.id } satisfies ManageContext);
    }
    // Horário livre antes: oferece antecipar; a lista é só para quando não há (cliente, 08/out).
    const slots = await earlierSlots(b, appointment);
    if (slots.length) return showEarlier(b, appointment, slots);
    await joinAndSay(b, appointment);
  } catch (error) {
    console.error("[bot] lista de espera", error instanceof Error ? error.message : String(error));
    await say(b, "bot_waitlist_error", t.WAITLIST_ERROR);
  }
  await go(b, "WELCOME");
}

async function joinAndSay(b: Bot, appointment: ManagedAppointment): Promise<void> {
  const { phrase, end: ending } = words(appointment);
  await joinWaitlist(b.db, b.clinicId, appointment.id, { via: "whatsapp_bot", actorId: null }, b.now);
  await say(b, "bot_waitlist_joined", t.waitlistJoined(appointment.patientName, phrase, ending, when(b, appointment)));
}

// ---------------------------------------------------------------------------
// Antecipar para um horário livre (antes de entrar na lista)
// ---------------------------------------------------------------------------

const EARLIER_SLOTS = 3;

/** Horário livre oferecido; `place` só quando há mais de um local do mesmo tipo. */
type EarlierSlot = { start: string; locationId: string; place: string | null };

type EarlierContext = ManageContext & { slots: EarlierSlot[]; chosen?: EarlierSlot; step: "slot_choice" | "slot_confirm" | "join_confirm" };

/**
 * Até 3 horários livres antes do atendimento, do mais cedo: mesma agenda,
 * mesmo serviço e mesmo tipo de local, com a folga mínima da lista de espera.
 */
async function earlierSlots(b: Bot, appointment: ManagedAppointment): Promise<EarlierSlot[]> {
  const locations = unwrap(await b.db.from("locations").select("id, name, type").eq("clinic_id", b.clinicId).eq("is_active", true), "Locais");
  const sameKind = new Map(locations.filter((l) => l.type === appointment.locationType).map((l) => [l.id, l.name]));
  const slots = await getFreeSlotsBefore(
    b.db,
    b.clinicId,
    {
      serviceId: appointment.serviceId,
      agendaId: appointment.agendaId,
      ignoreAppointmentId: appointment.id,
      from: new Date(b.now.getTime() + MIN_LEAD_MS),
      before: appointment.scheduledAt,
      limit: EARLIER_SLOTS,
      accept: (slot) => sameKind.has(slot.locationId),
    },
    b.now,
  );
  const showPlace = appointment.locationType !== "home_visit" && sameKind.size > 1;
  return slots.map((slot) => ({ start: slot.start.toISOString(), locationId: slot.locationId, place: showPlace ? (sameKind.get(slot.locationId) ?? null) : null }));
}

const slotWhen = (b: Bot, slot: EarlierSlot) => formatAppointmentWhen(new Date(slot.start), b.clinic.timeZone);
/** "seg, 19/10 às 08:00": cabe no título da linha da lista (24 caracteres). */
const slotLabel = (b: Bot, slot: EarlierSlot) => slotWhen(b, slot).replace(/^([^,]{3})[^,]*,/u, "$1,");
const slotId = (slot: EarlierSlot) => `slot_${slot.start}_${slot.locationId}`;

async function showEarlier(b: Bot, appointment: ManagedAppointment, slots: EarlierSlot[]): Promise<void> {
  const { phrase, end: ending } = words(appointment);
  await sendList(
    b,
    "bot_waitlist_earlier",
    t.waitlistEarlier(appointment.patientName, phrase, ending, when(b, appointment)),
    t.numberedList([
      ...slots.map((slot) => ({ id: slotId(slot), label: slotLabel(b, slot), description: slot.place })),
      { id: t.WAITLIST_IDS.noneOfThese, label: t.NONE_OF_THESE },
    ]),
  );
  await go(b, "WAITLIST_EARLIER", { action: "waitlist", group: groupOf(appointment), pendingId: appointment.id, slots, step: "slot_choice" } satisfies EarlierContext);
}

async function askJoin(b: Bot, ctx: EarlierContext, appointment: ManagedAppointment): Promise<void> {
  await sendButtons(b, "bot_waitlist_ask_join", t.askJoinWaitlist(when(b, appointment)), t.YES_NO_BUTTONS);
  await go(b, "WAITLIST_EARLIER", { ...ctx, chosen: undefined, step: "join_confirm" } satisfies EarlierContext);
}

const askAdvance = (b: Bot, appointment: ManagedAppointment, slot: EarlierSlot) =>
  sendButtons(b, "bot_waitlist_confirm_advance", t.confirmAdvance(words(appointment).phrase, appointment.patientName, when(b, appointment), slotWhen(b, slot)), t.YES_NO_BUTTONS);

async function handleEarlier(b: Bot, selection: Selection): Promise<void> {
  const ctx = b.convo.context as EarlierContext;
  const appointment = ctx.pendingId ? await loadActive(b, ctx.pendingId) : null;
  if (!appointment) {
    await go(b, "WELCOME");
    return say(b, "bot_appointment_inactive", t.APPOINTMENT_INACTIVE);
  }

  if (ctx.step === "slot_choice") {
    const none = { id: t.WAITLIST_IDS.noneOfThese } as const;
    const choice = pick<EarlierSlot | typeof none>(selection, [...ctx.slots, none], (item) => ("start" in item ? slotId(item) : item.id));
    if (!choice) {
      await say(b, "bot_not_understood", textFor(b, "not_understood", t.notUnderstood()));
      return showEarlier(b, appointment, ctx.slots);
    }
    if (!("start" in choice)) return askJoin(b, ctx, appointment);
    await askAdvance(b, appointment, choice);
    return go(b, "WAITLIST_EARLIER", { ...ctx, chosen: choice, step: "slot_confirm" } satisfies EarlierContext);
  }

  const answer = yesNo(selection, t.YES_NO_IDS);
  if (answer === null) {
    await say(b, "bot_not_understood", t.NOT_UNDERSTOOD_YES_NO);
    if (ctx.step === "join_confirm") return askJoin(b, ctx, appointment);
    return ctx.chosen ? askAdvance(b, appointment, ctx.chosen) : showEarlier(b, appointment, ctx.slots);
  }

  if (ctx.step === "join_confirm") {
    await go(b, "WELCOME");
    if (!answer) return say(b, "bot_waitlist_join_declined", t.offerDeclined(appointment.patientName, when(b, appointment), false));
    try {
      await joinAndSay(b, appointment);
    } catch (error) {
      console.error("[bot] lista de espera", error instanceof Error ? error.message : String(error));
      await say(b, "bot_waitlist_error", t.WAITLIST_ERROR);
    }
    return;
  }

  if (!answer || !ctx.chosen) return showEarlier(b, appointment, ctx.slots);
  const to = new Date(ctx.chosen.start);
  try {
    await rescheduleAppointment(b.db, b.clinicId, appointment.id, { start: to, locationId: ctx.chosen.locationId, channel: "whatsapp_bot", actorId: null }, b.now);
  } catch (error) {
    if (!(error instanceof DataError) || error.code === "unexpected") throw error;
    // Ocupado entre a escolha e o "Sim": procura de novo (cliente, 08/out).
    await say(b, "bot_waitlist_slot_taken", t.SLOT_TAKEN);
    const slots = await earlierSlots(b, appointment);
    return slots.length ? showEarlier(b, appointment, slots) : askJoin(b, { ...ctx, slots: [] }, appointment);
  }
  await go(b, "WELCOME");
  await say(b, "bot_waitlist_advanced", t.offerAccepted(appointment.patientName, formatAppointmentWhen(to, b.clinic.timeZone)));
  // Como na resposta à oferta de vaga: o aviso de remarcação sai pelo template.
  await sendAppointmentNotice(b.db, b.clinicId, appointment.id, "reschedule", b.sender, b.now);
}

async function handleWaitlistLeave(b: Bot, selection: Selection): Promise<void> {
  const ctx = ctxOf(b);
  const text = selection.text.toLowerCase();
  const leave = selection.id === t.WAITLIST_IDS.leave || text === "1" || text.startsWith("sair");
  const stay = selection.id === t.WAITLIST_IDS.stay || text === "2" || text.startsWith("continuar");
  if (!leave && !stay) {
    await say(b, "bot_not_understood", textFor(b, "not_understood", t.notUnderstood()));
    return;
  }
  const appointment = ctx.pendingId ? await loadActive(b, ctx.pendingId) : null;
  await go(b, "WELCOME");
  if (!appointment) return say(b, "bot_appointment_inactive", t.APPOINTMENT_INACTIVE);
  if (stay) return say(b, "bot_waitlist_stay", t.waitlistStay(appointment.patientName));
  await leaveWaitlist(b.db, b.clinicId, appointment.id, { channel: "whatsapp_bot", actorId: null }, b.now);
  const { phrase, end: ending } = words(appointment);
  await say(b, "bot_waitlist_left", t.waitlistLeft(appointment.patientName, phrase, ending, when(b, appointment)));
}

/** Sem nada marcado: oferece marcar; ao confirmar pela página, entra na lista sozinho. */
async function offerBooking(b: Bot, ctx: ManageContext): Promise<void> {
  const catalog = await b.catalog();
  const buttons =
    ctx.group === "exam"
      ? [t.button(t.WAITLIST_IDS.bookExam, "Marcar exame")]
      : [
          ...(servicesOf(catalog, "consultation").length ? [t.button(t.WAITLIST_IDS.bookConsultation, "Marcar consulta")] : []),
          ...(servicesOf(catalog, "return_visit").length ? [t.button(t.WAITLIST_IDS.bookReturn, "Marcar retorno")] : []),
        ];
  await sendButtons(b, "bot_waitlist_no_appointment", t.waitlistNoAppointment(ctx.group), [...buttons, t.button("back_to_menu", "Voltar ao menu")]);
  await go(b, "WAITLIST_SELECT", { ...ctx, awaiting: "book_choice" });
}

async function handleBookChoice(b: Bot, selection: Selection): Promise<void> {
  const ctx = ctxOf(b);
  if (selection.id === t.WAITLIST_IDS.bookConsultation) return startBooking(b, "consultation", { joinWaitlist: true });
  if (selection.id === t.WAITLIST_IDS.bookReturn) return startReturn(b, { joinWaitlist: true });
  if (selection.id === t.WAITLIST_IDS.bookExam) return startBooking(b, "exam", { joinWaitlist: true });
  await say(b, "bot_not_understood", textFor(b, "not_understood", t.notUnderstood()));
  await offerBooking(b, ctx);
}

// ---------------------------------------------------------------------------
// Resposta à oferta de vaga (Fase 25): "waitlist:<yes|no>:<offer_id>"
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function offerTapOf(msg: WaMessage): { answer: "yes" | "no"; offerId: string } | null {
  const [prefix, answer, offerId] = (msg.button?.payload ?? msg.interactive?.button_reply?.id ?? "").split(":");
  if (prefix !== "waitlist" || (answer !== "yes" && answer !== "no") || !offerId || !UUID_RE.test(offerId)) return null;
  return { answer, offerId };
}

/** Quem recusa passa a vaga ao próximo; o envio da oferta é rotina da F7 (até lá, não sai). */
const offerSenderUntilF7: OfferSender = async () => ({ sent: false, reason: "envio da oferta de vaga entra na F7" });

function offerReply(b: Bot, result: OfferReplyResult): string {
  const at = (date: Date) => formatAppointmentWhen(date, b.clinic.timeZone);
  switch (result.kind) {
    case "accepted":
      return t.offerAccepted(result.patientName, at(result.to));
    case "declined":
      return t.offerDeclined(result.patientName, at(result.currentStart), result.stillInList);
    case "late":
      return t.offerLate(result.stillInList);
    case "taken":
      return t.offerTaken(result.stillInList);
    case "already_accepted":
      return t.OFFER_ALREADY_ACCEPTED;
    case "not_found":
      return t.OFFER_NOT_FOUND;
  }
}

/** Vale em qualquer ponto da conversa, até com o bot pausado: é a resposta a uma pergunta do sistema. */
export async function handleOfferTap(b: Bot, tap: NonNullable<ReturnType<typeof offerTapOf>>): Promise<void> {
  const result =
    tap.answer === "yes"
      ? await acceptOffer(b.db, b.clinicId, tap.offerId, b.convo.contactId, b.now)
      : await declineOffer(b.db, b.clinicId, tap.offerId, b.convo.contactId, offerSenderUntilF7, b.now);
  await say(b, `bot_waitlist_offer_${result.kind}`, offerReply(b, result));
  // Antecipado: o aviso de remarcação sai pelo template, como na tela.
  if (result.kind === "accepted") await sendAppointmentNotice(b.db, b.clinicId, result.appointmentId, "reschedule", b.sender, b.now);
}

// ---------------------------------------------------------------------------
// Falar com a recepção (só com coexistência, até a F8)
// ---------------------------------------------------------------------------

export async function handoff(b: Bot): Promise<void> {
  await say(b, "bot_handoff", textFor(b, "handoff", t.HANDOFF));
  await pauseForHuman(b.db, b.clinicId, b.phone, { contactId: b.convo.contactId, reason: "requested" }, b.now);
}

// ---------------------------------------------------------------------------
// Despacho
// ---------------------------------------------------------------------------

export async function handleManageState(b: Bot, state: string, selection: Selection): Promise<void> {
  switch (state) {
    case "CANCEL_SELECT":
    case "RESCHEDULE_SELECT":
    case "WAITLIST_SELECT":
      return handleSelect(b, selection);
    case "CANCEL_CONFIRM":
      return handleCancelConfirm(b, selection);
    case "PRESENCE_CONFIRM":
      return handlePresenceConfirm(b, selection);
    case "RESCHEDULE_HOME_ADDRESS":
      return handleRescheduleAddress(b, selection);
    case "WAITLIST_EARLIER":
      return handleEarlier(b, selection);
    case "WAITLIST_LEAVE_CONFIRM":
      return handleWaitlistLeave(b, selection);
  }
}
