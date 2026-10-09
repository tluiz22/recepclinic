import { addDays, dayBounds, formatInstant, localTimeOf, todayIn } from "../../clinicTime";
import type { Enums } from "../../supabase/database.types";
import type { DbClient } from "../clients";
import { unwrap, unwrapOne } from "../errors";
import { hasFeature } from "../features";
import { finishJobRun, startJobRun, type JobTrigger } from "../jobRuns";
import { getApprovedTemplate, getWhatsappConnection, type TemplateKey } from "./connection";
import { recordOutboundMessage, type SendOutcome } from "./messages";

// Resumo do dia (Fases 7 e 22 do piloto), F3.9c; reestruturado pelo cliente
// em 09/out/2026 como "lembretes" à equipe e aos profissionais. Só com o
// WhatsApp conectado e o item do público liberado (D11).
//
// Dois públicos, cada um com o próprio item, opção e horário:
// - **profissional** (item "Lembrete ao profissional (resumo do dia)"): cada
//   profissional que tem telefone e está marcado para receber, só com os
//   atendimentos das agendas dele;
// - **equipe** (item "Lembrete à equipe (resumo do dia)"): os outros contatos,
//   com a clínica inteira; com mais de uma agenda na lista, cada item leva o
//   nome da agenda.
// Cada lista é separada em consultas (consulta e retorno) e exames. **Um envio
// só** por público e dia: na **véspera** (atendimentos de amanhã) ou **no dia**
// (os atendimentos do dia), a partir do horário escolhido (hora cheia das 6h
// às 20h). Lista vazia não envia (nunca "nada marcado"). O envio de verdade
// (template com a lista numa linha só) é de quem chama (F7).

export type SummaryKind = "consultas" | "exames";
export type SummaryVariant = "preview" | "final";

export const SUMMARY_KINDS: SummaryKind[] = ["consultas", "exames"];

export function kindOf(category: Enums<"service_category">): SummaryKind {
  return category === "exam" ? "exames" : "consultas";
}

// ---------------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------------

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

export type SummaryAudience = "professional" | "team";

const AUDIENCE_FEATURE = { professional: "daily_summary", team: "team_summary" } as const;

type Audience = {
  /** null = equipe (outros contatos, clínica inteira). */
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

async function loadAudiences(db: DbClient, clinicId: string, audience: SummaryAudience): Promise<Audience[]> {
  if (audience === "team") {
    const recipients = unwrap(
      await db.from("notification_recipients").select("label, phone, receives_consultations, receives_exams").eq("clinic_id", clinicId).eq("is_active", true),
      "Contatos do resumo",
    );
    return [
      {
        professionalId: null,
        agendaIds: null,
        recipients: {
          consultas: recipients.filter((r) => r.receives_consultations).map((r) => ({ name: r.label, phone: r.phone })),
          exames: recipients.filter((r) => r.receives_exams).map((r) => ({ name: r.label, phone: r.phone })),
        },
      },
    ];
  }
  const [professionals, agendas] = await Promise.all([
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
  return professionals.map((p): Audience => {
    const recipient = [{ name: p.display_name, phone: p.phone! }];
    return {
      professionalId: p.id,
      agendaIds: new Set(agendas.filter((a) => a.professional_id === p.id).map((a) => a.id)),
      recipients: { consultas: recipient, exames: recipient },
    };
  });
}

type SendRecord = { kind: SummaryKind; variant: SummaryVariant; professionalId: string | null };

async function loadSends(db: DbClient, clinicId: string, date: string): Promise<SendRecord[]> {
  const rows = unwrap(
    await db.from("daily_summary_sends").select("kind, variant, professional_id").eq("clinic_id", clinicId).eq("summary_date", date),
    "Envios do resumo",
  );
  return rows.map((row) => ({ kind: row.kind as SummaryKind, variant: row.variant as SummaryVariant, professionalId: row.professional_id }));
}

type AudienceSettings = { timeZone: string; enabled: boolean; timing: "eve" | "same_day"; hour: number };

async function loadAudienceSettings(db: DbClient, clinicId: string, audience: SummaryAudience): Promise<AudienceSettings> {
  const row = unwrapOne(
    await db
      .from("clinic_settings")
      .select("timezone, professional_summary_enabled, professional_summary_timing, professional_summary_hour, team_summary_enabled, team_summary_timing, team_summary_hour")
      .eq("clinic_id", clinicId)
      .maybeSingle(),
    "Configuração da clínica",
  );
  return audience === "professional"
    ? { timeZone: row.timezone, enabled: row.professional_summary_enabled, timing: row.professional_summary_timing as AudienceSettings["timing"], hour: row.professional_summary_hour }
    : { timeZone: row.timezone, enabled: row.team_summary_enabled, timing: row.team_summary_timing as AudienceSettings["timing"], hour: row.team_summary_hour };
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
};

export type DailySummaryResult =
  | { skipped: "not_enabled" | "not_connected" | "not_due" | "disabled" }
  | { runId: number; date: string; totals: DailySummaryTotals };

/**
 * Rodada do resumo de um público para a clínica. Com o agendador
 * (`scheduled`, de 5 em 5 minutos), envia uma vez por dia e público, a partir
 * do horário escolhido: na véspera (amanhã) ou no dia (hoje). Manual envia
 * na hora o da opção escolhida. Só abre uma execução em `job_runs` quando há
 * algo a enviar (chamadas fora da hora não deixam rastro).
 */
export async function runDailySummary(
  db: DbClient,
  clinicId: string,
  { audience, trigger, sender }: { audience: SummaryAudience; trigger: JobTrigger; sender: DailySummarySender },
  now: Date = new Date(),
): Promise<DailySummaryResult> {
  if (!(await hasFeature(db, clinicId, AUDIENCE_FEATURE[audience]))) return { skipped: "not_enabled" };
  const connection = await getWhatsappConnection(db, clinicId);
  if (connection?.status !== "connected") return { skipped: "not_connected" };

  const settings = await loadAudienceSettings(db, clinicId, audience);
  const { timeZone } = settings;
  const scheduled = trigger === "scheduled";
  if (scheduled && !settings.enabled) return { skipped: "disabled" };
  if (scheduled && localTimeOf(now, timeZone) < `${String(settings.hour).padStart(2, "0")}:00`) return { skipped: "not_due" };
  const variant: SummaryVariant = settings.timing === "eve" ? "preview" : "final";
  const today = todayIn(timeZone, now);
  const date = variant === "preview" ? addDays(today, 1) : today;

  const [appointments, audiences, sends] = await Promise.all([
    loadDayAppointments(db, clinicId, date, timeZone),
    loadAudiences(db, clinicId, audience),
    loadSends(db, clinicId, date),
  ]);

  // O que ainda não saiu, por destinatário e tipo (um envio só por dia).
  const due: { audience: Audience; kind: SummaryKind; items: DayAppointment[] }[] = [];
  for (const target of audiences) {
    for (const kind of SUMMARY_KINDS) {
      const items = appointments.filter((a) => a.kind === kind && (target.agendaIds === null || target.agendaIds.has(a.agendaId)));
      if (items.length === 0) continue;
      if (scheduled && sends.some((s) => s.kind === kind && s.variant === variant && s.professionalId === target.professionalId)) continue;
      due.push({ audience: target, kind, items });
    }
  }
  if (scheduled && due.length === 0) return { skipped: "not_due" };

  const runId = await startJobRun(db, clinicId, "daily_summary", { trigger, variant }, now);
  const totals: DailySummaryTotals = { lists: 0, professional_lists: 0, sent: 0, failed: 0, not_sent_no_template: 0, lists_without_recipient: 0 };
  try {
    const templates = {
      consultas: await getApprovedTemplate(db, clinicId, TEMPLATE_KEYS[variant].consultas),
      exames: await getApprovedTemplate(db, clinicId, TEMPLATE_KEYS[variant].exames),
    };
    for (const { audience: target, kind, items } of due) {
      totals.lists++;
      if (target.professionalId) totals.professional_lists++;
      const recipients = target.recipients[kind];
      if (recipients.length === 0) totals.lists_without_recipient++;
      const withAgenda = target.professionalId === null && new Set(items.map((i) => i.agendaId)).size > 1;
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
      // O manual não conta, para não segurar o do agendador.
      if (scheduled) {
        unwrap(
          await db.from("daily_summary_sends").insert({
            clinic_id: clinicId,
            summary_date: date,
            kind,
            variant,
            professional_id: target.professionalId,
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
