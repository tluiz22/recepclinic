import { addDays, dayBounds, formatInstant, localTimeOf, toInstant, todayIn, weekdayOf } from "../../clinicTime";
import { isNationalHoliday } from "../../holidays";
import type { Enums } from "../../supabase/database.types";
import type { DbClient } from "../clients";
import { unwrap, unwrapOne } from "../errors";
import { hasFeature } from "../features";
import { finishJobRun, startJobRun, type JobTrigger } from "../jobRuns";
import { loadClinicHolidays } from "../agenda/slots";
import { getApprovedTemplate, getWhatsappConnection, type TemplateKey } from "./connection";
import { recordOutboundMessage, type SendOutcome } from "./messages";

// Resumo do dia para a equipe (Fases 7 e 22 do piloto), F3.9c. Só com o item
// "Envio do resumo do dia" liberado (D11) e o WhatsApp conectado.
//
// Dois públicos (D2 revista pelo cliente, 05/out/2026):
// - **contatos do resumo** (clínica inteira), separados em consultas
//   (consulta e retorno) e exames; com mais de uma agenda na lista, cada item
//   leva o nome da agenda;
// - **cada profissional** que tem telefone e marcou "Recebe o resumo do dia":
//   só os atendimentos das agendas dele, também separados em consultas e
//   exames.
//
// Dois envios para cada público: o da **véspera** às 18h (atendimentos de
// amanhã) e o **do dia**, 1h antes do início dos atendimentos: a primeira
// janela do dia nas agendas do público (para o profissional, as dele), ou o
// primeiro atendimento se for antes; dia sem janela ou feriado (nacional ou
// da clínica), 6h30; **nunca antes da 0h do próprio dia** (achado 5 da F1,
// cliente, 05/out/2026). O do dia sai de novo se entrar atendimento antes do
// horário já avisado. Lista vazia não envia (nunca "nada marcado"). O envio
// de verdade (template com a lista numa linha só) é de quem chama (F7).

export type SummaryKind = "consultas" | "exames";
export type SummaryVariant = "preview" | "final";

export const SUMMARY_KINDS: SummaryKind[] = ["consultas", "exames"];
export const SUMMARY_LEAD_MINUTES = 60;
export const SUMMARY_FALLBACK_TIME = "06:30";
export const SUMMARY_PREVIEW_TIME = "18:00";

const WEEKDAY_LABELS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function kindOf(category: Enums<"service_category">): SummaryKind {
  return category === "exam" ? "exames" : "consultas";
}

// ---------------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------------

/** Primeira janela ("HH:mm") de cada dia da semana (0 = domingo); null = sem janela. */
export function earliestByWeekday(windows: { weekday: number; startTime: string }[]): (string | null)[] {
  const result: (string | null)[] = Array(7).fill(null);
  for (const window of windows) {
    const time = window.startTime.slice(0, 5);
    const current = result[window.weekday];
    if (current === null || time < current) result[window.weekday] = time;
  }
  return result;
}

/**
 * Quando sai o resumo do dia `date`: 1h antes do que vier primeiro entre a
 * primeira janela e o primeiro atendimento; sem janela (ou dia de folga),
 * 6h30 — ou 1h antes do primeiro atendimento, se for antes. Nunca antes da 0h.
 */
export function computeSummarySendAt(
  date: string,
  windowStart: string | null,
  firstAppointmentAt: Date,
  timeZone: string,
  offDay: boolean,
  leadMinutes: number = SUMMARY_LEAD_MINUTES,
): Date {
  const leadMs = leadMinutes * 60_000;
  const base =
    windowStart && !offDay
      ? toInstant(date, windowStart, timeZone).getTime() - leadMs
      : toInstant(date, SUMMARY_FALLBACK_TIME, timeZone).getTime();
  const sendAt = Math.min(base, firstAppointmentAt.getTime() - leadMs);
  return new Date(Math.max(sendAt, toInstant(date, "00:00", timeZone).getTime()));
}

/** "13:00" → "12h"; "13:30" → "12h30"; antes de 1h → "0h" (nunca na véspera). */
function formatLeadTime(windowStart: string, leadMinutes: number): string {
  const [hours, minutes] = windowStart.split(":").map(Number);
  const total = Math.max(0, hours * 60 + minutes - leadMinutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/** "seg 7h · ter 12h · qui 7h" — dias sem janela ficam de fora. */
export function describeSummarySchedule(starts: (string | null)[], leadMinutes: number = SUMMARY_LEAD_MINUTES): string {
  const parts = starts
    .map((start, weekday) => (start ? `${WEEKDAY_LABELS[weekday]} ${formatLeadTime(start, leadMinutes)}` : null))
    .filter((part): part is string => part !== null);
  return parts.length ? parts.join(" · ") : "nenhuma janela cadastrada";
}

export type SummaryItem = {
  start: Date;
  patientName: string;
  confirmed: boolean;
  /** Endereço do atendimento domiciliar. */
  homeAddress: string | null;
  agendaName: string;
};

/**
 * "▪️ 09h00 - João Silva (✅ confirmado) ▪️ 10h30 - Maria (sem confirmação) -
 * Endereço: Rua X". Numa linha só: parâmetro de template não aceita quebra
 * de linha. `withAgenda`: nome da agenda depois do paciente.
 */
export function buildSummaryList(items: SummaryItem[], timeZone: string, withAgenda: boolean): string {
  return [...items]
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map((item) => {
      const agenda = withAgenda ? ` (${item.agendaName})` : "";
      const presence = item.confirmed ? "(✅ confirmado)" : "(sem confirmação)";
      const base = `▪️ ${formatInstant(item.start, timeZone, "HH'h'mm")} - ${item.patientName}${agenda} ${presence}`;
      return item.homeAddress ? `${base} - Endereço: ${item.homeAddress}` : base;
    })
    .join(" ");
}

// ---------------------------------------------------------------------------
// Envio (de quem chama)
// ---------------------------------------------------------------------------

export type DailySummaryToSend = {
  clinicId: string;
  phone: string;
  /** Contato do resumo ou profissional que recebe. */
  recipientName: string;
  kind: SummaryKind;
  variant: SummaryVariant;
  /** Dia dos atendimentos (calendário da clínica). */
  date: string;
  listText: string;
  template: { name: string; language: string; body?: string | null };
};

export type DailySummarySender = (summary: DailySummaryToSend) => Promise<SendOutcome>;

const TEMPLATE_KEYS: Record<SummaryVariant, Record<SummaryKind, TemplateKey>> = {
  preview: { consultas: "daily_summary_consultations", exames: "daily_summary_exams" },
  final: { consultas: "daily_summary_consultations_today", exames: "daily_summary_exams_today" },
};

const MESSAGE_TYPES: Record<SummaryKind, string> = { consultas: "daily_summary_consultas", exames: "daily_summary_exames" };

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

type Audience = {
  /** null = contatos do resumo (clínica inteira). */
  professionalId: string | null;
  agendaIds: Set<string> | null;
  recipients: Record<SummaryKind, { name: string; phone: string }[]>;
};

type DayAppointment = SummaryItem & { agendaId: string; kind: SummaryKind };

async function loadDayAppointments(db: DbClient, clinicId: string, date: string, timeZone: string): Promise<DayAppointment[]> {
  const { start, end } = dayBounds(date, timeZone);
  const rows = unwrap(
    await db
      .from("appointments")
      .select("scheduled_at, agenda_id, home_visit_address, patient_confirmed_at, services ( category ), patients ( full_name ), agendas ( name )")
      .eq("clinic_id", clinicId)
      .in("status", ["scheduled", "confirmed"])
      .gte("scheduled_at", start.toISOString())
      .lt("scheduled_at", end.toISOString())
      .order("scheduled_at"),
    "Atendimentos",
  ) as unknown as {
    scheduled_at: string;
    agenda_id: string;
    home_visit_address: string | null;
    patient_confirmed_at: string | null;
    services: { category: Enums<"service_category"> };
    patients: { full_name: string };
    agendas: { name: string };
  }[];
  return rows.map((row) => ({
    start: new Date(row.scheduled_at),
    patientName: row.patients.full_name,
    confirmed: row.patient_confirmed_at !== null,
    homeAddress: row.home_visit_address,
    agendaName: row.agendas.name,
    agendaId: row.agenda_id,
    kind: kindOf(row.services.category),
  }));
}

async function loadAudiences(db: DbClient, clinicId: string): Promise<Audience[]> {
  const [recipients, professionals, agendas] = await Promise.all([
    unwrap(
      await db.from("notification_recipients").select("label, phone, receives_consultations, receives_exams").eq("clinic_id", clinicId).eq("is_active", true),
      "Contatos do resumo",
    ),
    unwrap(
      await db
        .from("professionals")
        .select("id, display_name, phone")
        .eq("clinic_id", clinicId)
        .eq("is_active", true)
        .eq("receives_daily_summary", true)
        .not("phone", "is", null),
      "Profissionais",
    ),
    unwrap(await db.from("agendas").select("id, professional_id").eq("clinic_id", clinicId).not("professional_id", "is", null), "Agendas"),
  ]);
  const general: Audience = {
    professionalId: null,
    agendaIds: null,
    recipients: {
      consultas: recipients.filter((r) => r.receives_consultations).map((r) => ({ name: r.label, phone: r.phone })),
      exames: recipients.filter((r) => r.receives_exams).map((r) => ({ name: r.label, phone: r.phone })),
    },
  };
  const own = professionals.map((p): Audience => {
    const recipient = [{ name: p.display_name, phone: p.phone! }];
    return {
      professionalId: p.id,
      agendaIds: new Set(agendas.filter((a) => a.professional_id === p.id).map((a) => a.id)),
      recipients: { consultas: recipient, exames: recipient },
    };
  });
  return [general, ...own];
}

/** Janelas ativas por agenda e tipo de resumo (janela geral vale para os tipos que a agenda atende). */
async function loadWindows(db: DbClient, clinicId: string): Promise<{ agendaId: string; kind: SummaryKind; weekday: number; startTime: string }[]> {
  const [windows, serviceAgendas] = await Promise.all([
    unwrap(
      await db
        .from("availability_windows")
        .select("agenda_id, weekday, start_time, services ( category, is_active ), locations!inner ( is_active ), agendas!inner ( is_active )")
        .eq("clinic_id", clinicId)
        .eq("is_active", true)
        .eq("locations.is_active", true)
        .eq("agendas.is_active", true),
      "Horários de atendimento",
    ) as unknown as {
      agenda_id: string;
      weekday: number;
      start_time: string;
      services: { category: Enums<"service_category">; is_active: boolean } | null;
    }[],
    unwrap(
      await db.from("service_agendas").select("agenda_id, services!inner ( category, is_active )").eq("clinic_id", clinicId).eq("services.is_active", true),
      "Serviços das agendas",
    ) as unknown as { agenda_id: string; services: { category: Enums<"service_category"> } }[],
  ]);
  const kindsOfAgenda = new Map<string, Set<SummaryKind>>();
  for (const row of serviceAgendas) {
    const kinds = kindsOfAgenda.get(row.agenda_id) ?? new Set<SummaryKind>();
    kinds.add(kindOf(row.services.category));
    kindsOfAgenda.set(row.agenda_id, kinds);
  }
  return windows.flatMap((w) => {
    if (w.services && !w.services.is_active) return [];
    const kinds = w.services ? [kindOf(w.services.category)] : [...(kindsOfAgenda.get(w.agenda_id) ?? [])];
    return kinds.map((kind) => ({ agendaId: w.agenda_id, kind, weekday: w.weekday, startTime: w.start_time }));
  });
}

type SendRecord = { kind: SummaryKind; variant: SummaryVariant; professionalId: string | null; firstScheduledAt: Date };

async function loadSends(db: DbClient, clinicId: string, date: string): Promise<SendRecord[]> {
  const rows = unwrap(
    await db
      .from("daily_summary_sends")
      .select("kind, variant, professional_id, first_scheduled_at")
      .eq("clinic_id", clinicId)
      .eq("summary_date", date)
      .order("sent_at", { ascending: false }),
    "Envios do resumo",
  );
  return rows.map((row) => ({
    kind: row.kind as SummaryKind,
    variant: row.variant as SummaryVariant,
    professionalId: row.professional_id,
    firstScheduledAt: new Date(row.first_scheduled_at),
  }));
}

/** Horário do resumo do dia por dia da semana, para a tela (contatos do resumo ou um profissional). */
export async function getSummarySchedule(
  db: DbClient,
  clinicId: string,
  professionalId: string | null = null,
): Promise<Record<SummaryKind, string>> {
  const [windows, agendas, settings] = await Promise.all([
    loadWindows(db, clinicId),
    professionalId
      ? unwrap(await db.from("agendas").select("id").eq("clinic_id", clinicId).eq("professional_id", professionalId), "Agendas").map((a) => a.id)
      : null,
    db
      .from("clinic_settings")
      .select("summary_today_lead_hours")
      .eq("clinic_id", clinicId)
      .maybeSingle()
      .then((r) => unwrapOne(r, "Configuração da clínica")),
  ]);
  const describe = (kind: SummaryKind) =>
    describeSummarySchedule(
      earliestByWeekday(windows.filter((w) => w.kind === kind && (agendas === null || agendas.includes(w.agendaId)))),
      settings.summary_today_lead_hours * 60,
    );
  return { consultas: describe("consultas"), exames: describe("exames") };
}

// ---------------------------------------------------------------------------
// Rodada do agendador
// ---------------------------------------------------------------------------

export type DailySummaryTotals = {
  lists: number;
  professional_lists: number;
  sent: number;
  failed: number;
  not_sent_no_template: number;
  lists_without_recipient: number;
  resent_earlier_start: number;
};

export type DailySummaryResult =
  | { skipped: "not_enabled" | "not_connected" | "not_due" | "disabled" }
  | { runId: number; date: string; totals: DailySummaryTotals };

/**
 * Rodada do resumo para a clínica. `preview` mira amanhã; `final`, hoje. Com
 * o agendador (`scheduled`, de 5 em 5 minutos), só envia o que está na hora
 * e não saiu ainda; manual envia na hora. Só abre uma execução em `job_runs`
 * quando há algo a enviar (chamadas fora da hora não deixam rastro).
 */
export async function runDailySummary(
  db: DbClient,
  clinicId: string,
  { variant, trigger, sender }: { variant: SummaryVariant; trigger: JobTrigger; sender: DailySummarySender },
  now: Date = new Date(),
): Promise<DailySummaryResult> {
  if (!(await hasFeature(db, clinicId, "daily_summary"))) return { skipped: "not_enabled" };
  const connection = await getWhatsappConnection(db, clinicId);
  if (connection?.status !== "connected") return { skipped: "not_connected" };

  const settings = unwrapOne(
    await db
      .from("clinic_settings")
      .select("timezone, summary_preview_enabled, summary_preview_hour, summary_today_enabled, summary_today_lead_hours")
      .eq("clinic_id", clinicId)
      .maybeSingle(),
    "Configuração da clínica",
  );
  const timeZone = settings.timezone;
  const today = todayIn(timeZone, now);
  const date = variant === "preview" ? addDays(today, 1) : today;
  const scheduled = trigger === "scheduled";
  // Opções da clínica (F7; cliente, 07/out/2026): cada envio pode ser desligado; a véspera tem a hora, o do dia as horas antes.
  if (scheduled && !(variant === "preview" ? settings.summary_preview_enabled : settings.summary_today_enabled)) return { skipped: "disabled" };
  const previewTime = `${String(settings.summary_preview_hour).padStart(2, "0")}:00`;
  if (scheduled && variant === "preview" && localTimeOf(now, timeZone) < previewTime) return { skipped: "not_due" };
  const leadMinutes = settings.summary_today_lead_hours * 60;

  const [appointments, audiences, sends] = await Promise.all([
    loadDayAppointments(db, clinicId, date, timeZone),
    loadAudiences(db, clinicId),
    loadSends(db, clinicId, date),
  ]);
  let offDay = false;
  let windowStarts: (agendaIds: Set<string> | null, kind: SummaryKind) => string | null = () => null;
  if (scheduled && variant === "final") {
    const [windows, holidays] = await Promise.all([loadWindows(db, clinicId), loadClinicHolidays(db, clinicId, date, date)]);
    offDay = isNationalHoliday(date) || holidays.has(date);
    windowStarts = (agendaIds, kind) =>
      earliestByWeekday(windows.filter((w) => w.kind === kind && (agendaIds === null || agendaIds.has(w.agendaId))))[weekdayOf(date)];
  }

  // O que está na hora, por público e tipo.
  const due: { audience: Audience; kind: SummaryKind; items: DayAppointment[]; resent: boolean }[] = [];
  for (const audience of audiences) {
    for (const kind of SUMMARY_KINDS) {
      const items = appointments.filter((a) => a.kind === kind && (audience.agendaIds === null || audience.agendaIds.has(a.agendaId)));
      if (items.length === 0) continue;
      if (!scheduled) {
        due.push({ audience, kind, items, resent: false });
        continue;
      }
      const last = sends.find((s) => s.kind === kind && s.variant === variant && s.professionalId === audience.professionalId);
      if (variant === "preview") {
        if (!last) due.push({ audience, kind, items, resent: false });
      } else if (last) {
        // A equipe não pode chegar depois de um paciente que não sabia que existia.
        if (items[0].start.getTime() < last.firstScheduledAt.getTime()) due.push({ audience, kind, items, resent: true });
      } else if (now.getTime() >= computeSummarySendAt(date, windowStarts(audience.agendaIds, kind), items[0].start, timeZone, offDay, leadMinutes).getTime()) {
        due.push({ audience, kind, items, resent: false });
      }
    }
  }
  if (scheduled && due.length === 0) return { skipped: "not_due" };

  const runId = await startJobRun(db, clinicId, "daily_summary", { trigger, variant }, now);
  const totals: DailySummaryTotals = {
    lists: 0,
    professional_lists: 0,
    sent: 0,
    failed: 0,
    not_sent_no_template: 0,
    lists_without_recipient: 0,
    resent_earlier_start: due.filter((d) => d.resent).length,
  };
  try {
    const templates = {
      consultas: await getApprovedTemplate(db, clinicId, TEMPLATE_KEYS[variant].consultas),
      exames: await getApprovedTemplate(db, clinicId, TEMPLATE_KEYS[variant].exames),
    };
    for (const { audience, kind, items } of due) {
      totals.lists++;
      if (audience.professionalId) totals.professional_lists++;
      const recipients = audience.recipients[kind];
      if (recipients.length === 0) totals.lists_without_recipient++;
      const withAgenda = audience.professionalId === null && new Set(items.map((i) => i.agendaId)).size > 1;
      const listText = buildSummaryList(items, timeZone, withAgenda);
      const template = templates[kind];

      for (const recipient of recipients) {
        let status: string;
        let messageId: string | null = null;
        let bodyText: string | undefined;
        if (!template) {
          status = "skipped_no_template";
          totals.not_sent_no_template++;
        } else {
          let outcome: SendOutcome;
          try {
            outcome = await sender({ clinicId, phone: recipient.phone, recipientName: recipient.name, kind, variant, date, listText, template });
          } catch (error) {
            outcome = { sent: false, reason: error instanceof Error ? error.message : String(error) };
          }
          status = outcome.sent ? "sent" : "failed";
          messageId = outcome.sent ? outcome.messageId : null;
          bodyText = outcome.body;
          if (outcome.sent) totals.sent++;
          else totals.failed++;
        }
        await recordOutboundMessage(
          db,
          clinicId,
          {
            phone: recipient.phone,
            contactId: null,
            messageType: MESSAGE_TYPES[kind],
            templateName: template?.name ?? null,
            body: bodyText ?? listText,
            status,
            waMessageId: messageId,
          },
          now,
        );
      }

      // Registra a tentativa (mesmo com falha, template desligado ou sem
      // destinatário): o agendador não repete; o problema aparece em Envios.
      // O da véspera manual não conta, para não segurar o do agendador.
      if (variant === "final" || scheduled) {
        unwrap(
          await db.from("daily_summary_sends").insert({
            clinic_id: clinicId,
            summary_date: date,
            kind,
            variant,
            professional_id: audience.professionalId,
            first_scheduled_at: items[0].start.toISOString(),
            sent_at: now.toISOString(),
          }),
          "Envios do resumo",
        );
      }
    }
  } catch (error) {
    await finishJobRun(db, runId, { totals, error: error instanceof Error ? error.message : String(error) }, now);
    throw error;
  }
  await finishJobRun(db, runId, { totals }, now);
  return { runId, date, totals };
}
