import { todayIn } from "../clinicTime";
import type { DbClient } from "./clients";
import { unwrapAll, unwrapAllIn } from "./errors";
import { listAwaitingRebooking } from "./daily";
import { AGENDA_COLUMNS, toAgendaAppointment, type AgendaAppointment, type AgendaRow } from "./agenda/view";
import { buildFunnelReportFromSessions, listFunnelSessions, type Incomplete } from "./botFunnel";
import { listAgendas } from "./config/agendas";
import { listDueReminders, type DueReminder } from "./patientReminders";
import { listFrequentNoShows, type FrequentNoShow } from "./metrics";
import { loadContactNames, loadPatientContacts, type PatientContact } from "./people";
import { listReturnOpportunities, type ReturnRight } from "./performance";
import { listWaitlist, type WaitlistEntry } from "./waitlist/entries";
import { listHumanAttention, type AttentionItem } from "./whatsapp/attention";
import { listContactsToReview, type ContactToReview } from "./whatsapp/botLimits";
import { listReminderActions, REMINDER_MESSAGE_TYPE, type ReminderAction } from "./whatsapp/reminders";

// Central de Relacionamento (CRM A1, cliente, 27/out/2026): as pendências que
// pedem contato da equipe, numa tela só. Compõe as listas que já existem (as
// mesmas funções, o mesmo RLS); nenhuma regra nova de entrada ou saída. A2
// (27/out): as listas que eram só das Métricas, sem exigir os itens delas. P3
// (28/out): "Lembretes da equipe", os lembretes da ficha com data até hoje.

export type RelationshipTab =
  | "atendimento"
  | "retomar_contato"
  | "retorno"
  | "lembretes"
  | "lembretes_equipe"
  | "aguardando_remarcacao"
  | "faltosos"
  | "lista_espera"
  | "revisar";

/** Ordem das abas na tela (seção 8 do plano). */
export const RELATIONSHIP_TABS: { id: RelationshipTab; label: string }[] = [
  { id: "atendimento", label: "Atendimento" },
  { id: "retomar_contato", label: "Retomar contato" },
  { id: "retorno", label: "Retorno" },
  { id: "lembretes", label: "Lembretes" },
  { id: "lembretes_equipe", label: "Lembretes da equipe" },
  { id: "aguardando_remarcacao", label: "Aguardando remarcação" },
  { id: "faltosos", label: "Faltosos" },
  { id: "lista_espera", label: "Lista de espera" },
  { id: "revisar", label: "Contatos para revisar" },
];

/** Item da lista de origem que cada aba exige (as das Métricas não exigem os itens `metrics_*`). */
const TAB_FEATURE: Partial<Record<RelationshipTab, string>> = {
  atendimento: "whatsapp_bot",
  retomar_contato: "whatsapp_bot",
  revisar: "whatsapp_bot",
  lembretes: "reminders",
  lista_espera: "waitlist",
};

/** Abas que a clínica tem. */
export function relationshipTabs(features: readonly string[]): RelationshipTab[] {
  return RELATIONSHIP_TABS.map((t) => t.id).filter((id) => {
    const feature = TAB_FEATURE[id];
    return !feature || features.includes(feature);
  });
}

// ---------------------------------------------------------------------------
// Retomar contato (Q3): a mesma regra das Métricas, nos últimos 14 dias,
// agrupada por telefone e fluxo (achado 1 da seção 3 do plano)
// ---------------------------------------------------------------------------

export const RECALL_DAYS = 14;

export type RecallGroup = {
  phone: string;
  contactId: string | null;
  /** Nome do contato; null = sem cadastro. */
  contactName: string | null;
  flowLabel: string;
  /** A tentativa mais recente (onde parou e o detalhe). */
  latest: Incomplete;
  attempts: number;
};

/** Uma linha por telefone e fluxo: a tentativa mais recente e quantas foram. */
export function groupRecall(incomplete: readonly Incomplete[]): Omit<RecallGroup, "contactName">[] {
  const groups = new Map<string, Omit<RecallGroup, "contactName">>();
  for (const item of incomplete) {
    const key = `${item.phone}:${item.flowLabel}`;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { phone: item.phone, contactId: item.contactId, flowLabel: item.flowLabel, latest: item, attempts: 1 });
      continue;
    }
    group.attempts++;
    if (item.startedAt > group.latest.startedAt) group.latest = item;
    group.contactId ??= item.contactId;
  }
  return [...groups.values()].sort((a, b) => b.latest.startedAt.getTime() - a.latest.startedAt.getTime());
}

export async function listRecall(db: DbClient, clinicId: string, now: Date = new Date()): Promise<RecallGroup[]> {
  const start = new Date(now.getTime() - RECALL_DAYS * 24 * 60 * 60_000);
  const sessions = await listFunnelSessions(db, clinicId, start, now);
  const groups = groupRecall(buildFunnelReportFromSessions(sessions, now).incomplete);
  const names = await loadContactNames(db, clinicId, groups.map((g) => g.contactId));
  return groups.map((g) => ({ ...g, contactName: (g.contactId && names.get(g.contactId)) || null }));
}

// ---------------------------------------------------------------------------
// Retorno (Oportunidade agora) e Faltosos: as funções das Métricas, nas
// agendas que o login vê (Administrador e Recepção: todas; Recepção restrita: as dela)
// ---------------------------------------------------------------------------

export type ReturnOpportunity = ReturnRight & { person: PatientContact | null };

export async function listReturnOpportunitiesWithPeople(db: DbClient, clinicId: string, agendaIds: string[], now: Date = new Date()): Promise<ReturnOpportunity[]> {
  if (agendaIds.length === 0) return [];
  const opportunities = await listReturnOpportunities(db, clinicId, { agendaIds, locationIds: null }, now);
  const people = await loadPatientContacts(db, clinicId, opportunities.map((o) => o.patientId));
  return opportunities.map((o) => ({ ...o, person: people.get(o.patientId) ?? null }));
}

// ---------------------------------------------------------------------------
// Lembretes que pedem ação (Q4)
// ---------------------------------------------------------------------------

/** Lembretes enviados nesta janela entram na busca (o lembrete sai na véspera ou no dia). */
export const PENDING_REMINDER_DAYS = 7;

export type PendingReminderKind = "not_delivered" | "no_answer";

export type PendingReminder = { appointment: AgendaAppointment; kind: PendingReminderKind; sentAt: Date };

/**
 * O sinal do cartão da Agenda vira pendência (Q4): "Reenviar lembrete"
 * (`resend`) = não entregue; "Reenviar (sem resposta)" (`resend_unanswered`)
 * = sem resposta. Só atendimentos ativos e por vir (`listReminderActions`).
 * Sai sozinho ao confirmar a presença, remarcar ou cancelar (Q11).
 */
export function pendingReminderKind(action: ReminderAction | undefined): PendingReminderKind | null {
  if (action === "resend") return "not_delivered";
  if (action === "resend_unanswered") return "no_answer";
  return null;
}

export async function listPendingReminders(db: DbClient, clinicId: string, now: Date = new Date()): Promise<PendingReminder[]> {
  const since = new Date(now.getTime() - PENDING_REMINDER_DAYS * 24 * 60 * 60_000);
  const messages = await unwrapAll(
    (from, to) =>
      db
        .from("whatsapp_messages")
        .select("appointment_id, created_at")
        .eq("clinic_id", clinicId)
        .eq("direction", "outbound")
        .eq("message_type", REMINDER_MESSAGE_TYPE)
        .not("appointment_id", "is", null)
        .gte("created_at", since.toISOString())
        .order("created_at")
        .order("id")
        .range(from, to),
    "Lembretes pendentes",
  );
  const lastSent = new Map<string, Date>();
  for (const m of messages) lastSent.set(m.appointment_id!, new Date(m.created_at));
  if (lastSent.size === 0) return [];

  const actions = await listReminderActions(db, clinicId, [...lastSent.keys()], now);
  const kinds = new Map<string, PendingReminderKind>();
  for (const [id, action] of actions) {
    const kind = pendingReminderKind(action);
    if (kind) kinds.set(id, kind);
  }
  if (kinds.size === 0) return [];

  const rows = (await unwrapAllIn(
    [...kinds.keys()],
    (chunk, from, to) => db.from("appointments").select(AGENDA_COLUMNS).eq("clinic_id", clinicId).in("id", chunk).order("id").range(from, to),
    "Lembretes pendentes: atendimentos",
  )) as unknown as AgendaRow[];
  return rows
    .map(toAgendaAppointment)
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
    .map((appointment) => ({ appointment, kind: kinds.get(appointment.id)!, sentAt: lastSent.get(appointment.id)! }));
}

// ---------------------------------------------------------------------------
// Listas e contadores (seção 13.4 do plano)
// ---------------------------------------------------------------------------

/** Lista de cada aba; `null` = a leitura falhou (a tela mostra o aviso, nunca 0). */
export type RelationshipLists = {
  atendimento?: AttentionItem[] | null;
  retomar_contato?: RecallGroup[] | null;
  retorno?: ReturnOpportunity[] | null;
  lembretes?: PendingReminder[] | null;
  lembretes_equipe?: DueReminder[] | null;
  aguardando_remarcacao?: AgendaAppointment[] | null;
  faltosos?: FrequentNoShow[] | null;
  lista_espera?: WaitlistEntry[] | null;
  revisar?: ContactToReview[] | null;
};

/** Pendências por aba (o tamanho da lista); `null` = a leitura falhou. */
export type RelationshipCounts = Partial<Record<RelationshipTab, number | null>>;

/**
 * Lê as listas das abas pedidas, com as funções de sempre. O contador é o
 * tamanho da mesma lista (contador = linhas), e a aba aberta reaproveita a
 * lista já lida. Uma fonte que falha não derruba as outras: vira `null` e o
 * erro é avisado.
 */
export async function loadRelationshipLists(
  db: DbClient,
  clinicId: string,
  tabs: readonly RelationshipTab[],
  onError: (tab: RelationshipTab, error: unknown) => void,
  { timeZone, now = new Date() }: { timeZone: string; now?: Date },
): Promise<RelationshipLists> {
  // Agendas que o login vê (RLS), lidas uma vez para Retorno e Faltosos.
  let agendas: Promise<string[]> | null = null;
  const agendaIds = () => (agendas ??= listAgendas(db, clinicId, { includeInactive: true }).then((list) => list.map((a) => a.id)));
  const sources: { [K in RelationshipTab]: () => Promise<NonNullable<RelationshipLists[K]>> } = {
    atendimento: () => listHumanAttention(db, clinicId),
    retomar_contato: () => listRecall(db, clinicId, now),
    retorno: async () => listReturnOpportunitiesWithPeople(db, clinicId, await agendaIds(), now),
    lembretes: () => listPendingReminders(db, clinicId, now),
    lembretes_equipe: () => listDueReminders(db, clinicId, todayIn(timeZone, now)),
    aguardando_remarcacao: () => listAwaitingRebooking(db, clinicId, now),
    faltosos: async () => listFrequentNoShows(db, clinicId, await agendaIds()),
    lista_espera: () => listWaitlist(db, clinicId),
    revisar: () => listContactsToReview(db, clinicId, now),
  };
  const entries = await Promise.all(
    tabs.map(async (tab) => {
      try {
        return [tab, await sources[tab]()] as const;
      } catch (error) {
        onError(tab, error);
        return [tab, null] as const;
      }
    }),
  );
  return Object.fromEntries(entries) as RelationshipLists;
}

/** Contador = linhas da aba; no Atendimento, as conversas que aguardam a clínica (como o número do menu Atendimento). */
export function relationshipCounts(lists: RelationshipLists): RelationshipCounts {
  return Object.fromEntries(
    (Object.entries(lists) as [RelationshipTab, unknown[] | null][]).map(([tab, list]) => [
      tab,
      !list ? null : tab === "atendimento" ? (list as AttentionItem[]).filter((item) => item.status === "waiting").length : list.length,
    ]),
  );
}

/**
 * Abas que somam no número do menu (cliente, 27/out/2026): as pendências que
 * saem quando o motivo deixa de existir (os Lembretes da equipe, com o
 * "Feito", P3). Ficam fora os Faltosos (lista
 * permanente até o registro da etapa C), o Atendimento (já tem o próprio
 * número no menu) e a Lista de espera (quem espera vaga não pede contato).
 */
export const MENU_TABS: readonly RelationshipTab[] = ["retomar_contato", "retorno", "lembretes", "lembretes_equipe", "aguardando_remarcacao", "revisar"];

export function menuTotal(counts: RelationshipCounts): number {
  return MENU_TABS.reduce((total, tab) => total + (counts[tab] ?? 0), 0);
}
