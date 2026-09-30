import type { SupabaseClient } from "@supabase/supabase-js";
import type { BusyInterval } from "./slots";

// Nenhum atendimento dura um dia; buscar a partir de 24h antes de `from`
// garante pegar os que começaram antes e ainda estão em andamento.
const MAX_APPOINTMENT_SPAN_MS = 24 * 60 * 60_000;

/**
 * Horários ocupados entre `from` e `to` (Fase 20): atendimentos ativos
 * (inclusive turmas de exame, que ocupam a agenda como qualquer outro) +
 * bloqueios de agenda não removidos. Substituiu o `freeBusy` do Google no
 * cálculo de horários livres — o banco é a única agenda.
 *
 * Os intervalos podem se sobrepor; `computeAvailableSlots` já os mescla.
 */
export async function getBusyIntervals(
  supabase: SupabaseClient,
  from: Date,
  to: Date
): Promise<BusyInterval[]> {
  const [appointmentsResult, blocksResult] = await Promise.all([
    supabase
      .from("appointments")
      .select("scheduled_at, duration_minutes")
      .in("status", ["scheduled", "confirmed"])
      .gte("scheduled_at", new Date(from.getTime() - MAX_APPOINTMENT_SPAN_MS).toISOString())
      .lt("scheduled_at", to.toISOString()),
    supabase
      .from("schedule_blocks")
      .select("starts_at, ends_at")
      .is("removed_at", null)
      .lt("starts_at", to.toISOString())
      .gt("ends_at", from.toISOString()),
  ]);

  // Sem os dados, não dá para saber o que está livre: melhor falhar do que
  // oferecer um horário ocupado.
  if (appointmentsResult.error) throw appointmentsResult.error;
  if (blocksResult.error) throw blocksResult.error;

  const appointments = appointmentsResult.data
    .map((appointment) => {
      const start = new Date(appointment.scheduled_at);
      return {
        start: start.toISOString(),
        end: new Date(start.getTime() + appointment.duration_minutes * 60_000).toISOString(),
      };
    })
    .filter((interval) => new Date(interval.end) > from);

  const blocks = blocksResult.data.map((block) => ({
    start: new Date(block.starts_at).toISOString(),
    end: new Date(block.ends_at).toISOString(),
  }));

  return [...appointments, ...blocks];
}
