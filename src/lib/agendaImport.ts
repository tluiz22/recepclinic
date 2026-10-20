import { isAdult } from "./age";
import { isCalendarDate, isClockTime, toInstant } from "./clinicTime";
import { INVALID_PHONE_MESSAGE, normalizePhone } from "./phone";

// Agenda atual da clínica para a importação na implantação (F10.1; cliente,
// 19 e 20/out/2026). A clínica preenche por um link (sem login, 15 dias):
// paciente por paciente, com as consultas marcadas dentro do cartão de cada
// um. O rascunho fica salvo mesmo com erro; o envio ao Suporte só sai sem
// erro. O link nunca mostra os pacientes que a clínica já tem: a conferência
// com o cadastro ("já cadastrado", fora da grade) é do Suporte (F10.1b).

export const AGENDA_IMPORT_DAYS = 15;
export const MAX_IMPORT_PATIENTS = 1000;
export const MAX_PATIENT_APPOINTMENTS = 30;

export type ImportAppointment = {
  key: string;
  date: string;
  time: string;
  serviceId: string;
  agendaId: string;
  locationId: string;
  homeAddress: string;
};

export type ImportPatient = {
  key: string;
  name: string;
  birthdate: string;
  phone: string;
  guardianName: string;
  insurancePlanId: string;
  cardNumber: string;
  appointments: ImportAppointment[];
};

/** O que está ativo na clínica: os menus do link e a conferência. */
export type ImportCatalog = {
  services: { id: string; name: string; durationMinutes: number; group: boolean }[];
  agendas: { id: string; name: string }[];
  /** Pares serviço × agenda em que o serviço é atendido. */
  serviceAgendas: { serviceId: string; agendaId: string }[];
  locations: { id: string; name: string; homeVisit: boolean }[];
  /** Vazio quando a clínica não tem o item Convênios. */
  insurancePlans: { id: string; name: string }[];
};

/** Horário já ocupado na agenda (atendimentos ativos da clínica). */
export type BusyPeriod = { agendaId: string; start: Date; end: Date };

/** Problemas por campo: chave = nome do campo no formulário. */
export type ImportIssues = Record<string, string>;

const KEY_RE = /^[a-z0-9]{1,20}$/;

// Nomes dos campos: "p.<paciente>.name" e "p.<paciente>.a.<consulta>.date".
export const patientField = (key: string, field: keyof Omit<ImportPatient, "key" | "appointments">) => `p.${key}.${field}`;
export const appointmentField = (patientKey: string, key: string, field: keyof Omit<ImportAppointment, "key">) => `p.${patientKey}.a.${key}.${field}`;

const clean = (value: FormDataEntryValue | null | undefined) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

/** Lê o formulário do link na ordem da tela; cartão e consulta em branco saem. */
export function parseImportForm(form: FormData): ImportPatient[] {
  const patientKeys: string[] = [];
  const appointmentKeys = new Map<string, string[]>();
  for (const name of form.keys()) {
    const match = /^p\.([^.]+)(?:\.a\.([^.]+))?\./.exec(name);
    if (!match || !KEY_RE.test(match[1]) || (match[2] !== undefined && !KEY_RE.test(match[2]))) continue;
    const [, patientKey, appointmentKey] = match;
    if (!appointmentKeys.has(patientKey)) {
      patientKeys.push(patientKey);
      appointmentKeys.set(patientKey, []);
    }
    const keys = appointmentKeys.get(patientKey)!;
    if (appointmentKey && !keys.includes(appointmentKey)) keys.push(appointmentKey);
  }
  return patientKeys
    .map((key): ImportPatient => {
      const get = (field: Parameters<typeof patientField>[1]) => clean(form.get(patientField(key, field)));
      const appointments = appointmentKeys
        .get(key)!
        .map((akey): ImportAppointment => {
          const aget = (field: Parameters<typeof appointmentField>[2]) => clean(form.get(appointmentField(key, akey, field)));
          return {
            key: akey,
            date: aget("date"),
            time: aget("time"),
            serviceId: aget("serviceId"),
            agendaId: aget("agendaId"),
            locationId: aget("locationId"),
            homeAddress: aget("homeAddress"),
          };
        })
        .filter((a) => a.date || a.time || a.serviceId || a.agendaId || a.homeAddress);
      return {
        key,
        name: get("name"),
        birthdate: get("birthdate"),
        phone: get("phone"),
        guardianName: get("guardianName"),
        insurancePlanId: get("insurancePlanId"),
        cardNumber: get("cardNumber"),
        appointments,
      };
    })
    .filter((p) => p.name || p.birthdate || p.phone || p.guardianName || p.cardNumber || p.appointments.length > 0);
}

/** O rascunho guardado no banco (jsonb), lido sem confiar no formato. */
export function normalizeImportEntries(value: unknown): ImportPatient[] {
  if (!Array.isArray(value)) return [];
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  return value
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object" && KEY_RE.test(text((p as Record<string, unknown>).key)))
    .map((p) => ({
      key: text(p.key),
      name: text(p.name),
      birthdate: text(p.birthdate),
      phone: text(p.phone),
      guardianName: text(p.guardianName),
      insurancePlanId: text(p.insurancePlanId),
      cardNumber: text(p.cardNumber),
      appointments: (Array.isArray(p.appointments) ? p.appointments : [])
        .filter((a): a is Record<string, unknown> => !!a && typeof a === "object" && KEY_RE.test(text((a as Record<string, unknown>).key)))
        .map((a) => ({
          key: text(a.key),
          date: text(a.date),
          time: text(a.time),
          serviceId: text(a.serviceId),
          agendaId: text(a.agendaId),
          locationId: text(a.locationId),
          homeAddress: text(a.homeAddress),
        })),
    }));
}

/** O local da consulta: o escolhido ou, com um só local na clínica, ele. */
export function appointmentLocationId(appointment: ImportAppointment, catalog: ImportCatalog): string {
  return appointment.locationId || (catalog.locations.length === 1 ? catalog.locations[0].id : "");
}

/** Contato de cada linha: o responsável ou, sem ele, o próprio paciente. */
const contactName = (patient: ImportPatient) => (patient.guardianName || patient.name).toLocaleLowerCase("pt-BR");

/**
 * Confere o que a clínica digitou. `today` e `now` no fuso da clínica;
 * `busy`, os horários já ocupados nas agendas da clínica.
 */
export function validateImport(
  patients: ImportPatient[],
  catalog: ImportCatalog,
  { timeZone, today, now, busy }: { timeZone: string; today: string; now: Date; busy: BusyPeriod[] },
): ImportIssues {
  const issues: ImportIssues = {};
  const add = (field: string, message: string) => {
    if (!issues[field]) issues[field] = message;
  };
  const services = new Map(catalog.services.map((s) => [s.id, s]));
  const agendas = new Set(catalog.agendas.map((a) => a.id));
  const pairs = new Set(catalog.serviceAgendas.map((p) => `${p.serviceId}|${p.agendaId}`));
  const locations = new Map(catalog.locations.map((l) => [l.id, l]));
  const plans = new Set(catalog.insurancePlans.map((p) => p.id));
  // Horários ocupados, os da clínica e os já digitados no link.
  const taken: (BusyPeriod & { mine: boolean })[] = busy.map((b) => ({ ...b, mine: false }));
  // Por WhatsApp: o contato (nome) e quem já é o próprio contato.
  const contacts = new Map<string, { name: string; selfKeys: string[]; patients: Set<string> }>();

  if (patients.length > MAX_IMPORT_PATIENTS) add("form", `No máximo ${MAX_IMPORT_PATIENTS} pacientes por link.`);

  for (const patient of patients) {
    const f = (field: Parameters<typeof patientField>[1]) => patientField(patient.key, field);
    if (!patient.name) add(f("name"), "Informe o nome do paciente.");
    if (!patient.birthdate) add(f("birthdate"), "Informe a data de nascimento.");
    else if (!isCalendarDate(patient.birthdate) || patient.birthdate < "1900-01-01" || patient.birthdate > today) {
      add(f("birthdate"), "Data de nascimento inválida.");
    } else if (!patient.guardianName && !isAdult(patient.birthdate, today)) {
      add(f("guardianName"), "Paciente menor de 18 anos: informe o nome do responsável.");
    }
    const phone = patient.phone ? normalizePhone(patient.phone) : null;
    if (!patient.phone) add(f("phone"), "Informe o WhatsApp.");
    else if (!phone) add(f("phone"), INVALID_PHONE_MESSAGE);
    if (patient.insurancePlanId && !plans.has(patient.insurancePlanId)) add(f("insurancePlanId"), "Escolha o convênio na lista.");
    if (patient.cardNumber && !patient.insurancePlanId) add(f("insurancePlanId"), "Escolha o convênio da carteirinha.");
    if (patient.appointments.length > MAX_PATIENT_APPOINTMENTS) add(f("name"), `No máximo ${MAX_PATIENT_APPOINTMENTS} consultas por paciente.`);

    // Mesmo WhatsApp = mesmo contato (decisão de 19/out): o nome do contato
    // tem de bater, e o mesmo paciente não aparece em dois cartões.
    if (phone && patient.name) {
      const contact = contacts.get(phone) ?? { name: contactName(patient), selfKeys: [], patients: new Set<string>() };
      contacts.set(phone, contact);
      const identity = `${patient.name.toLocaleLowerCase("pt-BR")}|${patient.birthdate}`;
      if (contact.patients.has(identity)) {
        add(f("name"), "Paciente repetido (mesmo nome, nascimento e WhatsApp): junte as consultas num cartão só.");
      } else if (contact.name !== contactName(patient)) {
        add(
          f(patient.guardianName ? "guardianName" : "phone"),
          "Esse WhatsApp já está em outro cartão com outro responsável. O mesmo WhatsApp é sempre do mesmo responsável.",
        );
      } else if (!patient.guardianName && contact.selfKeys.length > 0) {
        add(f("guardianName"), "Esse WhatsApp já é de outro paciente: informe o responsável.");
      }
      contact.patients.add(identity);
      if (!patient.guardianName) contact.selfKeys.push(patient.key);
    }

    for (const appointment of patient.appointments) {
      const af = (field: Parameters<typeof appointmentField>[2]) => appointmentField(patient.key, appointment.key, field);
      const dateOk = isCalendarDate(appointment.date);
      const timeOk = isClockTime(appointment.time);
      if (!appointment.date) add(af("date"), "Informe a data.");
      else if (!dateOk) add(af("date"), "Data inválida.");
      if (!appointment.time) add(af("time"), "Informe a hora.");
      else if (!timeOk) add(af("time"), "Hora inválida.");
      const start = dateOk && timeOk ? toInstant(appointment.date, appointment.time, timeZone) : null;
      if (start && start.getTime() < now.getTime()) add(af("date"), "Essa data já passou: só consultas de hoje em diante.");

      const service = services.get(appointment.serviceId);
      if (!appointment.serviceId) add(af("serviceId"), "Escolha o serviço.");
      else if (!service) add(af("serviceId"), "Escolha o serviço na lista.");
      if (!appointment.agendaId) add(af("agendaId"), "Escolha a agenda.");
      else if (!agendas.has(appointment.agendaId)) add(af("agendaId"), "Escolha a agenda na lista.");
      else if (service && !pairs.has(`${service.id}|${appointment.agendaId}`)) add(af("agendaId"), "Esse serviço não é atendido nessa agenda.");

      const locationId = appointmentLocationId(appointment, catalog);
      const location = locations.get(locationId);
      if (!locationId) add(af("locationId"), "Escolha o local.");
      else if (!location) add(af("locationId"), "Escolha o local na lista.");
      else if (location.homeVisit && !appointment.homeAddress) add(af("homeAddress"), "Informe o endereço da visita.");

      // Horário ocupado na mesma agenda (turma de exame fica de fora, como no banco).
      if (start && service && !service.group && agendas.has(appointment.agendaId)) {
        const end = new Date(start.getTime() + service.durationMinutes * 60_000);
        const clash = taken.find((t) => t.agendaId === appointment.agendaId && t.start < end && start < t.end);
        if (clash) {
          add(af("time"), clash.mine ? "Choca com outra consulta deste link na mesma agenda." : "Esse horário já está ocupado nessa agenda.");
        } else {
          taken.push({ agendaId: appointment.agendaId, start, end, mine: true });
        }
      }
    }
  }
  return issues;
}

export function countAppointments(patients: ImportPatient[]): number {
  return patients.reduce((total, p) => total + p.appointments.length, 0);
}

// ---------------------------------------------------------------------------
// Situação do pedido
// ---------------------------------------------------------------------------

export type ImportRequestStatus = "sent" | "draft" | "submitted" | "returned" | "loaded" | "undone";

// Mesmas cores do pedido de informações: o que espera o Suporte em amarelo.
export const IMPORT_STATUS: Record<ImportRequestStatus, { label: string; variant: "neutral" | "info" | "warning" | "success" }> = {
  sent: { label: "Link enviado, sem resposta", variant: "neutral" },
  draft: { label: "Em preenchimento", variant: "info" },
  submitted: { label: "Enviada ao Suporte, para conferir", variant: "warning" },
  returned: { label: "Devolvida à clínica", variant: "info" },
  loaded: { label: "Carregada", variant: "success" },
  undone: { label: "Desfeita", variant: "neutral" },
};

/** A clínica ainda preenche pelo link (o prazo é conferido à parte). */
export const isImportOpen = (status: ImportRequestStatus) => status === "sent" || status === "draft" || status === "returned";
