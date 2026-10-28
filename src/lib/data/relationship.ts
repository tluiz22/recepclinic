import type { DbClient } from "./clients";
import { unwrapAll, unwrapAllIn } from "./errors";
import { listAwaitingRebooking } from "./daily";
import { AGENDA_COLUMNS, toAgendaAppointment, type AgendaAppointment, type AgendaRow } from "./agenda/view";
import { listWaitlist, type WaitlistEntry } from "./waitlist/entries";
import { listReminderActions, REMINDER_MESSAGE_TYPE, type ReminderAction } from "./whatsapp/reminders";

// Central de Relacionamento (CRM A1, cliente, 27/out/2026): as pendências que
// pedem contato da equipe, numa tela só. Compõe as listas que já existem (as
// mesmas funções, o mesmo RLS); nenhuma regra nova de entrada ou saída.

export type RelationshipTab = "aguardando_remarcacao" | "lembretes" | "lista_espera";

/** Ordem das abas na tela; as das Métricas entram na A2. */
export const RELATIONSHIP_TABS: { id: RelationshipTab; label: string }[] = [
  { id: "aguardando_remarcacao", label: "Aguardando remarcação" },
  { id: "lembretes", label: "Lembretes" },
  { id: "lista_espera", label: "Lista de espera" },
];

/** Abas que a clínica tem: Lembretes e Lista de espera exigem o item da lista de origem. */
export function relationshipTabs(features: readonly string[]): RelationshipTab[] {
  return RELATIONSHIP_TABS.map((t) => t.id).filter(
    (id) => (id !== "lembretes" || features.includes("reminders")) && (id !== "lista_espera" || features.includes("waitlist")),
  );
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
  aguardando_remarcacao?: AgendaAppointment[] | null;
  lembretes?: PendingReminder[] | null;
  lista_espera?: WaitlistEntry[] | null;
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
  now: Date = new Date(),
): Promise<RelationshipLists> {
  const sources: { [K in RelationshipTab]: () => Promise<NonNullable<RelationshipLists[K]>> } = {
    aguardando_remarcacao: () => listAwaitingRebooking(db, clinicId, now),
    lembretes: () => listPendingReminders(db, clinicId, now),
    lista_espera: () => listWaitlist(db, clinicId),
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

export function relationshipCounts(lists: RelationshipLists): RelationshipCounts {
  return Object.fromEntries(
    (Object.entries(lists) as [RelationshipTab, unknown[] | null][]).map(([tab, list]) => [tab, list ? list.length : null]),
  );
}

/**
 * Total do menu: as pendências que pedem contato (Aguardando remarcação e
 * Lembretes). A Lista de espera é de quem espera vaga e não entra, como no
 * Resumo do Dia, onde o contador dela é só informativo.
 */
export function menuTotal(counts: RelationshipCounts): number {
  return (counts.aguardando_remarcacao ?? 0) + (counts.lembretes ?? 0);
}
