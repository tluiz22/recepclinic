import { dayBounds, todayIn } from "../clinicTime";
import type { Enums } from "../supabase/database.types";
import type { DbClient } from "./clients";
import { unwrap } from "./errors";

// Números da tela inicial do painel (Fase 9 do piloto, F4.1), no dia da
// clínica e só das agendas que o login vê (RLS).

/** Comparecimento a registrar: atendimentos que já passaram nesta janela. */
export const PENDING_ATTENDANCE_DAYS = 60;

export type DashboardCounts = {
  consultationsToday: number;
  examsToday: number;
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
        .select("services ( category )")
        .eq("clinic_id", clinicId)
        .neq("status", "canceled")
        .gte("scheduled_at", today.start.toISOString())
        .lt("scheduled_at", today.end.toISOString()),
      "Atendimentos de hoje",
    ) as unknown as { services: { category: Enums<"service_category"> } }[],
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
        .select("appointment_id")
        .eq("clinic_id", clinicId)
        .eq("direction", "outbound")
        .eq("message_type", "appointment_reminder")
        .not("appointment_id", "is", null)
        .gte("created_at", today.start.toISOString())
        .lt("created_at", today.end.toISOString()),
      "Lembretes de hoje",
    ),
  ]);
  if (pending.error) unwrap(pending, "Comparecimento a registrar");

  const remindedIds = [...new Set(reminders.map((r) => r.appointment_id!))];
  const unanswered = remindedIds.length
    ? unwrap(
        await db
          .from("appointments")
          .select("id")
          .eq("clinic_id", clinicId)
          .in("id", remindedIds)
          .is("reminder_response", null),
        "Lembretes sem resposta",
      ).length
    : 0;

  const examsToday = todayRows.filter((row) => row.services.category === "exam").length;
  return {
    consultationsToday: todayRows.length - examsToday,
    examsToday,
    pendingAttendance: pending.count ?? 0,
    unansweredReminders: unanswered,
  };
}
