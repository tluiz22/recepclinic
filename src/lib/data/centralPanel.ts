import type { DbClient } from "./clients";
import { unwrap } from "./errors";
import { listUpcomingByPatient, type AgendaAppointment } from "./agenda/view";
import { listInsurancePlans } from "./config/insurance";
import { listPatientNotes, type PatientNote } from "./patientNotes";
import { getContact, listContactPatients, type Contact, type Patient } from "./patients";
import { loadActorLabels } from "./agenda/trail";

// Painel do paciente ao lado da conversa (CN3b; telas T1 opção C, T2, T3 e T5, cliente, 05/nov/2026): quem fala com a
// clínica, os pacientes desse contato com a próxima consulta, as anotações (um só paciente) e os atendimentos
// anteriores da conversa. Só leitura; as ações levam às telas que já existem (ficha, Marcar, Remarcar).

export type PanelPatient = {
  patient: Patient;
  planName: string | null;
  next: AgendaAppointment | null;
};

export type HandoffEvent = {
  kind: "status" | "assigned" | "transferred" | "released" | "finished";
  from: string;
  to: string;
  origin: string;
  actorId: string | null;
  assignedFrom: string | null;
  assignedTo: string | null;
  handoffId: string | null;
  at: Date;
};

export type ConversationPanel = {
  contact: Contact | null;
  /** Ativos, em ordem de nome. */
  patients: PanelPatient[];
  /** O contato é o próprio paciente (um só, `is_contact_self`): painel normal, sem "Quem fala com a clínica". */
  selfPatient: boolean;
  /** Anotações do paciente, quando há um só (as 3 mais novas). */
  notes: PatientNote[];
  events: HandoffEvent[];
  /** Nomes de quem aparece nos eventos (primeiro nome). */
  names: Map<string, string>;
};

/** Eventos do atendimento da conversa (assumir, transferir, encaminhar, finalizar), do mais antigo ao mais novo. */
export async function listHandoffEvents(db: DbClient, clinicId: string, phone: string, limit = 200): Promise<HandoffEvent[]> {
  const rows = unwrap(
    await db
      .from("handoff_events")
      .select("kind, from_status, to_status, origin, actor_id, assigned_from, assigned_to, handoff_id, occurred_at")
      .eq("clinic_id", clinicId)
      .eq("contact_phone", phone)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit),
    "Atendimentos da conversa",
  );
  return rows
    .map((row) => ({
      kind: row.kind as HandoffEvent["kind"],
      from: row.from_status,
      to: row.to_status,
      origin: row.origin,
      actorId: row.actor_id,
      assignedFrom: row.assigned_from,
      assignedTo: row.assigned_to,
      handoffId: row.handoff_id,
      at: new Date(row.occurred_at),
    }))
    .reverse();
}

export async function loadConversationPanel(
  db: DbClient,
  clinicId: string,
  conversation: { contactId: string | null; phone: string },
  options: { insurance: boolean; now?: Date },
): Promise<ConversationPanel> {
  const now = options.now ?? new Date();
  const [contact, events] = await Promise.all([
    conversation.contactId ? getContact(db, clinicId, conversation.contactId).catch(() => null) : Promise.resolve(null),
    listHandoffEvents(db, clinicId, conversation.phone),
  ]);
  const patients = contact ? await listContactPatients(db, clinicId, contact.id) : [];
  const [upcoming, plans, notes] = await Promise.all([
    listUpcomingByPatient(db, clinicId, patients.map((p) => p.id), now),
    options.insurance && patients.some((p) => p.insurance) ? listInsurancePlans(db, clinicId, { includeInactive: true }) : Promise.resolve([]),
    patients.length === 1 ? listPatientNotes(db, clinicId, patients[0].id).catch(() => []) : Promise.resolve([]),
  ]);
  const planName = (patient: Patient) => (patient.insurance ? (plans.find((plan) => plan.id === patient.insurance!.planId)?.name ?? "Convênio") : "Particular");
  const ids = events.flatMap((e) => [e.actorId, e.assignedFrom, e.assignedTo]);
  const labels = await loadActorLabels(db, clinicId, ids);
  return {
    contact,
    patients: patients.map((patient) => ({ patient, planName: options.insurance ? planName(patient) : null, next: upcoming.get(patient.id)?.[0] ?? null })),
    selfPatient: patients.length === 1 && patients[0].isContactSelf,
    notes: notes.slice(0, 3),
    events,
    names: new Map([...labels.entries()].map(([id, label]) => [id, label.isSupport ? "Suporte" : firstNameOf(label.name)])),
  };
}

/** Primeiro nome na conversa; sem nome na clínica, a trilha traz o e-mail: vale o começo dele. */
export function firstNameOf(name: string): string {
  const clean = name.trim();
  return clean.includes("@") ? clean.split("@")[0] : clean.split(/\s+/)[0];
}

/** Texto de um evento na conversa (null = não aparece: o paciente escreveu de novo, a clínica respondeu). */
export function describeHandoffEvent(event: HandoffEvent, names: Map<string, string>): string | null {
  const name = (id: string | null) => (id ? (names.get(id) ?? "alguém da equipe") : null);
  switch (event.kind) {
    case "status":
      return event.from === "bot" ? "Encaminhada à recepção" : null;
    case "assigned":
      return `${name(event.assignedTo)} assumiu a conversa`;
    case "transferred":
      return `Transferida de ${name(event.assignedFrom)} para ${name(event.assignedTo)}`;
    case "released":
      return "Voltou para sem responsável (sem resposta em 30 min)";
    case "finished":
      return finishedText(event, names);
  }
}

/** "finalizado por Ana", "encerrado após 12 h sem mensagem", "finalizado pelo app (#bot)". */
export function finishedText(event: HandoffEvent, names: Map<string, string>): string {
  if (event.origin === "system") return "Atendimento encerrado: 12 h sem mensagem";
  if (event.actorId) return `Atendimento finalizado por ${names.get(event.actorId) ?? "alguém da equipe"}`;
  return "Atendimento finalizado pelo app do WhatsApp";
}
