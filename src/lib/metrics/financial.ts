import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "./data";
import { appointmentColumns, scopeAppointments, type MetricsFilter } from "./filter";
import type { MetricsPeriod } from "./period";

// Relatório financeiro (Fase 24 · etapa 2): valor esperado pela tabela,
// gravado no atendimento na marcação (`appointments.price_cents`, migração
// 0036) — o pagamento é presencial, fora do sistema. Período pela data do
// atendimento. Colunas: Realizado (Realizada), Previsto (ainda marcado,
// inclusive passado sem comparecimento registrado) e Faltas (Não compareceu,
// com o valor potencialmente perdido). Cancelados ficam fora, e o retorno
// também (incluso na consulta, não gera valor — decisão do cliente ao validar
// a etapa 3).
// As mesmas linhas alimentam a planilha (etapa 3).

export interface Bucket {
  count: number;
  cents: number;
}

export interface FinancialRow {
  label: string;
  kind: "item" | "subtotal" | "total";
  done: Bucket;
  expected: Bucket;
  noShow: Bucket;
}

export interface FinancialReport {
  visits: FinancialRow[];
  exams: FinancialRow[];
  total: FinancialRow;
}

interface AppointmentRow {
  appointment_type: "first_visit" | "return_visit" | "exam";
  status: string;
  price_cents: number | null;
  clinic_location_id: string;
  exam_type_id: string | null;
}

interface LocationRow {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
}

interface ExamTypeRow {
  id: string;
  name: string;
  is_active: boolean;
}

const emptyBucket = (): Bucket => ({ count: 0, cents: 0 });

function emptyRow(label: string, kind: FinancialRow["kind"] = "item"): FinancialRow {
  return { label, kind, done: emptyBucket(), expected: emptyBucket(), noShow: emptyBucket() };
}

function add(row: FinancialRow, appointment: AppointmentRow) {
  const bucket =
    appointment.status === "completed"
      ? row.done
      : appointment.status === "no_show"
        ? row.noShow
        : appointment.status === "scheduled" || appointment.status === "confirmed"
          ? row.expected
          : null;
  if (!bucket) return;
  bucket.count += 1;
  bucket.cents += appointment.price_cents ?? 0;
}

function sum(label: string, kind: FinancialRow["kind"], rows: FinancialRow[]): FinancialRow {
  const result = emptyRow(label, kind);
  for (const row of rows) {
    for (const key of ["done", "expected", "noShow"] as const) {
      result[key].count += row[key].count;
      result[key].cents += row[key].cents;
    }
  }
  return result;
}

const hasData = (row: FinancialRow) => row.done.count + row.expected.count + row.noShow.count > 0;

export async function fetchFinancialReport(
  supabase: SupabaseClient,
  period: MetricsPeriod,
  filter: MetricsFilter | null
): Promise<FinancialReport> {
  const [appointments, { data: locations }, { data: examTypes }] = await Promise.all([
    fetchAllRows<AppointmentRow>("appointments (financeiro)", (from, to) =>
      scopeAppointments(
        supabase
          .from("appointments")
          .select(appointmentColumns("appointment_type, status, price_cents, clinic_location_id, exam_type_id", filter))
          .neq("status", "canceled")
          .neq("appointment_type", "return_visit")
          .gte("scheduled_at", period.start.toISOString())
          .lt("scheduled_at", period.end.toISOString()),
        filter
      )
        .order("scheduled_at")
        .range(from, to)
    ),
    supabase.from("clinic_locations").select("id, name, type, is_active").order("name"),
    supabase.from("exam_types").select("id, name, is_active").order("name"),
  ]);

  // Consulta por local: clínicas (subtotal "Consultório") e domiciliar. Local/exame inativo só aparece se tiver atendimento no período.
  const clinics = ((locations ?? []) as LocationRow[]).filter((location) => location.type === "clinic");
  const homeVisits = ((locations ?? []) as LocationRow[]).filter((location) => location.type === "home_visit");
  const visitRows = new Map<string, FinancialRow>();
  const locationRow = (location: LocationRow, place: string) => {
    const row = emptyRow(`Consulta – ${place}`);
    visitRows.set(location.id, row);
    return { location, row };
  };
  const clinicGroups = clinics.map((location) => locationRow(location, location.name));
  const homeGroups = homeVisits.map((location) =>
    locationRow(location, homeVisits.length > 1 ? location.name : "Domiciliar")
  );

  const examRows = new Map<string, FinancialRow>(
    ((examTypes ?? []) as ExamTypeRow[]).map((exam) => [exam.id, emptyRow(exam.name)])
  );
  const examActive = new Map(((examTypes ?? []) as ExamTypeRow[]).map((exam) => [exam.id, exam.is_active]));
  const otherExams = emptyRow("Exame sem tipo");

  for (const appointment of appointments) {
    if (appointment.appointment_type === "exam") {
      add((appointment.exam_type_id && examRows.get(appointment.exam_type_id)) || otherExams, appointment);
    } else if (appointment.appointment_type === "first_visit") {
      const row = visitRows.get(appointment.clinic_location_id);
      if (row) add(row, appointment);
    }
  }

  const visibleGroup = (group: { location: LocationRow; row: FinancialRow }) =>
    group.location.is_active || hasData(group.row);
  const clinicItems = clinicGroups.filter(visibleGroup).map((group) => group.row);
  const homeItems = homeGroups.filter(visibleGroup).map((group) => group.row);

  const visits: FinancialRow[] = [...clinicItems];
  if (clinicItems.length > 0) visits.push(sum("Consultório", "subtotal", clinicItems));
  visits.push(...homeItems);

  const exams = [...examRows.entries()]
    .filter(([id, row]) => examActive.get(id) || hasData(row))
    .map(([, row]) => row);
  if (hasData(otherExams)) exams.push(otherExams);

  const items = [...clinicItems, ...homeItems, ...exams];
  return { visits, exams, total: sum("Total", "total", items) };
}
