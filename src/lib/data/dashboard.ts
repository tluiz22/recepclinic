import { dayBounds, todayIn } from "../clinicTime";
import type { Enums } from "../supabase/database.types";
import type { DbClient } from "./clients";
import { unwrap } from "./errors";
import { listReminderTaps } from "./daily";
import { listHumanAttention } from "./whatsapp/attention";
import { listContactsToReview } from "./whatsapp/botLimits";

// Números da tela inicial do painel (Fase 9 do piloto, F4.1), no dia da
// clínica e só das agendas que o login vê (RLS).

/** Comparecimento a registrar: atendimentos que já passaram nesta janela. */
export const PENDING_ATTENDANCE_DAYS = 60;

export type DashboardCounts = {
  consultationsToday: number;
  examsToday: number;
  /** Meu dia, linha do dia (RX2): atendimentos de hoje sem os cancelados, por situação. */
  totalToday: number;
  confirmedToday: number;
  completedToday: number;
  /** Ainda marcados ou confirmados, já passados: falta registrar realizado ou falta. */
  pendingAttendance: number;
  /** Lembretes enviados hoje sem resposta (nenhum botão tocado). */
  unansweredReminders: number;
};

export async function getDashboardCounts(db: DbClient, clinicId: string, timeZone: string, now: Date = new Date()): Promise<DashboardCounts> {
  const today = dayBounds(todayIn(timeZone, now), timeZone);
  const pendingSince = new Date(now.getTime() - PENDING_ATTENDANCE_DAYS * 24 * 60 * 60_000);

  const [todayRows, pending, reminders] = await Promise.all([
    unwrap(
      await db
        .from("appointments")
        .select("status, services ( category )")
        .eq("clinic_id", clinicId)
        .neq("status", "canceled")
        .gte("scheduled_at", today.start.toISOString())
        .lt("scheduled_at", today.end.toISOString()),
      "Atendimentos de hoje",
    ) as unknown as { status: Enums<"appointment_status">; services: { category: Enums<"service_category"> } }[],
    db
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .in("status", ["scheduled", "confirmed"])
      .lt("scheduled_at", now.toISOString())
      .gte("scheduled_at", pendingSince.toISOString()),
    unwrap(
      await db
        .from("whatsapp_messages")
        .select("appointment_id, created_at")
        .eq("clinic_id", clinicId)
        .eq("direction", "outbound")
        .eq("message_type", "appointment_reminder")
        .not("appointment_id", "is", null)
        .gte("created_at", today.start.toISOString())
        .lt("created_at", today.end.toISOString())
        .order("created_at"),
      "Lembretes de hoje",
    ),
  ]);
  if (pending.error) unwrap(pending, "Comparecimento a registrar");

  const sentAt = new Map<string, { at: Date }>();
  for (const r of reminders) sentAt.set(r.appointment_id!, { at: new Date(r.created_at) });
  const remindedIds = [...sentAt.keys()];
  // Quem tocou num botão e depois remarcou continua respondido (a remarcação zera a resposta no atendimento).
  const [withoutResponse, taps] = remindedIds.length
    ? await Promise.all([
        unwrap(
          await db
            .from("appointments")
            .select("id")
            .eq("clinic_id", clinicId)
            .in("id", remindedIds)
            .is("reminder_response", null),
          "Lembretes sem resposta",
        ),
        listReminderTaps(db, clinicId, sentAt),
      ])
    : [[], new Map<string, string>()];
  const unanswered = withoutResponse.filter((row) => !taps.has(row.id)).length;

  const examsToday = todayRows.filter((row) => row.services.category === "exam").length;
  return {
    consultationsToday: todayRows.length - examsToday,
    examsToday,
    totalToday: todayRows.length,
    confirmedToday: todayRows.filter((row) => row.status === "confirmed").length,
    completedToday: todayRows.filter((row) => row.status === "completed").length,
    pendingAttendance: pending.count ?? 0,
    unansweredReminders: unanswered,
  };
}

/**
 * Contador do Meu dia no menu (RX6, decisão 5.1; cliente, 02/nov/2026): conversas aguardando atendimento humano +
 * conversas com a clínica que ainda não voltaram ao bot + consultas sem presença registrada + contatos a conferir.
 * Fora dele: "Esperando o paciente" e as listas de Pacientes › Para contatar (têm o próprio número).
 * Cada parte que falha conta 0 e vai para `onError`, para o menu não cair.
 */
export async function getMeuDiaCount(
  db: DbClient,
  clinicId: string,
  features: readonly string[],
  onError: (label: string, error: unknown) => void,
  now: Date = new Date(),
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
    bot ? safe("conversas", async () => (await listHumanAttention(db, clinicId)).length) : 0,
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
  ]);
  return parts.reduce((total, n) => total + n, 0);
}
