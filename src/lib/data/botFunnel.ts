import type { DbClient } from "./clients";
import { unwrap } from "./errors";
import type { FunnelFlow } from "./whatsapp/funnel";

// Métricas › Funil do bot e Retomar contato (F6.7; Fases 15 e 23 do piloto,
// cliente 05 e 07/out/2026), a partir de `bot_funnel_events`: cada tentativa
// (sessão) com os passos que alcançou, no bot e na página /agendar. Etapas do
// bot novo (F6.3/F6.4). Os passos não guardam a agenda: as abas valem para a
// clínica toda (o filtro por paciente ou responsável vale, pelo telefone).

export type FunnelEventRow = {
  sessionId: string;
  flow: FunnelFlow;
  step: string;
  source: "bot" | "web";
  phone: string;
  contactId: string | null;
  metadata: Record<string, unknown>;
  occurredAt: Date;
};

type StageDef = { label: string; steps: string[] };
type FlowOrigin = "menu" | "reminder";

type FlowDef = {
  id: string;
  flow: FunnelFlow;
  origin?: FlowOrigin;
  label: string;
  stages: StageDef[];
  success: string;
  notes?: (sessions: Session[]) => { label: string; count: number }[];
};

const LINK_OPENED = ["page_opened", "date_changed", "confirm_failed", "link_expired", "confirmed"];
const BOOKING_CHOICES = ["BOOK_AGENDA", "BOOK_LOCATION", "BOOK_HOME_ADDRESS", "BOOK_FOR_WHOM", "for_whom", "BOOK_PATIENT_SELECT", "BOOK_PATIENT_NEW", "BOOK_AGE_LIMIT"];

const countWith = (sessions: Session[], ...steps: string[]) => sessions.filter((s) => s.events.some((e) => steps.includes(e.step))).length;

/** Fluxos e etapas, na ordem (aprovados pelo cliente em 07/out). */
export const FLOW_DEFS: FlowDef[] = [
  {
    id: "booking",
    flow: "booking",
    label: "Marcar consulta",
    success: "confirmed",
    stages: [
      { label: "Iniciaram", steps: ["started"] },
      { label: "Escolheram o serviço", steps: BOOKING_CHOICES },
      { label: "Identificaram o paciente", steps: ["patient_identified"] },
      { label: "Receberam o link", steps: ["link_sent"] },
      { label: "Abriram o link", steps: LINK_OPENED },
      { label: "Confirmaram", steps: ["confirmed"] },
    ],
    notes: (sessions) => {
      const ageLimit = countWith(sessions, "BOOK_AGE_LIMIT");
      const other = countWith(sessions, "age_limit_other_child");
      return [
        { label: `Barradas pela idade limite${ageLimit ? ` (${other} tentaram outra pessoa)` : ""}`, count: ageLimit },
        { label: "Já tinham atendimento marcado", count: countWith(sessions, "already_scheduled") },
      ];
    },
  },
  {
    id: "return_booking",
    flow: "return_booking",
    label: "Marcar retorno",
    success: "confirmed",
    stages: [
      { label: "Iniciaram", steps: ["started"] },
      { label: "Tinham direito", steps: ["RETURN_SELECT", "patient_identified"] },
      { label: "Receberam o link", steps: ["link_sent"] },
      { label: "Abriram o link", steps: LINK_OPENED },
      { label: "Confirmaram", steps: ["confirmed"] },
    ],
  },
  {
    id: "exam",
    flow: "exam",
    label: "Marcar exame",
    success: "confirmed",
    stages: [
      { label: "Iniciaram", steps: ["started"] },
      { label: "Escolheram o exame", steps: ["BOOK_AGENDA", "BOOK_LOCATION", "BOOK_HOME_ADDRESS", "BOOK_FOR_WHOM"] },
      { label: "Disseram para quem", steps: ["for_whom", "BOOK_PATIENT_SELECT", "BOOK_PATIENT_NEW"] },
      { label: "Identificaram o paciente", steps: ["patient_identified"] },
      { label: "Receberam o link", steps: ["link_sent"] },
      { label: "Abriram o link", steps: LINK_OPENED },
      { label: "Confirmaram", steps: ["confirmed"] },
    ],
    notes: (sessions) => [{ label: "Já tinham esse exame marcado", count: countWith(sessions, "already_scheduled") }],
  },
  {
    id: "reschedule_menu",
    flow: "reschedule",
    origin: "menu",
    label: "Remarcar (pelo menu)",
    success: "confirmed",
    stages: [
      { label: "Iniciaram", steps: ["started"] },
      { label: "Tinham o que remarcar", steps: ["RESCHEDULE_SELECT", "RESCHEDULE_HOME_ADDRESS", "link_sent"] },
      { label: "Receberam o link", steps: ["link_sent"] },
      { label: "Abriram o link", steps: LINK_OPENED },
      { label: "Confirmaram", steps: ["confirmed"] },
    ],
  },
  {
    id: "reschedule_reminder",
    flow: "reschedule",
    origin: "reminder",
    label: "Remarcar (pelo lembrete)",
    success: "confirmed",
    stages: [
      { label: "Tocaram em Remarcar", steps: ["started"] },
      { label: "Receberam o link", steps: ["link_sent"] },
      { label: "Abriram o link", steps: LINK_OPENED },
      { label: "Confirmaram", steps: ["confirmed"] },
    ],
  },
  {
    id: "cancel_menu",
    flow: "cancel",
    origin: "menu",
    label: "Cancelar (pelo menu)",
    success: "canceled",
    stages: [
      { label: "Iniciaram", steps: ["started"] },
      { label: "Tinham o que cancelar", steps: ["CANCEL_SELECT", "CANCEL_CONFIRM"] },
      { label: "Chegaram à confirmação", steps: ["CANCEL_CONFIRM"] },
      { label: "Cancelaram", steps: ["canceled"] },
    ],
  },
  {
    id: "cancel_reminder",
    flow: "cancel",
    origin: "reminder",
    label: "Cancelar (pelo lembrete)",
    success: "canceled",
    stages: [
      { label: "Tocaram em Cancelar", steps: ["started"] },
      { label: "Chegaram à confirmação", steps: ["CANCEL_CONFIRM"] },
      { label: "Cancelaram", steps: ["canceled"] },
    ],
  },
];

/** Sem passo novo por esse tempo = tentativa encerrada (o link vale 30 minutos; a conversa para em 15). */
const IN_PROGRESS_MS = 30 * 60_000;

const REASONS: Record<string, string> = {
  no_service: "Nenhum serviço disponível",
  no_contact: "Telefone sem cadastro",
  no_appointments: "Sem atendimento futuro",
  no_match: "Data de nascimento não conferiu",
  inactive: "Atendimento não estava mais ativo",
  already_scheduled: "Já tinha atendimento marcado",
  return_home_visit: "Última consulta foi domiciliar",
  return_already_used: "Retorno já utilizado",
  return_no_recent_consultation: "Sem consulta dentro do prazo",
  return_deadline_passed: "Prazo do retorno vencido",
  consultation_age_limit: "Acima da idade limite",
  self_minor: "Menor de 18 marcando para si",
  limit_future_appointments: "Limite de atendimentos do contato",
  limit_new_patients: "Limite de cadastros do contato",
  limit_no_shows: "Limite de faltas do contato",
  appointment_not_identified: "Atendimento não identificado",
  link_error: "Erro ao gerar o link",
  register_failed: "Erro ao cadastrar o paciente",
  lost_context: "Serviço mudou durante a conversa",
  slot_taken: "Horário ocupado ao confirmar",
  return_used: "Retorno já utilizado ao confirmar",
  duplicate: "Já tinha atendimento ao confirmar",
  failed: "Erro ao confirmar",
  timeout: "tempo esgotado",
  back_to_menu: "voltou ao menu",
  secretary_took_over: "recepção assumiu",
};

export const reasonLabel = (reason: unknown) => (typeof reason === "string" && reason ? (REASONS[reason] ?? reason) : "—");

type Session = { sessionId: string; flow: FunnelFlow; phone: string; contactId: string | null; startedAt: Date; lastAt: Date; events: FunnelEventRow[] };

export type Outcome = "concluded" | "abandoned" | "blocked" | "declined" | "error" | "in_progress";

export type FlowFunnel = {
  id: string;
  label: string;
  stages: { label: string; count: number; conversion: number | null }[];
  outcomes: Record<Outcome, number>;
  blockedReasons: { label: string; count: number }[];
  notes: { label: string; count: number }[];
};

export type Incomplete = {
  sessionId: string;
  flowLabel: string;
  phone: string;
  contactId: string | null;
  startedAt: Date;
  lastStage: string;
  detail: string;
};

export type FunnelReport = {
  flows: FlowFunnel[];
  handoffRequests: number;
  agentTookOver: { total: number; midJourney: number };
  incomplete: Incomplete[];
};

function group(events: FunnelEventRow[]): Session[] {
  const byId = new Map<string, Session>();
  for (const e of events) {
    let s = byId.get(e.sessionId);
    if (!s) {
      s = { sessionId: e.sessionId, flow: e.flow, phone: e.phone, contactId: e.contactId, startedAt: e.occurredAt, lastAt: e.occurredAt, events: [] };
      byId.set(e.sessionId, s);
    }
    s.events.push(e);
    if (e.occurredAt < s.startedAt) s.startedAt = e.occurredAt;
    if (e.occurredAt > s.lastAt) s.lastAt = e.occurredAt;
    s.contactId ??= e.contactId;
  }
  return [...byId.values()];
}

const find = (s: Session, step: string) => s.events.find((e) => e.step === step);
const origin = (s: Session): FlowOrigin => (find(s, "started")?.metadata.source === "reminder" ? "reminder" : "menu");
const matches = (def: FlowDef, s: Session) => s.flow === def.flow && (!def.origin || origin(s) === def.origin);

function maxStage(def: FlowDef, s: Session): number {
  let max = -1;
  for (const e of s.events) def.stages.forEach((stage, i) => i > max && stage.steps.includes(e.step) && (max = i));
  return max;
}

function classify(def: FlowDef, s: Session, now: number): Outcome {
  if (find(s, def.success)) return "concluded";
  if (find(s, "blocked")) return "blocked";
  if (find(s, "declined")) return "declined";
  if (find(s, "error")) return "error";
  if (find(s, "abandoned")) return "abandoned";
  return now - s.lastAt.getTime() < IN_PROGRESS_MS ? "in_progress" : "abandoned";
}

function detail(s: Session, outcome: Outcome): string {
  if (outcome === "error") return reasonLabel(find(s, "error")?.metadata.reason);
  const abandoned = find(s, "abandoned");
  if (abandoned) return `Abandonou (${reasonLabel(abandoned.metadata.reason)})`;
  if (find(s, "link_expired")) return "Abriu o link depois de vencer";
  const failure = s.events.filter((e) => e.step === "confirm_failed").at(-1);
  if (failure) return reasonLabel(failure.metadata.reason);
  return "Parou de responder";
}

/**
 * Relatório das tentativas iniciadas em [start, end). `events` pode trazer
 * passos posteriores (a página aberta depois do fim do período).
 */
export function buildFunnelReport(events: FunnelEventRow[], start: Date, end: Date, now: Date = new Date()): FunnelReport {
  const all = group(events);
  const inPeriod = (s: Session) => {
    const first = find(s, "started") ?? (s.flow === "handoff" ? s.events[0] : undefined);
    return !!first && first.occurredAt >= start && first.occurredAt < end;
  };
  const sessions = all.filter(inPeriod);

  const handoff = sessions.filter((s) => s.flow === "handoff");
  const tookOver = handoff.filter((s) => find(s, "agent_took_over"));

  // Quem concluiu o mesmo fluxo numa tentativa posterior não precisa de retomada.
  const lastSuccess = new Map<string, number>();
  for (const s of all) {
    const def = FLOW_DEFS.find((d) => matches(d, s));
    if (!def || !find(s, def.success)) continue;
    const key = `${s.phone}:${s.flow}`;
    lastSuccess.set(key, Math.max(lastSuccess.get(key) ?? 0, s.startedAt.getTime()));
  }

  const incomplete: Incomplete[] = [];
  const flows = FLOW_DEFS.map((def): FlowFunnel => {
    const list = sessions.filter((s) => matches(def, s));
    const counts = def.stages.map(() => 0);
    const outcomes: Record<Outcome, number> = { concluded: 0, abandoned: 0, blocked: 0, declined: 0, error: 0, in_progress: 0 };
    const blocked = new Map<string, number>();
    for (const s of list) {
      const max = maxStage(def, s);
      for (let i = 0; i <= max; i++) counts[i]++;
      const outcome = classify(def, s, now.getTime());
      outcomes[outcome]++;
      if (outcome === "blocked") {
        const label = reasonLabel(find(s, "blocked")?.metadata.reason);
        blocked.set(label, (blocked.get(label) ?? 0) + 1);
      }
      if ((outcome === "abandoned" || outcome === "error") && (lastSuccess.get(`${s.phone}:${s.flow}`) ?? 0) < s.startedAt.getTime()) {
        incomplete.push({
          sessionId: s.sessionId,
          flowLabel: def.label,
          phone: s.phone,
          contactId: s.contactId,
          startedAt: s.startedAt,
          lastStage: def.stages[Math.max(max, 0)].label,
          detail: detail(s, outcome),
        });
      }
    }
    return {
      id: def.id,
      label: def.label,
      stages: def.stages.map((stage, i) => ({
        label: stage.label,
        count: counts[i],
        conversion: i === 0 || counts[i - 1] === 0 ? null : counts[i] / counts[i - 1],
      })),
      outcomes,
      blockedReasons: [...blocked.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
      notes: def.notes ? def.notes(list).filter((n) => n.count > 0) : [],
    };
  });
  incomplete.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  return {
    flows,
    handoffRequests: handoff.filter((s) => find(s, "requested")).length,
    agentTookOver: { total: tookOver.length, midJourney: tookOver.filter((s) => find(s, "agent_took_over")?.metadata.mid_journey === true).length },
    incomplete,
  };
}

/** Passos das tentativas do período (e até 2 dias depois, para a página aberta mais tarde); só de um telefone, se filtrado. */
export async function listFunnelEvents(db: DbClient, clinicId: string, start: Date, end: Date, phone: string | null = null): Promise<FunnelEventRow[]> {
  let query = db
    .from("bot_funnel_events")
    .select("session_id, flow, step, source, contact_phone, contact_id, metadata, occurred_at")
    .eq("clinic_id", clinicId)
    .gte("occurred_at", start.toISOString())
    .lt("occurred_at", new Date(end.getTime() + 2 * 24 * 60 * 60_000).toISOString())
    .order("occurred_at")
    .limit(20_000);
  if (phone) query = query.eq("contact_phone", phone);
  return unwrap(await query, "Funil do bot").map((r) => ({
    sessionId: r.session_id,
    flow: r.flow as FunnelFlow,
    step: r.step,
    source: r.source as "bot" | "web",
    phone: r.contact_phone,
    contactId: r.contact_id,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    occurredAt: new Date(r.occurred_at),
  }));
}
