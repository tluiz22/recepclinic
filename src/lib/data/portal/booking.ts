import { isOverConsultationAgeLimit } from "../../age";
import { todayIn } from "../../clinicTime";
import { logError } from "../../log";
import { cleanFullName } from "../../portalBooking";
import { bookAppointment, findBlockingAppointment, listUpcomingAppointments } from "../agenda/appointments";
import type { DbClient } from "../clients";
import { DataError, unwrap } from "../errors";
import { findContactByPhone, listContactPatients, registerPatient, type Contact } from "../patients";
import { checkBookingLimits, checkNewPatientLimit, contactForLimits, recordBotLimitEvent, type BotLimitHit } from "../whatsapp/botLimits";
import { dispatchNotice, enqueueNotice } from "../whatsapp/noticeQueue";
import type { ClinicSender } from "../whatsapp/send";
import type { PortalProfessional } from "./portal";

// Marcar a consulta pelo portal (F2c; especificação P8 a P10; proposta, cenários 1 a 3, 8, 9, 15 e 17). O portal pega
// os mesmos dados do WhatsApp (nome, nascimento, telefone e o responsável quando precisa) e segue as regras do bot:
// limites por telefone, idade limite do médico, atendimento futuro que impede outro. Quem será atendido fica na
// reserva (o cadastro novo só é gravado na marcação); a marcação é tomada uma vez (duplo toque não marca duas vezes) e
// a reserva guarda o atendimento marcado (recarregar mostra a mesma confirmação).

export type PortalPatient = { id: string; fullName: string; birthdate: string; isContactSelf: boolean };

export type NewPatientData = {
  /** Para mim (o paciente é quem tem o celular) ou outra pessoa (filho, dependente). */
  for: "self" | "other";
  name: string;
  birthdate: string;
  /** Quem tem o celular, quando o contato é novo e a consulta é para outra pessoa. */
  contactName: string | null;
};

export type PortalHold = {
  id: string;
  agendaId: string;
  serviceId: string;
  locationId: string;
  start: Date;
  end: Date;
  expiresAt: Date;
  phone: string;
  patientId: string | null;
  newPatient: NewPatientData | null;
  informedBirthdate: string | null;
  confirmingAt: Date | null;
  appointmentId: string | null;
  /** Retorno (F2d): a consulta de origem; null = consulta ou exame. */
  returnOriginId: string | null;
  /** Ativa (pode seguir), marcada (P10) ou vencida/solta. */
  state: "active" | "booked" | "gone";
};

const HOLD_COLUMNS =
  "id, agenda_id, service_id, location_id, starts_at, ends_at, expires_at, phone, patient_id, new_patient, informed_birthdate, confirming_at, appointment_id, released_at, return_origin_id";

function toNewPatient(value: unknown): NewPatientData | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if ((v.for !== "self" && v.for !== "other") || typeof v.name !== "string" || typeof v.birthdate !== "string") return null;
  return { for: v.for, name: v.name, birthdate: v.birthdate, contactName: typeof v.contactName === "string" ? v.contactName : null };
}

/** A reserva desta sessão (ativa, já marcada ou vencida); null = não é desta sessão ou não existe. */
export async function loadHold(db: DbClient, clinicId: string, sessionId: string, holdId: string, now: Date = new Date()): Promise<PortalHold | null> {
  if (!/^[0-9a-f-]{36}$/.test(holdId)) return null;
  const row = unwrap(
    await db.from("slot_holds").select(HOLD_COLUMNS).eq("clinic_id", clinicId).eq("session_id", sessionId).eq("id", holdId).maybeSingle(),
    "Reserva do horário",
  );
  if (!row) return null;
  const state = row.appointment_id ? "booked" : !row.released_at && new Date(row.expires_at) > now ? "active" : "gone";
  return {
    id: row.id,
    agendaId: row.agenda_id,
    serviceId: row.service_id,
    locationId: row.location_id,
    start: new Date(row.starts_at),
    end: new Date(row.ends_at),
    expiresAt: new Date(row.expires_at),
    phone: row.phone,
    patientId: row.patient_id,
    newPatient: toNewPatient(row.new_patient),
    informedBirthdate: row.informed_birthdate,
    confirmingAt: row.confirming_at ? new Date(row.confirming_at) : null,
    appointmentId: row.appointment_id,
    returnOriginId: row.return_origin_id,
    state,
  };
}

/** O celular já tem o próprio paciente (ativo ou não): "Para mim" não cabe (um só por contato). */
export async function contactHasSelf(db: DbClient, clinicId: string, contactId: string): Promise<boolean> {
  return (await listContactPatients(db, clinicId, contactId, { includeInactive: true })).some((p) => p.isContactSelf);
}

/** O contato do celular comprovado e os pacientes ativos dele (P8). */
export async function phonePatients(db: DbClient, clinicId: string, phone: string): Promise<{ contact: Contact | null; patients: PortalPatient[] }> {
  const contact = await findContactByPhone(db, clinicId, phone);
  if (!contact || !contact.isActive || contact.anonymizedAt) return { contact: null, patients: [] };
  const patients = (await listContactPatients(db, clinicId, contact.id))
    .filter((p) => !p.anonymizedAt)
    .map((p) => ({ id: p.id, fullName: p.fullName, birthdate: p.birthdate, isContactSelf: p.isContactSelf }))
    // "(você)" primeiro, depois em ordem alfabética.
    .sort((a, b) => Number(b.isContactSelf) - Number(a.isContactSelf) || a.fullName.localeCompare(b.fullName, "pt-BR"));
  return { contact, patients };
}

/** Já completou a idade limite do médico para Consulta (como no bot). */
export const overAgeLimit = (professional: Pick<PortalProfessional, "ageLimitYears">, birthdate: string, today: string) =>
  professional.ageLimitYears !== null && isOverConsultationAgeLimit(birthdate, today, professional.ageLimitYears);

/** Grava quem será atendido na reserva ativa (paciente escolhido ou os dados do cadastro novo). */
export async function setHoldPatient(
  db: DbClient,
  clinicId: string,
  sessionId: string,
  holdId: string,
  choice: { patientId: string; informedBirthdate?: string | null } | { newPatient: NewPatientData },
  now: Date = new Date(),
): Promise<boolean> {
  const patch =
    "patientId" in choice
      ? { patient_id: choice.patientId, new_patient: null, informed_birthdate: choice.informedBirthdate ?? null }
      : { patient_id: null, new_patient: choice.newPatient, informed_birthdate: null };
  const rows = unwrap(
    await db
      .from("slot_holds")
      .update(patch)
      .eq("clinic_id", clinicId)
      .eq("session_id", sessionId)
      .eq("id", holdId)
      .is("released_at", null)
      .is("appointment_id", null)
      .gt("expires_at", now.toISOString())
      .select("id"),
    "Reserva do horário",
  );
  return rows.length > 0;
}

/** Paciente do mesmo celular com o nome parecido (P8b: "Já existe um cadastro neste número…"). */
export type DuplicateMatch = PortalPatient & { sameBirthdate: boolean };

export async function findDuplicate(
  db: DbClient,
  clinicId: string,
  contactId: string,
  data: Pick<NewPatientData, "name" | "birthdate">,
  patients: PortalPatient[],
): Promise<DuplicateMatch | null> {
  const ids = unwrap(await db.rpc("similar_patient_ids", { p_clinic_id: clinicId, p_name: data.name, p_contact_id: contactId }), "Pacientes parecidos") ?? [];
  const similar = patients.filter((p) => ids.includes(p.id));
  const match = similar.find((p) => p.birthdate === data.birthdate) ?? similar[0];
  return match ? { ...match, sameBirthdate: match.birthdate === data.birthdate } : null;
}

export type BlockReason =
  | { kind: "limit"; hit: BotLimitHit }
  | { kind: "age"; limit: number }
  | { kind: "already"; scheduledAt: Date }
  | { kind: "blocked_contact" };

/**
 * O que impede marcar para este paciente, antes da revisão e de novo na marcação: idade limite, atendimento futuro
 * com o mesmo médico (Remarcar chega na F3) e os limites do bot por telefone (sem revelar a regra, como no bot; o de
 * atendimentos futuros diz o número, P9). `record`: grava o limite atingido para a equipe ver (só na marcação).
 */
export async function bookingBlock(
  db: DbClient,
  clinicId: string,
  input: { professional: PortalProfessional; phone: string; patient: { id: string | null; birthdate: string }; isNew: boolean; timeZone: string; record?: boolean },
  now: Date = new Date(),
): Promise<BlockReason | null> {
  const today = todayIn(input.timeZone, now);
  if (overAgeLimit(input.professional, input.patient.birthdate, today)) return { kind: "age", limit: input.professional.ageLimitYears! };
  if (input.patient.id) {
    const upcoming = (await listUpcomingAppointments(db, clinicId, [input.patient.id], now)).get(input.patient.id) ?? [];
    const blocking = findBlockingAppointment(upcoming, { serviceId: "", agendaId: input.professional.agendaId, category: "consultation" });
    if (blocking) return { kind: "already", scheduledAt: blocking.scheduledAt };
  }
  const contact = await findContactByPhone(db, clinicId, input.phone);
  if (contact?.botBlockedAt) return { kind: "blocked_contact" };
  const limits = contact ? await contactForLimits(db, clinicId, input.phone) : null;
  if (!limits || limits.exempt) return null;
  const hit = (input.isNew ? await checkNewPatientLimit(db, clinicId, limits.id, now) : null) ?? (await checkBookingLimits(db, clinicId, limits.id, now));
  if (!hit) return null;
  if (input.record) await recordBotLimitEvent(db, clinicId, limits.id, hit, false, now).catch((error) => logError("portal: limite não registrado", error, { clinica: clinicId }));
  return { kind: "limit", hit };
}

export type ConfirmOutcome =
  | { status: "booked"; appointmentId: string }
  | { status: "confirming" }
  | { status: "expired" }
  | { status: "taken" }
  | { status: "no_patient" }
  | { status: "blocked"; reason: BlockReason }
  | { status: "failed" };

/** Toma a reserva para marcar (uma vez só; quem tomou e caiu libera depois de 1 min). */
export async function claimHold(db: DbClient, clinicId: string, sessionId: string, holdId: string, now: Date): Promise<boolean> {
  const stale = new Date(now.getTime() - 60_000).toISOString();
  const rows = unwrap(
    await db
      .from("slot_holds")
      .update({ confirming_at: now.toISOString() })
      .eq("clinic_id", clinicId)
      .eq("session_id", sessionId)
      .eq("id", holdId)
      .is("released_at", null)
      .is("appointment_id", null)
      .gt("expires_at", now.toISOString())
      .or(`confirming_at.is.null,confirming_at.lt.${stale}`)
      .select("id"),
    "Reserva do horário",
  );
  return rows.length > 0;
}

export async function unclaimHold(db: DbClient, clinicId: string, holdId: string): Promise<void> {
  const { error } = await db.from("slot_holds").update({ confirming_at: null }).eq("clinic_id", clinicId).eq("id", holdId).is("appointment_id", null);
  if (error) logError("portal: reserva não devolvida", error, { clinica: clinicId, reserva: holdId });
}

/**
 * P9 "Confirmar agendamento": confere tudo de novo, grava o cadastro novo (se for o caso), marca pelo canal do portal,
 * guarda a origem, solta a reserva com o atendimento, registra a data a conferir e põe a confirmação na fila (o envio
 * nunca desfaz nem trava a marcação).
 */
export async function confirmPortalBooking(
  db: DbClient,
  clinicId: string,
  input: {
    sessionId: string;
    holdId: string;
    professional: PortalProfessional;
    timeZone: string;
    /** Plano escolhido na P5 (null = particular). */
    insurancePlanId: string | null;
    entry: "whatsapp" | "clinic_link" | "professional_link";
    sender: ClinicSender | null;
  },
  now: Date = new Date(),
): Promise<ConfirmOutcome> {
  const hold = await loadHold(db, clinicId, input.sessionId, input.holdId, now);
  // A reserva de um retorno só se marca pela revisão do retorno (returnVisit.ts).
  if (!hold || hold.agendaId !== input.professional.agendaId || hold.returnOriginId) return { status: "expired" };
  if (hold.state === "booked") return { status: "booked", appointmentId: hold.appointmentId! };
  if (hold.state === "gone") return { status: "expired" };
  if (!hold.patientId && !hold.newPatient) return { status: "no_patient" };
  if (!(await claimHold(db, clinicId, input.sessionId, input.holdId, now))) {
    const again = await loadHold(db, clinicId, input.sessionId, input.holdId, now);
    if (again?.state === "booked") return { status: "booked", appointmentId: again.appointmentId! };
    return again?.state === "active" ? { status: "confirming" } : { status: "expired" };
  }

  const today = todayIn(input.timeZone, now);
  let appointmentId: string;
  try {
    // Quem será atendido: o escolhido (ainda do mesmo celular e ativo) ou o cadastro novo.
    let patientId: string;
    let birthdate: string;
    if (hold.patientId) {
      const { patients } = await phonePatients(db, clinicId, hold.phone);
      const chosen = patients.find((p) => p.id === hold.patientId);
      if (!chosen) {
        await unclaimHold(db, clinicId, hold.id);
        return { status: "no_patient" };
      }
      patientId = chosen.id;
      birthdate = chosen.birthdate;
    } else {
      const data = hold.newPatient!;
      birthdate = data.birthdate;
      const block = await bookingBlock(db, clinicId, { professional: input.professional, phone: hold.phone, patient: { id: null, birthdate }, isNew: true, timeZone: input.timeZone, record: true }, now);
      if (block) {
        await unclaimHold(db, clinicId, hold.id);
        return { status: "blocked", reason: block };
      }
      patientId = await registerNew(db, clinicId, hold.phone, data, today);
      // Gravado: a reserva passa a ter o paciente (outra tentativa, depois de uma falha, não cadastra de novo).
      const saved = await db.from("slot_holds").update({ patient_id: patientId, new_patient: null }).eq("clinic_id", clinicId).eq("id", hold.id);
      if (saved.error) logError("portal: reserva sem o paciente novo", saved.error, { clinica: clinicId, reserva: hold.id });
    }

    const block = await bookingBlock(db, clinicId, { professional: input.professional, phone: hold.phone, patient: { id: patientId, birthdate }, isNew: false, timeZone: input.timeZone, record: true }, now);
    if (block) {
      await unclaimHold(db, clinicId, hold.id);
      return { status: "blocked", reason: block };
    }

    const { appointment } = await bookAppointment(
      db,
      clinicId,
      { patientId, serviceId: hold.serviceId, agendaId: hold.agendaId, start: hold.start, locationId: hold.locationId, channel: "portal", actorId: null },
      now,
    );
    appointmentId = appointment.id;
  } catch (error) {
    await unclaimHold(db, clinicId, hold.id);
    if (error instanceof DataError && error.code === "conflict") {
      await db.from("slot_holds").update({ released_at: now.toISOString() }).eq("clinic_id", clinicId).eq("id", hold.id);
      return { status: "taken" };
    }
    logError("portal: não marcou", error, { clinica: clinicId, reserva: hold.id });
    return { status: "failed" };
  }

  // Daqui em diante a consulta está marcada: nada desfaz a marcação.
  const done = await db
    .from("slot_holds")
    .update({ appointment_id: appointmentId, released_at: now.toISOString() })
    .eq("clinic_id", clinicId)
    .eq("id", hold.id);
  if (done.error) logError("portal: reserva sem o atendimento", done.error, { clinica: clinicId, reserva: hold.id });

  await afterBooking(db, clinicId, { appointmentId, hold, insurancePlanId: input.insurancePlanId, entry: input.entry }, now);
  await enqueueNotice(db, clinicId, appointmentId, "confirmation", now).catch((error) => logError("portal: confirmação fora da fila", error, { clinica: clinicId }));
  // Sem quem envia agora (falha ao carregar o WhatsApp da clínica): a linha fica pendente e a rotina manda.
  if (input.sender) await dispatchNotice(db, clinicId, appointmentId, "confirmation", input.sender, now);
  return { status: "booked", appointmentId };
}

/** Cadastro novo pelo portal (conta no limite de pacientes novos do telefone, como o bot). */
async function registerNew(db: DbClient, clinicId: string, phone: string, data: NewPatientData, today: string): Promise<string> {
  const name = cleanFullName(data.name) ?? data.name;
  const contact =
    data.for === "self"
      ? ({ mode: "self", phone } as const)
      : ({ mode: "new", phone, fullName: cleanFullName(data.contactName) ?? (await findContactByPhone(db, clinicId, phone))?.fullName ?? name } as const);
  let result = await registerPatient(db, clinicId, { fullName: name, birthdate: data.birthdate, contact, confirmDuplicate: true, createdVia: "portal" }, today);
  // O celular já tem contato (outro paciente dele): é a mesma pessoa, comprovada pelo código.
  if (result.status === "confirm_same_person") {
    result = await registerPatient(
      db,
      clinicId,
      { fullName: name, birthdate: data.birthdate, contact: { mode: "self", phone, confirmedContactId: result.contact.id }, confirmDuplicate: true, createdVia: "portal" },
      today,
    );
  }
  if (result.status !== "created") throw new Error(`cadastro pelo portal: ${result.status}`);
  return result.patient.id;
}

/**
 * Origem, convênio e data a conferir: melhor esforço (a consulta já está marcada). `insurancePlanId` undefined (retorno):
 * o atendimento fica com o convênio que o banco copiou do cadastro.
 */
export async function afterBooking(
  db: DbClient,
  clinicId: string,
  input: { appointmentId: string; hold: PortalHold; insurancePlanId?: string | null; entry: "whatsapp" | "clinic_link" | "professional_link" },
  now: Date,
): Promise<void> {
  try {
    unwrap(
      await db
        .from("appointments")
        // Particular: sem convênio no atendimento (o banco copia o do cadastro ao gravar).
        .update(input.insurancePlanId === undefined ? { portal_entry: input.entry } : { portal_entry: input.entry, insurance_plan_id: input.insurancePlanId })
        .eq("clinic_id", clinicId)
        .eq("id", input.appointmentId),
      "Atendimento",
    );
    const row = unwrap(await db.from("appointments").select("patient_id").eq("clinic_id", clinicId).eq("id", input.appointmentId).single(), "Atendimento");
    // Paciente ainda sem convênio: passa a ter o escolhido (como no link do bot).
    if (input.insurancePlanId) {
      unwrap(
        await db.from("patients").update({ insurance_plan_id: input.insurancePlanId }).eq("clinic_id", clinicId).eq("id", row.patient_id).is("insurance_plan_id", null),
        "Paciente",
      );
    }
    if (input.hold.patientId && input.hold.informedBirthdate) {
      const patient = unwrap(await db.from("patients").select("birthdate").eq("clinic_id", clinicId).eq("id", input.hold.patientId).single(), "Paciente");
      if (patient.birthdate !== input.hold.informedBirthdate) {
        unwrap(
          await db.from("portal_birthdate_checks").insert({
            clinic_id: clinicId,
            patient_id: input.hold.patientId,
            appointment_id: input.appointmentId,
            registered_birthdate: patient.birthdate,
            informed_birthdate: input.hold.informedBirthdate,
            created_at: now.toISOString(),
          }),
          "Data a conferir",
        );
      }
    }
  } catch (error) {
    logError("portal: depois da marcação", error, { clinica: clinicId, atendimento: input.appointmentId });
  }
}

/** Resumo do atendimento marcado (P10 e .ics), só pela reserva desta sessão. */
export type BookedSummary = { appointmentId: string; start: Date; end: Date; patientName: string; status: string; locationId: string };

export async function bookedSummary(db: DbClient, clinicId: string, appointmentId: string): Promise<BookedSummary | null> {
  const row = unwrap(
    await db
      .from("appointments")
      .select("id, scheduled_at, duration_minutes, status, location_id, patients ( full_name )")
      .eq("clinic_id", clinicId)
      .eq("id", appointmentId)
      .maybeSingle(),
    "Atendimento",
  ) as { id: string; scheduled_at: string; duration_minutes: number; status: string; location_id: string; patients: { full_name: string } } | null;
  if (!row) return null;
  const start = new Date(row.scheduled_at);
  return {
    appointmentId: row.id,
    start,
    end: new Date(start.getTime() + row.duration_minutes * 60_000),
    patientName: row.patients.full_name,
    status: row.status,
    locationId: row.location_id,
  };
}
