import { formatInstant } from "../../clinicTime";
import type { Enums } from "../../supabase/database.types";
import type { DbClient } from "../clients";
import { unwrap } from "../errors";
import type { TrailChannel, TrailEvent } from "./appointments";

// Trilha de um atendimento (F4.8): tudo o que aconteceu com ele (eventos e
// mensagens do WhatsApp), em ordem, com quando, por onde e quem. Quem fez
// aparece pelo nome na clínica (cliente, 05/out/2026: campo "Nome" na
// Equipe), com o papel; sem nome, pelo e-mail; o Suporte, como Suporte.

type ClinicRole = Enums<"clinic_role">;

export type ActorLabel = { name: string; roles: ClinicRole[] | null; isSupport: boolean };

const ROLE_WORD: Record<ClinicRole, string> = { admin: "Administrador", professional: "Profissional", reception: "Recepção" };

/** "Maria (Recepção)", "Suporte RecepClinic (Ana)" ou só o nome/e-mail de quem saiu da equipe. */
export function actorText(actor: ActorLabel | undefined): string | null {
  if (!actor) return null;
  if (actor.isSupport) return `Suporte RecepClinic (${actor.name})`;
  const role = actor.roles?.[0];
  return role ? `${actor.name} (${ROLE_WORD[role]})` : actor.name;
}

/** Nomes de quem fez as ações (toda a equipe da clínica pode ver). */
export async function loadActorLabels(db: DbClient, clinicId: string, userIds: (string | null)[]): Promise<Map<string, ActorLabel>> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (!ids.length) return new Map();
  const rows = unwrap(await db.rpc("clinic_actor_labels", { p_clinic_id: clinicId, p_user_ids: ids }), "Equipe");
  return new Map(rows.map((row) => [row.user_id, { name: row.name, roles: row.roles, isSupport: row.is_support }]));
}

export type TrailEntryRow =
  | { kind: "event"; at: Date; event: TrailEvent; channel: TrailChannel; actorId: string | null; details: Record<string, unknown> }
  | { kind: "message"; at: Date; messageType: string; status: string | null };

export type TrailEntry = { at: Date; text: string; tone: "neutral" | "success" | "danger" };

const VIA: Record<TrailChannel, string> = {
  admin: "pelo painel",
  whatsapp_bot: "pelo WhatsApp",
  booking_link: "pelo link de agendamento",
  cron: "automaticamente",
  mass_cancel: "pela clínica (cancelamento em massa)",
  schedule_block: "pelo bloqueio da agenda",
};

// Nome de cada mensagem, com o gênero para a situação concordar (cliente,
// 18/out/2026: a trilha mostrava o nome interno, como "consultation_guidance").
type Gender = "m" | "f" | "fp";
const MESSAGE_LABELS: Record<string, { label: string; gender: Gender }> = {
  appointment_reminder: { label: "Lembrete", gender: "m" },
  exam_preparation: { label: "Preparo do exame", gender: "m" },
  consultation_guidance: { label: "Orientações gerais da consulta", gender: "fp" },
  appointment_confirmation: { label: "Confirmação do atendimento", gender: "f" },
  appointment_cancellation: { label: "Aviso de cancelamento", gender: "m" },
  appointment_reschedule: { label: "Aviso de remarcação", gender: "m" },
  appointment_mass_cancellation: { label: "Aviso de cancelamento pela clínica (com o link para remarcar)", gender: "m" },
  waitlist_offer: { label: "Oferta da lista de espera", gender: "f" },
  nfse_document: { label: "Nota fiscal", gender: "f" },
};
/** Tipo sem nome cadastrado: "Mensagem", nunca o nome interno. */
const OTHER_MESSAGE = { label: "Mensagem", gender: "f" as Gender };

/** Mensagem não enviada, pelo `kind` gravado na trilha. */
const NOT_SENT_KINDS: Record<string, string> = { reminder: "appointment_reminder" };
const NOT_SENT_REASONS: Record<string, string> = {
  template_disabled: "template não aprovado",
  not_connected: "WhatsApp da clínica não conectado",
};

const agree = (gender: Gender, m: string) => (gender === "m" ? m : gender === "f" ? `${m.slice(0, -1)}a` : `${m.slice(0, -1)}as`);

const MESSAGE_STATUS: Record<string, { word: (g: Gender) => string; tone: TrailEntry["tone"] }> = {
  sent: { word: (g) => agree(g, "enviado"), tone: "neutral" },
  delivered: { word: (g) => (g === "fp" ? "entregues" : "entregue"), tone: "success" },
  read: { word: (g) => agree(g, "lido"), tone: "success" },
  failed: { word: (g) => (g === "fp" ? "não entregues" : "não entregue"), tone: "danger" },
  skipped_no_template: { word: (g) => `não ${agree(g, "enviado")} (template não aprovado)`, tone: "danger" },
};

const ATTENDANCE: Record<string, string> = { completed: "compareceu", no_show: "faltou" };

/** Frase de cada item da trilha (regra pura, testada). */
export function describeTrail(row: TrailEntryRow, actors: Map<string, ActorLabel>, timeZone: string): TrailEntry {
  if (row.kind === "message") {
    const message = MESSAGE_LABELS[row.messageType] ?? OTHER_MESSAGE;
    const status = MESSAGE_STATUS[row.status ?? ""] ?? { word: () => "na fila", tone: "neutral" as const };
    return { at: row.at, text: `WhatsApp: ${message.label} ${status.word(message.gender)}`, tone: status.tone };
  }
  const who = actorText(row.actorId ? actors.get(row.actorId) : undefined);
  const by = who ? ` por ${who}` : "";
  const via = VIA[row.channel] ?? "";
  const when = (iso: unknown) => (typeof iso === "string" ? formatInstant(new Date(iso), timeZone, "dd/MM 'às' HH:mm") : "?");
  const d = row.details;
  const make = (text: string, tone: TrailEntry["tone"] = "neutral"): TrailEntry => ({ at: row.at, text, tone });
  switch (row.event) {
    case "created":
      // Carga da agenda atual na implantação (F10.1c), sem aviso de marcação.
      return make(d.imported ? `Importado na implantação${by}` : `Marcado ${via}${by}`);
    case "rescheduled":
      return make(`Remarcado de ${when(d.from)} para ${when(d.to)} ${via}${by}`);
    case "canceled":
      return make(`Cancelado ${via}${by}`, "danger");
    case "presence_confirmed":
      return make(`Presença confirmada${by}`, "success");
    case "presence_unconfirmed":
      return make(`Presença confirmada desfeita${by}`);
    case "attendance_recorded":
      return make(`Registrado: ${ATTENDANCE[String(d.status)] ?? String(d.status)}${by}`, d.status === "no_show" ? "danger" : "success");
    case "attendance_corrected":
      return make(`Corrigido de "${ATTENDANCE[String(d.from)] ?? d.from}" para "${ATTENDANCE[String(d.to)] ?? d.to}"${by}`);
    case "message_not_sent": {
      const message = MESSAGE_LABELS[NOT_SENT_KINDS[String(d.kind)] ?? ""] ?? OTHER_MESSAGE;
      const reason = NOT_SENT_REASONS[String(d.reason)];
      return make(`WhatsApp: ${message.label} não ${agree(message.gender, "enviado")}${reason ? ` (${reason})` : ""}`, "danger");
    }
    case "reminder_resent":
      return make(`${d.first ? "Lembrete enviado à mão" : "Lembrete reenviado"}${by}`);
    case "preparation_resent":
      return make(`Preparo do exame reenviado${by}`);
    case "guidance_resent":
      return make(`Orientações gerais reenviadas${by}`);
    case "waitlist_joined":
      return make(`Entrou na lista de espera ${via}${by}`);
    case "waitlist_left":
      return make(d.reason === "bot" ? "Saiu da lista de espera pelo WhatsApp" : `Retirado da lista de espera${by}`);
    case "waitlist_advanced":
      return make(`Antecipado pela lista de espera: de ${when(d.from)} para ${when(d.to)}`, "success");
    case "rebooking_dismissed":
      return make(`Marcado como "Desistiu" (sem remarcação)${by}`);
    default:
      return make(String(row.event));
  }
}

/** Trilha do atendimento, do mais antigo ao mais recente. */
export async function listTrail(db: DbClient, clinicId: string, appointmentId: string, timeZone: string): Promise<TrailEntry[]> {
  const [events, messages] = await Promise.all([
    db
      .from("appointment_events")
      .select("event_type, channel, actor_id, details, occurred_at")
      .eq("clinic_id", clinicId)
      .eq("appointment_id", appointmentId)
      .order("occurred_at")
      .then((r) => unwrap(r, "Trilha")),
    db
      .from("whatsapp_messages")
      .select("message_type, status, created_at")
      .eq("clinic_id", clinicId)
      .eq("appointment_id", appointmentId)
      .eq("direction", "outbound")
      .order("created_at")
      .then((r) => unwrap(r, "Mensagens do atendimento")),
  ]);
  const rows: TrailEntryRow[] = [
    ...events.map((e) => ({
      kind: "event" as const,
      at: new Date(e.occurred_at),
      event: e.event_type as TrailEvent,
      channel: e.channel as TrailChannel,
      actorId: e.actor_id,
      details: (e.details ?? {}) as Record<string, unknown>,
    })),
    ...messages.map((m) => ({ kind: "message" as const, at: new Date(m.created_at), messageType: m.message_type ?? "", status: m.status })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  const actors = await loadActorLabels(db, clinicId, rows.map((r) => (r.kind === "event" ? r.actorId : null)));
  return rows.map((row) => describeTrail(row, actors, timeZone));
}
