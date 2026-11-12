import { dayBounds, todayIn } from "../clinicTime";
import type { Enums } from "../supabase/database.types";
import type { DbClient } from "./clients";
import { unwrap } from "./errors";
import { confirmedByReminder } from "../reminderResponse";
import { listBirthdateChecksToConfirm } from "./portalBirthdate";
import { listHumanAttention } from "./whatsapp/attention";
import { listContactsToReview } from "./whatsapp/botLimits";
import { listNumbersWithoutWhatsapp } from "./whatsapp/undeliverable";

// Números da tela inicial do painel (Fase 9 do piloto, F4.1), no dia da
// clínica e só das agendas que o login vê (RLS).

/** Comparecimento a registrar: atendimentos que já passaram nesta janela. */
export const PENDING_ATTENDANCE_DAYS = 60;

export type DashboardCounts = {
  consultationsToday: number;
  examsToday: number;
  /**
   * Meu dia, linha do dia (RX2; C25, cliente, 04/nov/2026, opção B): atendimentos de hoje sem os cancelados, cada
   * um num grupo só (a soma dá o total): já atendidas, faltaram, confirmadas (pelo lembrete ou pela recepção) e a
   * confirmar (o resto: sem resposta ao lembrete ou sem lembrete ainda).
   */
  totalToday: number;
  completedToday: number;
  noShowToday: number;
  confirmedToday: number;
  toConfirmToday: number;
  /** Ainda marcados ou confirmados, já passados: falta registrar realizado ou falta. */
  pendingAttendance: number;
};

type TodayRow = {
  status: Enums<"appointment_status">;
  patient_confirmed_at: string | null;
  reminder_response: string | null;
  services: { category: Enums<"service_category"> };
};

/** O grupo do atendimento de hoje na linha do dia (C25). */
export function todayGroup(row: Omit<TodayRow, "services">): "completed" | "no_show" | "confirmed" | "to_confirm" {
  if (row.status === "completed") return "completed";
  if (row.status === "no_show") return "no_show";
  if (row.status === "confirmed" || row.patient_confirmed_at !== null || confirmedByReminder(row.reminder_response)) return "confirmed";
  return "to_confirm";
}

export async function getDashboardCounts(db: DbClient, clinicId: string, timeZone: string, now: Date = new Date()): Promise<DashboardCounts> {
  const today = dayBounds(todayIn(timeZone, now), timeZone);
  const pendingSince = new Date(now.getTime() - PENDING_ATTENDANCE_DAYS * 24 * 60 * 60_000);

  const [todayRows, pending] = await Promise.all([
    unwrap(
      await db
        .from("appointments")
        .select("status, patient_confirmed_at, reminder_response, services ( category )")
        .eq("clinic_id", clinicId)
        .neq("status", "canceled")
        .gte("scheduled_at", today.start.toISOString())
        .lt("scheduled_at", today.end.toISOString()),
      "Atendimentos de hoje",
    ) as unknown as TodayRow[],
    db
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .in("status", ["scheduled", "confirmed"])
      .lt("scheduled_at", now.toISOString())
      .gte("scheduled_at", pendingSince.toISOString()),
  ]);
  if (pending.error) unwrap(pending, "Comparecimento a registrar");

  const groups = { completed: 0, no_show: 0, confirmed: 0, to_confirm: 0 };
  for (const row of todayRows) groups[todayGroup(row)] += 1;
  const examsToday = todayRows.filter((row) => row.services.category === "exam").length;
  return {
    consultationsToday: todayRows.length - examsToday,
    examsToday,
    totalToday: todayRows.length,
    completedToday: groups.completed,
    noShowToday: groups.no_show,
    confirmedToday: groups.confirmed,
    toConfirmToday: groups.to_confirm,
    pendingAttendance: pending.count ?? 0,
  };
}

/**
 * Contador do Meu dia no menu (RX6, decisão 5.1; cliente, 02/nov/2026): conversas aguardando atendimento humano +
 * conversas com a clínica que ainda não voltaram ao bot + consultas sem presença registrada + contatos a conferir +
 * datas de nascimento a conferir (portal, F5b).
 * Fora dele: "Esperando o paciente" e as listas de Pacientes › Para contatar (têm o próprio número).
 * Cada parte que falha conta 0 e vai para `onError`, para o menu não cair.
 */
export async function getMeuDiaCount(
  db: DbClient,
  clinicId: string,
  features: readonly string[],
  onError: (label: string, error: unknown) => void,
  now: Date = new Date(),
  /** `conversations: false`: sem as conversas (Central ligada: elas têm o número próprio no item Conversas). */
  { conversations = true }: { conversations?: boolean } = {},
): Promise<number> {
  const safe = async (label: string, read: () => Promise<number>) => {
    try {
      return await read();
    } catch (error) {
      onError(label, error);
      return 0;
    }
  };
  const bot = features.includes("whatsapp_bot");
  const pendingSince = new Date(now.getTime() - PENDING_ATTENDANCE_DAYS * 24 * 60 * 60_000);
  const parts = await Promise.all([
    bot && conversations ? safe("conversas", async () => (await listHumanAttention(db, clinicId)).length) : 0,
    safe("presença", async () => {
      const { count, error } = await db
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .in("status", ["scheduled", "confirmed"])
        .lt("scheduled_at", now.toISOString())
        .gte("scheduled_at", pendingSince.toISOString());
      if (error) throw error;
      return count ?? 0;
    }),
    bot ? safe("contatos a conferir", async () => (await listContactsToReview(db, clinicId, now)).length) : 0,
    features.includes("portal") ? safe("datas a conferir", async () => (await listBirthdateChecksToConfirm(db, clinicId)).length) : 0,
    safe("números sem WhatsApp", async () => (await listNumbersWithoutWhatsapp(db, clinicId, now)).length),
  ]);
  return parts.reduce((total, n) => total + n, 0);
}
