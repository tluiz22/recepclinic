import { isOverConsultationAgeLimit } from "./age";
import {
  appointmentField,
  appointmentLocationId,
  patientField,
  validateImport,
  type BusyPeriod,
  type ImportAppointment,
  type ImportCatalog,
  type ImportPatient,
} from "./agendaImport";
import { isCalendarDate, isClockTime, localDateOf, localTimeOf, toInstant, weekdayOf } from "./clinicTime";
import { isNationalHoliday } from "./holidays";
import { normalizePhone } from "./phone";

// Conferência da agenda atual pelo Suporte (F10.1b; cliente, 19 e 20/out/2026).
// Erros travam a autorização (o Suporte devolve com comentário); avisos não:
//   - já cadastrado (mesmo WhatsApp = mesmo contato; no contato, mesmo nome e
//     nascimento = mesmo paciente): o cadastro fica como está e a diferença
//     com o link aparece como aviso;
//   - fora da grade: fora das janelas de Horários da agenda e do local, dia
//     sem agenda, feriado ou horário bloqueado (o horário "fora do passo",
//     como 10h10 dentro da janela, não avisa);
//   - Retorno sem a Consulta de origem; acima da idade-limite da Consulta;
//   - consulta que já passou: fica de fora da carga, com aviso.
// Os erros são os mesmos do link, conferidos de novo com o cadastro de agora.

export type ReviewWindow = { agendaId: string; locationId: string; serviceId: string | null; weekday: number; startTime: string; endTime: string };

export type ExistingContact = {
  id: string;
  phone: string;
  name: string;
  isActive: boolean;
  patients: { id: string; name: string; birthdate: string; isActive: boolean; insurancePlanId: string | null; cardNumber: string | null }[];
};

export type ReviewContext = {
  timeZone: string;
  today: string;
  now: Date;
  busy: BusyPeriod[];
  windows: ReviewWindow[];
  /** Locais em que cada serviço é oferecido. */
  serviceLocations: { serviceId: string; locationId: string }[];
  blocks: BusyPeriod[];
  /** Feriados próprios da clínica (os nacionais vêm de isNationalHoliday). */
  holidays: Set<string>;
  /** Contatos da clínica com os WhatsApps do link. */
  contacts: ExistingContact[];
  consultationAgeLimit: number | null;
};

export type PatientKind = "new" | "existing_patient" | "existing_contact";

export type ReviewedAppointment = {
  key: string;
  date: string;
  time: string;
  serviceName: string;
  agendaName: string;
  locationName: string;
  homeAddress: string;
  /** Já passou: fica de fora da carga. */
  skipped: boolean;
  errors: string[];
  warnings: string[];
};

export type ReviewedPatient = {
  key: string;
  name: string;
  birthdate: string;
  phone: string;
  /** Normalizado (+55…), ou null quando inválido. */
  phoneE164: string | null;
  guardianName: string;
  insuranceName: string;
  cardNumber: string;
  kind: PatientKind;
  /** Contato ou paciente já cadastrado (para a carga, F10.1c). */
  contactId: string | null;
  patientId: string | null;
  errors: string[];
  warnings: string[];
  appointments: ReviewedAppointment[];
};

export type ImportReview = {
  patients: ReviewedPatient[];
  errorCount: number;
  warningCount: number;
  totals: { newPatients: number; existingPatients: number; appointmentsIn: number; appointmentsSkipped: number };
};

const same = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR") === b.replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
const minutes = (time: string) => {
  const [h, m] = time.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
};

/** Por que a consulta está fora da grade (null = dentro). */
export function outsideGrid(
  appointment: ImportAppointment,
  service: ImportCatalog["services"][number],
  locationId: string,
  context: Pick<ReviewContext, "timeZone" | "windows" | "serviceLocations" | "blocks" | "holidays">,
): string | null {
  const start = toInstant(appointment.date, appointment.time, context.timeZone);
  const end = new Date(start.getTime() + service.durationMinutes * 60_000);
  if (isNationalHoliday(appointment.date) || context.holidays.has(appointment.date)) return "Fora da grade: feriado.";
  if (!context.serviceLocations.some((l) => l.serviceId === service.id && l.locationId === locationId)) {
    return "Fora da grade: o serviço não é oferecido nesse local.";
  }
  // Passa da meia-noite: não cabe em janela nenhuma do dia.
  const endsSameDay = localDateOf(end, context.timeZone) === appointment.date || localTimeOf(end, context.timeZone) === "00:00";
  const from = minutes(appointment.time);
  const to = endsSameDay ? from + service.durationMinutes : Number.POSITIVE_INFINITY;
  const weekday = weekdayOf(appointment.date);
  const fits = context.windows.some(
    (w) =>
      w.agendaId === appointment.agendaId &&
      w.locationId === locationId &&
      w.weekday === weekday &&
      // Turma: só as janelas do próprio serviço; individual: gerais e as do serviço.
      (service.group ? w.serviceId === service.id : w.serviceId === null || w.serviceId === service.id) &&
      minutes(w.startTime) <= from &&
      to <= minutes(w.endTime),
  );
  if (!fits) return "Fora da grade: fora dos Horários dessa agenda e local.";
  if (context.blocks.some((b) => b.agendaId === appointment.agendaId && b.start < end && start < b.end)) return "Fora da grade: horário bloqueado na agenda.";
  return null;
}

export function reviewImport(patients: ImportPatient[], catalog: ImportCatalog, context: ReviewContext): ImportReview {
  const services = new Map(catalog.services.map((s) => [s.id, s]));
  const agendas = new Map(catalog.agendas.map((a) => [a.id, a.name]));
  const locations = new Map(catalog.locations.map((l) => [l.id, l.name]));
  const plans = new Map(catalog.insurancePlans.map((p) => [p.id, p.name]));
  const contactsByPhone = new Map(context.contacts.map((c) => [c.phone, c]));

  const isPast = (a: ImportAppointment) =>
    isCalendarDate(a.date) && isClockTime(a.time) && toInstant(a.date, a.time, context.timeZone).getTime() < context.now.getTime();
  // Os erros só das consultas que entram (a que passou fica de fora).
  const issues = validateImport(
    patients.map((p) => ({ ...p, appointments: p.appointments.filter((a) => !isPast(a)) })),
    catalog,
    { timeZone: context.timeZone, today: context.today, now: context.now, busy: context.busy },
  );
  const patientIssues = (key: string) =>
    (["name", "birthdate", "phone", "guardianName", "insurancePlanId"] as const).map((f) => issues[patientField(key, f)]).filter(Boolean);
  const appointmentIssues = (patientKey: string, key: string) =>
    (["date", "time", "serviceId", "agendaId", "locationId", "homeAddress"] as const).map((f) => issues[appointmentField(patientKey, key, f)]).filter(Boolean);

  const reviewed = patients.map((patient): ReviewedPatient => {
    const warnings: string[] = [];
    const phoneE164 = patient.phone ? normalizePhone(patient.phone) : null;
    const contact = phoneE164 ? contactsByPhone.get(phoneE164) : undefined;
    const linkContactName = patient.guardianName || patient.name;
    let kind: PatientKind = "new";
    let patientId: string | null = null;
    if (contact) {
      if (!same(contact.name, linkContactName)) {
        warnings.push(`WhatsApp já cadastrado em nome de ${contact.name} (no link: ${linkContactName}). Fica o cadastro.`);
      }
      if (!contact.isActive) warnings.push("O contato já cadastrado está inativo.");
      const existing = contact.patients.find((p) => same(p.name, patient.name) && p.birthdate === patient.birthdate);
      if (existing) {
        kind = "existing_patient";
        patientId = existing.id;
        if (!existing.isActive) warnings.push("O paciente já cadastrado está inativo.");
        const registeredPlan = existing.insurancePlanId ? (plans.get(existing.insurancePlanId) ?? "outro convênio") : "Particular";
        const linkPlan = patient.insurancePlanId ? (plans.get(patient.insurancePlanId) ?? "convênio") : "Particular";
        if ((existing.insurancePlanId ?? "") !== patient.insurancePlanId || (patient.cardNumber && patient.cardNumber !== (existing.cardNumber ?? ""))) {
          const card = (n: string | null) => (n ? `, carteirinha ${n}` : "");
          warnings.push(`Convênio no cadastro: ${registeredPlan}${card(existing.cardNumber)}; no link: ${linkPlan}${card(patient.cardNumber)}. Fica o cadastro.`);
        }
      } else {
        kind = "existing_contact";
      }
    }

    const appointments = patient.appointments.map((appointment): ReviewedAppointment => {
      const service = services.get(appointment.serviceId);
      const locationId = appointmentLocationId(appointment, catalog);
      const skipped = isPast(appointment);
      const errors = skipped ? [] : appointmentIssues(patient.key, appointment.key);
      const notes: string[] = [];
      if (skipped) notes.push("Já passou: fica de fora da carga.");
      else if (service && errors.length === 0) {
        const grid = outsideGrid(appointment, service, locationId, context);
        if (grid) notes.push(grid);
        if (service.category === "return_visit") notes.push("Retorno: entra sem a Consulta de origem e sem conferir o prazo.");
        if (
          service.category === "consultation" &&
          context.consultationAgeLimit !== null &&
          isCalendarDate(patient.birthdate) &&
          isOverConsultationAgeLimit(patient.birthdate, appointment.date, context.consultationAgeLimit)
        ) {
          notes.push(`Paciente com ${context.consultationAgeLimit} anos ou mais: acima da idade-limite da Consulta.`);
        }
      }
      return {
        key: appointment.key,
        date: appointment.date,
        time: appointment.time,
        serviceName: service?.name ?? "",
        agendaName: agendas.get(appointment.agendaId) ?? "",
        locationName: locations.get(locationId) ?? "",
        homeAddress: appointment.homeAddress,
        skipped,
        errors,
        warnings: notes,
      };
    });

    return {
      key: patient.key,
      name: patient.name,
      birthdate: patient.birthdate,
      phone: patient.phone,
      phoneE164,
      guardianName: patient.guardianName,
      insuranceName: patient.insurancePlanId ? (plans.get(patient.insurancePlanId) ?? "") : "Particular",
      cardNumber: patient.cardNumber,
      kind,
      contactId: contact?.id ?? null,
      patientId,
      errors: [...(issues.form && patient === patients[0] ? [issues.form] : []), ...patientIssues(patient.key)],
      warnings,
      appointments,
    };
  });

  const count = (pick: (p: ReviewedPatient) => string[][]) => reviewed.flatMap(pick).reduce((n, list) => n + list.length, 0);
  return {
    patients: reviewed,
    errorCount: count((p) => [p.errors, ...p.appointments.map((a) => a.errors)]),
    warningCount: count((p) => [p.warnings, ...p.appointments.map((a) => a.warnings)]),
    totals: {
      newPatients: reviewed.filter((p) => p.kind !== "existing_patient").length,
      existingPatients: reviewed.filter((p) => p.kind === "existing_patient").length,
      appointmentsIn: reviewed.reduce((n, p) => n + p.appointments.filter((a) => !a.skipped).length, 0),
      appointmentsSkipped: reviewed.reduce((n, p) => n + p.appointments.filter((a) => a.skipped).length, 0),
    },
  };
}
