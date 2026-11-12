import type { Enums } from "../../../supabase/database.types";
import { activeRecessMessage } from "../../agenda/blocks";
import { getReceptionHours } from "../../config/receptionHours";
import { loadClinicHolidays } from "../../agenda/slots";
import { addDays } from "../../../clinicTime";
import { describeOpening, describeReceptionHoursForPatient, isReceptionOpen, nextReceptionOpening } from "../../../receptionHours";
import { unwrap } from "../../errors";
import { contactPatientIds } from "../../patientContacts";
import { acceptOffer, declineOffer, type OfferReplyResult, type OfferSender } from "../../waitlist/offers";
import { markHandoffSubjectAsked, pauseForHuman, setHandoffSubject, startFunnel, type HandoffOrigin } from "../conversations";
import type { WaMessage } from "../meta";
import { sendAppointmentNotice } from "../notices";
import { parseReminderTap, recordReminderTap } from "../reminders";
import { formatAppointmentWhen } from "../templates";
import { askHandoffSubject, end, say, textFor, type Bot } from "./engine";
import * as t from "./texts";
import { sendReminderPortalLink } from "./portalLink";
import { logError } from "../../../log";

// Bot enxuto (F3f, seção 15.6; cliente, 11/nov/2026): cancelar, remarcar e o Encaixe ou antecipar saíram do chat (vão
// pelo portal). Ficam os botões do lembrete (Confirmar presença responde aqui; Remarcar e Cancelar mandam o portal já
// na ação), a resposta à oferta de vaga da lista de espera e "Falar com a recepção".

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
  "id, patient_id, scheduled_at, service_id, agenda_id, home_visit_address, origin_appointment_id, series_id, status, services!inner ( name, category ), locations ( type ), booked_by_contact_id, patients!inner ( full_name, birthdate )";

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
  booked_by_contact_id: string | null;
  patients: { full_name: string; birthdate: string };
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

/**
 * O atendimento, se ainda é do contato, ativo e futuro (revalida a cada passo). Do contato = ele marcou (recebe o
 * lembrete) ou é responsável ligado ao paciente (VR, F3f).
 */
export async function loadActive(b: Bot, id: string): Promise<ManagedAppointment | null> {
  const contactId = b.convo.contactId;
  if (!contactId) return null;
  const row = unwrap(await b.db.from("appointments").select(COLUMNS).eq("clinic_id", b.clinicId).eq("id", id).maybeSingle(), "Atendimento") as unknown as Row | null;
  if (!row) return null;
  if (row.booked_by_contact_id !== contactId && !(await contactPatientIds(b.db, b.clinicId, contactId)).includes(row.patient_id)) return null;
  const appointment = toManaged(row);
  return ["scheduled", "confirmed"].includes(appointment.status) && appointment.scheduledAt > b.now ? appointment : null;
}

// ---------------------------------------------------------------------------
// Confirmar presença
// ---------------------------------------------------------------------------

/**
 * Depois da presença confirmada: o local (nome, endereço e link do Maps) numa mensagem à parte, para o link abrir
 * com prévia. Só local da clínica com endereço (o domiciliar é o endereço do paciente). Falha aqui não desfaz nada.
 */
async function sendLocationAfterConfirm(b: Bot, appointmentId: string): Promise<void> {
  try {
    const row = unwrap(
      await b.db.from("appointments").select("locations ( name, type, address )").eq("clinic_id", b.clinicId).eq("id", appointmentId).maybeSingle(),
      "Atendimento",
    ) as { locations: { name: string; type: Enums<"location_type">; address: string | null } | null } | null;
    const location = row?.locations;
    const address = location?.address?.trim();
    if (!location || location.type !== "clinic" || !address) return;
    await say(b, "bot_presence_location", t.locationAfterConfirm(location.name, address));
  } catch (error) {
    logError("bot: local depois da confirmação", error, { clinica: b.clinicId, atendimento: appointmentId });
  }
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
  await sendLocationAfterConfirm(b, appointment.id);
}

// ---------------------------------------------------------------------------
// Botões do lembrete (Fase 19)
// ---------------------------------------------------------------------------

export const reminderTapOf = (msg: WaMessage) => parseReminderTap(msg.button?.payload ?? msg.interactive?.button_reply?.id);

/**
 * Toque num botão do lembrete, em qualquer ponto da conversa. Confirmar vale até com o bot pausado; Remarcar e
 * Cancelar respeitam a pausa (a recepção vê o toque no app) e mandam o portal já na ação (o portal mostra os pacientes
 * ligados ao número e avisa quem marcou, VR4). Sem o portal (F3-5/F3-7): a recepção.
 */
export async function handleReminderTap(b: Bot, tap: NonNullable<ReturnType<typeof reminderTapOf>>, paused: boolean): Promise<void> {
  if (tap.button === "confirm") return confirmPresence(b, tap.appointmentId);
  const result = await recordReminderTap(b.db, b.clinicId, { button: tap.button, appointmentId: tap.appointmentId, phone: b.phone, waMessageId: b.incomingId }, b.now);
  if (paused) return;
  const appointment = result.result === "inactive" ? null : await loadActive(b, tap.appointmentId);
  if (!appointment) return say(b, "bot_appointment_inactive", t.APPOINTMENT_INACTIVE);
  const flow = tap.button === "cancel" ? "cancel" : "reschedule";
  b.now = new Date(b.now.getTime() + 1);
  const sessionId = await startFunnel(b.db, b.clinicId, b.phone, flow, { category: appointment.category === "exam" ? "exam" : "consultation", source: "reminder" }, b.now);
  b.convo = { ...b.convo, funnelSessionId: sessionId, funnelFlow: flow };
  if (await sendReminderPortalLink(b, flow, appointment)) return;
  await end(b, "blocked", { reason: "no_portal" });
  if (b.receptionAvailable) return handoff(b, "no_portal");
  await say(b, "bot_kb_will_reply", t.willReply(b.clinic.designation));
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
// Falar com a recepção (só com coexistência)
// ---------------------------------------------------------------------------

export async function receptionReplyWhen(b: Bot): Promise<string | null | undefined> {
  const { hours } = await getReceptionHours(b.db, b.clinicId);
  const holidays = await loadClinicHolidays(b.db, b.clinicId, b.clinic.today, addDays(b.clinic.today, 15));
  const timeZone = b.clinic.timeZone;
  const opening = isReceptionOpen(hours, b.now, timeZone, holidays) ? b.now : nextReceptionOpening(hours, b.now, timeZone, holidays);
  return opening === null ? undefined : opening === b.now ? null : describeOpening(opening, b.now, timeZone);
}

/** Aviso de transferência com o horário da recepção (cliente, 01/nov/2026): fora do horário, diz quando responde. */
export async function handoffText(b: Bot, lead?: string): Promise<string> {
  // Recesso da clínica (cliente, 01/nov/2026): a mensagem de recesso substitui o aviso comum.
  const recess = await activeRecessMessage(b.db, b.clinicId, b.now, b.clinic.timeZone);
  if (recess) return recess;
  const base = lead ?? textFor(b, "handoff", t.LEAN_HANDOFF);
  // Fora do horário (BE-4, d): o horário da recepção na mesma mensagem.
  const { hours } = await getReceptionHours(b.db, b.clinicId);
  if ((await receptionReplyWhen(b)) === null) return base;
  const described = describeReceptionHoursForPatient(hours);
  return `${base}\n\n${described ? t.leanOutsideHours(described) : t.LEAN_OUTSIDE_HOURS_NO_HOURS}`;
}

/**
 * Transferência pedida: o aviso e a pausa. Com o motivo já contado (EA, cliente, 02/nov/2026), ele vira o assunto e
 * o bot não pergunta de novo; `lead` troca o aviso padrão (ex.: "Não encontrei uma informação segura…").
 */
export async function handoff(
  b: Bot,
  origin: HandoffOrigin,
  { subject, lead, infoSessionId }: { subject?: string | null; lead?: string; infoSessionId?: string } = {},
): Promise<void> {
  await say(b, "bot_handoff", await handoffText(b, lead));
  await pauseForHuman(b.db, b.clinicId, b.phone, { contactId: b.convo.contactId, reason: "requested", origin, infoSessionId }, b.now);
  if (subject?.trim()) await setHandoffSubject(b.db, b.clinicId, b.phone, subject, b.now);
  // BE-4: o aviso já pede a dúvida; a primeira resposta vira o assunto, sem a pergunta à parte.
  else if (!lead) await markHandoffSubjectAsked(b.db, b.clinicId, b.phone, b.now);
  else await askHandoffSubject(b);
}

/**
 * 4ª mensagem seguida que o bot não entende (F8.5d, cliente, 27/out/2026): a
 * conversa vai para a clínica, com o horário da recepção na mensagem (fora
 * dele, quando a clínica responde). Só com a recepção no app (coexistência).
 */
export async function handoffNotUnderstood(b: Bot): Promise<void> {
  const recess = await activeRecessMessage(b.db, b.clinicId, b.now, b.clinic.timeZone);
  await say(b, "bot_handoff_not_understood", recess ?? t.notUnderstoodHandoff(await receptionReplyWhen(b)));
  await pauseForHuman(b.db, b.clinicId, b.phone, { contactId: b.convo.contactId, reason: "not_understood" }, b.now);
  await askHandoffSubject(b);
}

