import type { SupabaseClient } from "@supabase/supabase-js";
import { logAppointmentEvent } from "./audit";
import { RESCHEDULE_PRESENCE_RESET } from "./presence";
import { getAvailableSlotsForDate } from "./scheduling/getAvailableSlotsForDate";
import { getExamAvailableSlotsForDate } from "./scheduling/getExamAvailableSlotsForDate";
import { getExamNextAvailableDates } from "./scheduling/getExamNextAvailableDates";
import { getNextAvailableDates } from "./scheduling/getNextAvailableDates";
import { getNextAvailableGroupDates } from "./scheduling/getNextAvailableGroupDates";
import { isOverlapError } from "./scheduling/overlap";
import { resolveClinicLocationIds } from "./scheduling/resolveClinicLocationIds";
import type { AvailableSlot } from "./scheduling/slots";
import { sendInteractiveButtonsMessage, sendTemplateMessage } from "./whatsapp/client";
import { TIMEZONE } from "./whatsapp/formatDateTime";
import { isCustomerServiceWindowOpen, sendAppointmentReschedule } from "./whatsapp/notifications";
import { sendAndLog } from "./whatsapp/bot/shared";

// Motor de ofertas da lista de espera (Fase 25 · etapa 3).
//
// Vaga aberta (`waitlist_openings`, gravada pelo gatilho da migração 0038)
// → oferecida a um por vez, por ordem de entrada na lista, com 60 minutos
// para responder. Só é oferecida se (1) começa daqui a mais de 2h,
// (2) o horário ainda está livre e não há nenhum horário livre antes dela do
// mesmo tipo e local (oferecer não ajudaria ninguém) e (3) vai para o
// primeiro da fila cujo atendimento é depois desse horário. Mesmo tipo;
// consulta e retorno no consultório aceitam qualquer clínica, domiciliar só
// domiciliar, exame só o mesmo exame. "Sim" remarca na hora; o horário
// antigo vira outra vaga (cascata, pelo mesmo gatilho).
//
// Mensagem: template `oferta_lista_espera` (env `WHATSAPP_TEMPLATE_WAITLIST_OFFER`,
// etapa 4; corpo igual a `waitlistOfferText`, variáveis {{1}} a {{5}}) com
// os botões Sim/Não; sem template, texto livre com botões só para
// quem falou com o bot nas últimas 24h — os demais são pulados nessa vaga.

export const OFFER_MINUTES = 60;
const MIN_LEAD_MS = 2 * 60 * 60 * 1000;
// Pessoas puladas (sem janela/falha) por rodada, contra laço longo.
const MAX_ATTEMPTS_PER_OPENING = 20;

export type OfferAnswer = "yes" | "no";

export function offerButtonPayload(answer: OfferAnswer, offerId: string): string {
  return `waitlist:${answer}:${offerId}`;
}

interface OpeningRow {
  id: string;
  opened_by_appointment_id: string | null;
  appointment_type: "first_visit" | "return_visit" | "exam";
  exam_type_id: string | null;
  is_group_session: boolean;
  slot_scheduled_at: string;
  slot_clinic_location_id: string;
  slot_duration_minutes: number;
  status: string;
}

const OPENING_COLUMNS =
  "id, opened_by_appointment_id, appointment_type, exam_type_id, is_group_session, slot_scheduled_at, slot_clinic_location_id, slot_duration_minutes, status";

interface LocationInfo {
  id: string;
  name: string;
  type: string;
  address: string | null;
}

// --- rodada completa (rota do agendador) ------------------------------------

export interface WaitlistRunTotals {
  expired: number;
  closedEntries: number;
  offered: number;
  skipped: number;
  closedOpenings: number;
}

export async function processWaitlist(supabase: SupabaseClient): Promise<WaitlistRunTotals> {
  const totals: WaitlistRunTotals = { expired: 0, closedEntries: 0, offered: 0, skipped: 0, closedOpenings: 0 };

  // 1. Ofertas vencidas (60 min sem resposta): a vaga volta para a fila.
  const { data: expired } = await supabase
    .from("waitlist_offers")
    .update({ status: "expired" })
    .eq("status", "pending")
    .lte("expires_at", new Date().toISOString())
    .select("opening_id");
  totals.expired = expired?.length ?? 0;
  const reopen = [...new Set((expired ?? []).map((row) => row.opening_id as string | null).filter(Boolean))] as string[];
  if (reopen.length) {
    await supabase
      .from("waitlist_openings")
      .update({ status: "open", updated_at: new Date().toISOString() })
      .in("id", reopen)
      .eq("status", "offering");
  }

  // 2. Atendimento que já passou sem desfecho registrado sai da lista.
  totals.closedEntries = await closePastEntries(supabase);

  // 3. Vagas aguardando oferta.
  const { data: openings } = await supabase
    .from("waitlist_openings")
    .select("id")
    .eq("status", "open")
    .order("created_at")
    .limit(20);
  for (const opening of openings ?? []) {
    const result = await advanceOpening(supabase, opening.id as string);
    totals.offered += result.offered ? 1 : 0;
    totals.skipped += result.skipped;
    totals.closedOpenings += result.closed ? 1 : 0;
  }
  return totals;
}

async function closePastEntries(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase
    .from("waitlist_entries")
    .select("id, appointments!inner ( scheduled_at )")
    .eq("status", "active")
    .lt("appointments.scheduled_at", new Date().toISOString());
  const ids = (data ?? []).map((row) => row.id as string);
  if (!ids.length) return 0;
  await supabase
    .from("waitlist_entries")
    .update({ status: "closed", ended_at: new Date().toISOString(), ended_reason: "past" })
    .in("id", ids)
    .eq("status", "active");
  return ids.length;
}

// --- uma vaga ------------------------------------------------------------------

interface AdvanceResult {
  offered: boolean;
  skipped: number;
  closed: boolean;
}

/** Oferece a vaga ao próximo da fila, ou encerra a vaga. */
export async function advanceOpening(supabase: SupabaseClient, openingId: string): Promise<AdvanceResult> {
  const result: AdvanceResult = { offered: false, skipped: 0, closed: false };

  // Reserva a vaga (open → offering): duas rodadas ao mesmo tempo não
  // oferecem a mesma vaga duas vezes.
  const { data: claimed } = await supabase
    .from("waitlist_openings")
    .update({ status: "offering", updated_at: new Date().toISOString() })
    .eq("id", openingId)
    .eq("status", "open")
    .select(OPENING_COLUMNS)
    .maybeSingle();
  if (!claimed) return result;
  const opening = claimed as OpeningRow;

  const close = async (reason: string) => {
    await supabase
      .from("waitlist_openings")
      .update({ status: "closed", closed_reason: reason, updated_at: new Date().toISOString() })
      .eq("id", opening.id);
    result.closed = true;
    return result;
  };

  const slotStart = new Date(opening.slot_scheduled_at);
  if (slotStart.getTime() - Date.now() <= MIN_LEAD_MS) return close("too_late");

  const location = await fetchLocation(supabase, opening.slot_clinic_location_id);
  if (!location) return close("slot_unavailable");

  const availability = await checkAvailability(supabase, opening, location);
  if (availability !== "ok") return close(availability);

  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_OPENING; attempt++) {
    const candidate = await findCandidate(supabase, opening, location);
    if (!candidate) return close("no_candidates");

    const sent = await sendOffer(supabase, opening, location, candidate);
    if (sent) {
      result.offered = true;
      return result;
    }
    result.skipped += 1;
  }

  // Muitas pessoas puladas nesta rodada: devolve a vaga para a próxima.
  await supabase
    .from("waitlist_openings")
    .update({ status: "open", updated_at: new Date().toISOString() })
    .eq("id", opening.id);
  return result;
}

async function fetchLocation(supabase: SupabaseClient, id: string): Promise<LocationInfo | null> {
  const { data } = await supabase.from("clinic_locations").select("id, name, type, address").eq("id", id).maybeSingle();
  return (data as LocationInfo | null) ?? null;
}

// --- regra da vaga: ainda livre e sem horário livre antes ---------------------

function fortalezaDate(date: Date): string {
  return new Date(date.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

type AvailabilityResult = "ok" | "slot_unavailable" | "earlier_free";

async function checkAvailability(
  supabase: SupabaseClient,
  opening: OpeningRow,
  location: LocationInfo
): Promise<AvailabilityResult> {
  const slotStart = new Date(opening.slot_scheduled_at);
  const slotDate = fortalezaDate(slotStart);
  const earliestUseful = Date.now() + MIN_LEAD_MS;

  // Turma de exame: a vaga é um lugar na turma.
  if (opening.appointment_type === "exam" && opening.is_group_session && opening.exam_type_id) {
    const sessions = await getNextAvailableGroupDates({ supabase, examTypeId: opening.exam_type_id, count: 60 });
    const starts = sessions.map((session) => new Date(`${session.date}T${session.startTime}:00-03:00`).getTime());
    if (!starts.includes(slotStart.getTime())) return "slot_unavailable";
    return starts.some((start) => start > earliestUseful && start < slotStart.getTime()) ? "earlier_free" : "ok";
  }

  let dates: string[];
  let slotsFor: (date: string) => Promise<AvailableSlot[]>;

  if (opening.appointment_type === "exam") {
    if (!opening.exam_type_id) return "slot_unavailable";
    const { data: exam } = await supabase
      .from("exam_types")
      .select("duration_minutes")
      .eq("id", opening.exam_type_id)
      .maybeSingle();
    if (!exam) return "slot_unavailable";
    const examTypeId = opening.exam_type_id;
    const params = { supabase, examTypeId, examLocationId: location.id, examDurationMinutes: exam.duration_minutes as number };
    dates = (await getExamNextAvailableDates({ ...params, count: 60 })).map((d) => d.date);
    slotsFor = (date) => getExamAvailableSlotsForDate({ ...params, date });
  } else {
    // Consultório: qualquer clínica (ajuste do cliente); domiciliar: só domiciliar.
    const category = location.type === "home_visit" ? "home_visit" : "clinic";
    const clinicLocationIds = await resolveClinicLocationIds(supabase, category);
    const appointmentType = opening.appointment_type;
    dates = (
      await getNextAvailableDates({ supabase, clinicLocationIds, appointmentType, count: 60, lastDate: slotDate })
    ).map((d) => d.date);
    slotsFor = (date) => getAvailableSlotsForDate({ supabase, clinicLocationIds, date, appointmentType });
  }

  for (const date of dates) {
    if (date > slotDate) break;
    const slots = await slotsFor(date);
    if (slots.some((slot) => slot.start.getTime() > earliestUseful && slot.start.getTime() < slotStart.getTime())) {
      return "earlier_free";
    }
  }

  const sameDay = dates.includes(slotDate) ? await slotsFor(slotDate) : [];
  const stillFree = sameDay.some(
    (slot) => slot.start.getTime() === slotStart.getTime() && slot.clinicLocationId === location.id
  );
  return stillFree ? "ok" : "slot_unavailable";
}

// --- próximo da fila ----------------------------------------------------------

interface Candidate {
  entryId: string;
  appointmentId: string;
  appointmentType: "first_visit" | "return_visit" | "exam";
  examTypeId: string | null;
  scheduledAt: string;
  patientName: string;
  guardianId: string;
  guardianName: string;
  guardianPhone: string | null;
}

async function findCandidate(
  supabase: SupabaseClient,
  opening: OpeningRow,
  location: LocationInfo
): Promise<Candidate | null> {
  const [{ data: entries }, { data: offered }] = await Promise.all([
    supabase
      .from("waitlist_entries")
      .select(
        "id, created_at, appointments!inner ( id, status, scheduled_at, appointment_type, exam_type_id, clinic_locations ( type ), patients ( full_name, guardian_id, guardians ( full_name, phone ) ) )"
      )
      .eq("status", "active")
      .order("created_at"),
    supabase.from("waitlist_offers").select("entry_id").eq("opening_id", opening.id),
  ]);
  const alreadyOffered = new Set((offered ?? []).map((row) => row.entry_id as string));
  const slotTime = new Date(opening.slot_scheduled_at).getTime();
  const wantsClinic = location.type !== "home_visit";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const entry of (entries ?? []) as any[]) {
    const appointment = entry.appointments;
    if (!appointment || alreadyOffered.has(entry.id)) continue;
    if (appointment.id === opening.opened_by_appointment_id) continue;
    if (!["scheduled", "confirmed"].includes(appointment.status)) continue;
    if (new Date(appointment.scheduled_at).getTime() <= slotTime) continue;
    if (appointment.appointment_type !== opening.appointment_type) continue;
    if (opening.appointment_type === "exam") {
      if (appointment.exam_type_id !== opening.exam_type_id) continue;
    } else {
      const candidateHome = appointment.clinic_locations?.type === "home_visit";
      if (candidateHome === wantsClinic) continue;
    }
    const patient = appointment.patients;
    const guardian = patient?.guardians;
    if (!patient?.guardian_id) continue;
    return {
      entryId: entry.id,
      appointmentId: appointment.id,
      appointmentType: appointment.appointment_type,
      examTypeId: appointment.exam_type_id ?? null,
      scheduledAt: appointment.scheduled_at,
      patientName: patient.full_name,
      guardianId: patient.guardian_id,
      guardianName: guardian?.full_name ?? "",
      guardianPhone: guardian?.phone ?? null,
    };
  }
  return null;
}

// --- oferta -------------------------------------------------------------------

function hourLabel(date: Date): string {
  const [hours, minutes] = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .split(":");
  return `${Number(hours)}h${minutes === "00" ? "" : minutes}`;
}

/** "hoje às 16h", "amanhã às 9h30" ou "sex 09/10 às 10h". */
export function relativeWhenLabel(date: Date, now = new Date()): string {
  const day = fortalezaDate(date);
  const today = fortalezaDate(now);
  const tomorrow = fortalezaDate(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const time = hourLabel(date);
  if (day === today) return `hoje às ${time}`;
  if (day === tomorrow) return `amanhã às ${time}`;
  const weekday = new Intl.DateTimeFormat("pt-BR", { timeZone: TIMEZONE, weekday: "short" })
    .format(date)
    .replace(".", "");
  const [, month, dayOfMonth] = day.split("-");
  return `${weekday} ${dayOfMonth}/${month} às ${time}`;
}

async function typeWord(
  supabase: SupabaseClient,
  appointmentType: string,
  examTypeId: string | null
): Promise<{ word: string; examName: string | null }> {
  if (appointmentType === "first_visit") return { word: "consulta", examName: null };
  if (appointmentType === "return_visit") return { word: "retorno", examName: null };
  const { data } = examTypeId
    ? await supabase.from("exam_types").select("name").eq("id", examTypeId).maybeSingle()
    : { data: null };
  const examName = (data?.name as string | undefined) ?? null;
  return { word: examName ? `exame ${examName}` : "exame", examName };
}

export function waitlistOfferText(params: {
  guardianFirstName: string;
  typeWord: string;
  patientName: string;
  slotLabel: string;
  currentLabel: string;
}): string {
  const greeting = params.guardianFirstName ? `Olá, ${params.guardianFirstName}!` : "Olá!";
  return (
    `${greeting} Abriu uma vaga de ${params.typeWord} para ${params.patientName}: ${params.slotLabel}. ` +
    `É antes do horário marcado (${params.currentLabel}). Quer antecipar? Responda em até ${OFFER_MINUTES} minutos.`
  );
}

/** Registra a oferta e envia. `false` = pessoa pulada (sem janela/falha). */
async function sendOffer(
  supabase: SupabaseClient,
  opening: OpeningRow,
  location: LocationInfo,
  candidate: Candidate
): Promise<boolean> {
  const templateName = import.meta.env.WHATSAPP_TEMPLATE_WAITLIST_OFFER as string | undefined;
  const windowOpen = await isCustomerServiceWindowOpen(supabase, candidate.guardianId);

  const skip = async (reason: string) => {
    await supabase.from("waitlist_offers").insert({
      entry_id: candidate.entryId,
      appointment_id: candidate.appointmentId,
      opening_id: opening.id,
      opened_by_appointment_id: opening.opened_by_appointment_id,
      slot_scheduled_at: opening.slot_scheduled_at,
      slot_clinic_location_id: opening.slot_clinic_location_id,
      slot_duration_minutes: opening.slot_duration_minutes,
      status: "skipped",
      expires_at: new Date().toISOString(),
      details: { reason },
    });
    return false;
  };

  if (!candidate.guardianPhone) return skip("no_phone");
  if (!templateName && !windowOpen) return skip("outside_24h_no_template");

  const { data: offer, error } = await supabase
    .from("waitlist_offers")
    .insert({
      entry_id: candidate.entryId,
      appointment_id: candidate.appointmentId,
      opening_id: opening.id,
      opened_by_appointment_id: opening.opened_by_appointment_id,
      slot_scheduled_at: opening.slot_scheduled_at,
      slot_clinic_location_id: opening.slot_clinic_location_id,
      slot_duration_minutes: opening.slot_duration_minutes,
      expires_at: new Date(Date.now() + OFFER_MINUTES * 60_000).toISOString(),
    })
    .select("id")
    .single();
  if (error || !offer) {
    console.error("[lista de espera] erro ao registrar oferta:", error?.message);
    return false;
  }

  const { word } = await typeWord(supabase, opening.appointment_type, opening.exam_type_id);
  const slotStart = new Date(opening.slot_scheduled_at);
  // Consultório: a vaga pode ser em outra clínica — diz qual.
  const slotLabel = `${relativeWhenLabel(slotStart)}${location.type === "clinic" ? `, na ${location.name}` : ""}`;
  const params = {
    guardianFirstName: candidate.guardianName.trim().split(/\s+/)[0] ?? "",
    typeWord: word,
    patientName: candidate.patientName,
    slotLabel,
    currentLabel: relativeWhenLabel(new Date(candidate.scheduledAt)),
  };
  const body = waitlistOfferText(params);
  const phone = candidate.guardianPhone;
  const yes = offerButtonPayload("yes", offer.id);
  const no = offerButtonPayload("no", offer.id);

  let messageId: string | null = null;
  try {
    // Conversa aberta: texto livre com botões (mais legível); fechada:
    // template aprovado.
    const sent =
      windowOpen || !templateName
        ? await sendInteractiveButtonsMessage({
            to: phone,
            bodyText: body,
            buttons: [
              { id: yes, title: "Sim, quero antecipar" },
              { id: no, title: "Não, manter horário" },
            ],
          })
        : await sendTemplateMessage({
            to: phone,
            templateName,
            languageCode: (import.meta.env.WHATSAPP_TEMPLATE_LANGUAGE as string | undefined) ?? "pt_BR",
            bodyParameters: [params.guardianFirstName || "tudo bem", word, params.patientName, slotLabel, params.currentLabel],
            quickReplyPayloads: [yes, no],
          });
    messageId = sent.id;
  } catch (err) {
    console.error("[lista de espera] falha ao enviar oferta:", err instanceof Error ? err.message : String(err));
  }

  if (!messageId) {
    await supabase
      .from("waitlist_offers")
      .update({ status: "skipped", details: { reason: "send_failed" } })
      .eq("id", offer.id);
    return false;
  }

  await supabase.from("waitlist_offers").update({ whatsapp_message_id: messageId }).eq("id", offer.id);
  await sendAndLog(
    supabase,
    candidate.guardianId,
    "waitlist_offer",
    body,
    async () => ({ id: messageId as string }),
    candidate.appointmentId
  );
  return true;
}

// --- resposta à oferta --------------------------------------------------------

export type OfferReplyResult =
  | { kind: "accepted"; patientName: string; whenLabel: string }
  | { kind: "declined"; patientName: string; whenLabel: string; stillInList: boolean }
  | { kind: "already_accepted" }
  | { kind: "late"; stillInList: boolean }
  | { kind: "taken"; stillInList: boolean }
  | { kind: "not_found" };

interface OfferRow {
  id: string;
  entry_id: string;
  appointment_id: string;
  opening_id: string | null;
  status: string;
  expires_at: string;
  slot_scheduled_at: string;
  slot_clinic_location_id: string;
}

async function entryStillActive(supabase: SupabaseClient, entryId: string): Promise<boolean> {
  const { data } = await supabase.from("waitlist_entries").select("status").eq("id", entryId).maybeSingle();
  return data?.status === "active";
}

async function loadOffer(supabase: SupabaseClient, offerId: string, guardianId: string | null) {
  const { data } = await supabase
    .from("waitlist_offers")
    .select(
      "id, entry_id, appointment_id, opening_id, status, expires_at, slot_scheduled_at, slot_clinic_location_id, appointments ( id, status, scheduled_at, appointment_type, exam_type_id, duration_minutes, is_group_session, home_visit_address, patients ( full_name, guardian_id, guardians ( phone ) ) )"
    )
    .eq("id", offerId)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any;
  if (!row || !row.appointments) return null;
  // Só o responsável do paciente pode responder.
  if (guardianId && row.appointments.patients?.guardian_id !== guardianId) return null;
  return row as OfferRow & {
    appointments: {
      id: string;
      status: string;
      scheduled_at: string;
      appointment_type: string;
      exam_type_id: string | null;
      duration_minutes: number;
      is_group_session: boolean;
      home_visit_address: string | null;
      patients: { full_name: string; guardian_id: string; guardians: { phone: string | null } | null } | null;
    };
  };
}

export async function declineOffer(
  supabase: SupabaseClient,
  offerId: string,
  guardianId: string | null
): Promise<OfferReplyResult> {
  const offer = await loadOffer(supabase, offerId, guardianId);
  if (!offer) return { kind: "not_found" };
  if (offer.status === "accepted") return { kind: "already_accepted" };
  if (offer.status !== "pending" || new Date(offer.expires_at).getTime() <= Date.now()) {
    return { kind: "late", stillInList: await entryStillActive(supabase, offer.entry_id) };
  }

  const { data: updated } = await supabase
    .from("waitlist_offers")
    .update({ status: "declined", responded_at: new Date().toISOString() })
    .eq("id", offer.id)
    .eq("status", "pending")
    .select("id");
  if (!updated?.length) return { kind: "late", stillInList: await entryStillActive(supabase, offer.entry_id) };

  // "Não" passa a vaga para o próximo na hora, sem esperar o agendador.
  if (offer.opening_id) {
    await supabase
      .from("waitlist_openings")
      .update({ status: "open", updated_at: new Date().toISOString() })
      .eq("id", offer.opening_id)
      .eq("status", "offering");
    await advanceOpening(supabase, offer.opening_id);
  }

  return {
    kind: "declined",
    patientName: offer.appointments.patients?.full_name ?? "",
    whenLabel: relativeWhenLabel(new Date(offer.appointments.scheduled_at)),
    stillInList: await entryStillActive(supabase, offer.entry_id),
  };
}

export async function acceptOffer(
  supabase: SupabaseClient,
  offerId: string,
  guardianId: string | null
): Promise<OfferReplyResult> {
  const offer = await loadOffer(supabase, offerId, guardianId);
  if (!offer) return { kind: "not_found" };
  if (offer.status === "accepted") return { kind: "already_accepted" };
  if (offer.status !== "pending" || new Date(offer.expires_at).getTime() <= Date.now()) {
    return { kind: "late", stillInList: await entryStillActive(supabase, offer.entry_id) };
  }

  // Reserva a resposta (pending → accepted) antes de remarcar: o agendador
  // não vence esta oferta no meio do caminho.
  const now = new Date().toISOString();
  const { data: claimed } = await supabase
    .from("waitlist_offers")
    .update({ status: "accepted", responded_at: now })
    .eq("id", offer.id)
    .eq("status", "pending")
    .gt("expires_at", now)
    .select("id");
  if (!claimed?.length) return { kind: "late", stillInList: await entryStillActive(supabase, offer.entry_id) };

  const appointment = offer.appointments;
  const slotStart = new Date(offer.slot_scheduled_at);
  const giveUp = async (reason: string) => {
    await supabase
      .from("waitlist_offers")
      .update({ status: "withdrawn", details: { reason } })
      .eq("id", offer.id);
    if (offer.opening_id) {
      await supabase
        .from("waitlist_openings")
        .update({ status: "closed", closed_reason: "slot_unavailable", updated_at: new Date().toISOString() })
        .eq("id", offer.opening_id);
    }
    return { kind: "taken" as const, stillInList: await entryStillActive(supabase, offer.entry_id) };
  };

  if (
    !["scheduled", "confirmed"].includes(appointment.status) ||
    new Date(appointment.scheduled_at).getTime() <= slotStart.getTime()
  ) {
    return giveUp("appointment_changed");
  }

  // Remarca para a vaga (mesma regra de trava da página do link).
  if (appointment.is_group_session && appointment.exam_type_id) {
    const { error } = await supabase.rpc("reschedule_group_exam_session", {
      p_appointment_id: appointment.id,
      p_exam_type_id: appointment.exam_type_id,
      p_scheduled_at: slotStart.toISOString(),
      p_clinic_location_id: offer.slot_clinic_location_id,
      p_duration_minutes: appointment.duration_minutes,
    });
    if (error) return giveUp("slot_taken");
  } else {
    const { error } = await supabase
      .from("appointments")
      .update({ clinic_location_id: offer.slot_clinic_location_id, scheduled_at: slotStart.toISOString() })
      .eq("id", appointment.id);
    if (error) {
      if (!isOverlapError(error)) console.error("[lista de espera] erro ao antecipar:", error.message);
      return giveUp("slot_taken");
    }
  }

  await supabase
    .from("appointments")
    .update({
      rescheduled_via: "whatsapp_bot",
      rescheduled_by: null,
      rescheduled_at: new Date().toISOString(),
      ...RESCHEDULE_PRESENCE_RESET,
    })
    .eq("id", appointment.id);

  await Promise.all([
    offer.opening_id
      ? supabase
          .from("waitlist_openings")
          .update({ status: "filled", updated_at: new Date().toISOString() })
          .eq("id", offer.opening_id)
      : Promise.resolve(),
    supabase
      .from("waitlist_entries")
      .update({ status: "advanced", ended_at: new Date().toISOString(), ended_reason: "advanced" })
      .eq("id", offer.entry_id),
    logAppointmentEvent(supabase, {
      appointmentId: appointment.id,
      type: "waitlist_advanced",
      channel: "whatsapp_bot",
      details: { from: appointment.scheduled_at, to: slotStart.toISOString() },
    }),
  ]);

  // Aviso de remarcação de sempre (e o preparo do exame depois da entrega,
  // pela regra de 02/out).
  const patient = appointment.patients;
  const phone = patient?.guardians?.phone;
  if (patient && phone) {
    const location = await fetchLocation(supabase, offer.slot_clinic_location_id);
    const { examName } = await typeWord(supabase, appointment.appointment_type, appointment.exam_type_id);
    await sendAppointmentReschedule({
      supabase,
      appointmentId: appointment.id,
      guardianId: patient.guardian_id,
      guardianPhone: phone,
      patientName: patient.full_name,
      appointmentType: appointment.appointment_type,
      examName,
      locationType: location?.type,
      scheduledAt: slotStart,
      locationAddress: appointment.home_visit_address ?? location?.address ?? null,
    });
  }

  return {
    kind: "accepted",
    patientName: patient?.full_name ?? "",
    whenLabel: relativeWhenLabel(slotStart),
  };
}
