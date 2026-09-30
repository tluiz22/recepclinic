import type { SupabaseClient } from "@supabase/supabase-js";

// Itens das telas de Agenda (dia/semana/mês), lidos só do banco (Fase 20):
// cada atendimento individual, cada turma de exame (vários atendimentos no
// mesmo exame+horário viram um item só, sem nome de paciente — pedido do
// cliente na Fase 11) e cada bloqueio de agenda não removido.

// Colunas que o carregador sempre precisa; cada tela soma as suas.
const BASE_COLUMNS = "id, scheduled_at, duration_minutes, status, is_group_session, exam_type_id, exam_types ( name )";

const ACTIVE_STATUSES = ["scheduled", "confirmed", "completed", "no_show"];

export type AgendaAppointmentRow = {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  status: string;
  is_group_session: boolean;
  exam_type_id: string | null;
  exam_types: { name: string } | null;
  [column: string]: unknown;
};

export type AgendaItem =
  | { kind: "appointment"; start: Date; end: Date; canceled: boolean; appointment: AgendaAppointmentRow }
  | {
      kind: "group_session";
      start: Date;
      end: Date;
      // Turma sem ninguém ativo (todos cancelaram) aparece esmaecida, como
      // o evento cancelado aparecia no Google.
      canceled: boolean;
      examName: string;
      booked: number;
      capacity: number | null;
    }
  | { kind: "block"; start: Date; end: Date; canceled: false; id: string; reason: string };

function fortalezaWeekdayAndTime(date: Date): { weekday: number; time: string } {
  const local = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  return { weekday: local.getUTCDay(), time: local.toISOString().slice(11, 19) };
}

/**
 * Atendimentos que começam em [from, to) — inclusive cancelados, que as telas
 * mostram esmaecidos — e bloqueios que tocam o intervalo. Ordenado por início.
 */
export async function loadAgendaItems(
  supabase: SupabaseClient,
  from: Date,
  to: Date,
  extraAppointmentColumns = ""
): Promise<AgendaItem[]> {
  const columns = extraAppointmentColumns ? `${BASE_COLUMNS}, ${extraAppointmentColumns}` : BASE_COLUMNS;

  const [appointmentsResult, blocksResult] = await Promise.all([
    supabase
      .from("appointments")
      .select(columns)
      .gte("scheduled_at", from.toISOString())
      .lt("scheduled_at", to.toISOString()),
    supabase
      .from("schedule_blocks")
      .select("id, starts_at, ends_at, reason")
      .is("removed_at", null)
      .lt("starts_at", to.toISOString())
      .gt("ends_at", from.toISOString()),
  ]);

  if (appointmentsResult.error) throw appointmentsResult.error;
  if (blocksResult.error) throw blocksResult.error;

  const rows = (appointmentsResult.data ?? []) as unknown as AgendaAppointmentRow[];
  const items: AgendaItem[] = [];

  const sessions = new Map<string, AgendaAppointmentRow[]>();
  for (const row of rows) {
    const start = new Date(row.scheduled_at);
    if (row.is_group_session && row.exam_type_id) {
      const key = `${row.exam_type_id}|${start.toISOString()}`;
      const list = sessions.get(key) ?? [];
      list.push(row);
      sessions.set(key, list);
      continue;
    }
    items.push({
      kind: "appointment",
      start,
      end: new Date(start.getTime() + row.duration_minutes * 60_000),
      canceled: !ACTIVE_STATUSES.includes(row.status),
      appointment: row,
    });
  }

  if (sessions.size) {
    const examTypeIds = [...new Set([...sessions.values()].map((list) => list[0].exam_type_id!))];
    const { data: windows } = await supabase
      .from("exam_type_availability_windows")
      .select("exam_type_id, weekday, start_time, capacity")
      .in("exam_type_id", examTypeIds)
      .eq("is_active", true);

    const capacityByKey = new Map(
      (windows ?? []).map((window) => [`${window.exam_type_id}|${window.weekday}|${window.start_time}`, window.capacity])
    );

    for (const list of sessions.values()) {
      const first = list[0];
      const start = new Date(first.scheduled_at);
      const { weekday, time } = fortalezaWeekdayAndTime(start);
      const booked = list.filter((row) => ACTIVE_STATUSES.includes(row.status)).length;
      items.push({
        kind: "group_session",
        start,
        end: new Date(start.getTime() + first.duration_minutes * 60_000),
        canceled: booked === 0,
        examName: first.exam_types?.name ?? "Exame",
        booked,
        capacity: capacityByKey.get(`${first.exam_type_id}|${weekday}|${time}`) ?? null,
      });
    }
  }

  for (const block of blocksResult.data ?? []) {
    items.push({
      kind: "block",
      start: new Date(block.starts_at),
      end: new Date(block.ends_at),
      canceled: false,
      id: block.id,
      reason: block.reason,
    });
  }

  return items.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function groupSessionTitle(item: Extract<AgendaItem, { kind: "group_session" }>): string {
  return item.capacity != null
    ? `${item.examName} — turma (${item.booked}/${item.capacity} vagas)`
    : `${item.examName} — turma (${item.booked} ${item.booked === 1 ? "vaga ocupada" : "vagas ocupadas"})`;
}
