import type { DbClient } from "./clients";
import { unwrap } from "./errors";
import type { FunnelFlow } from "./whatsapp/funnel";

// Métricas › Funil do bot e Retomar contato (F6.7; Fases 15 e 23 do piloto,
// cliente 05 e 07/out/2026), a partir de `bot_funnel_events`: cada tentativa
// (sessão) com os passos que alcançou, no bot e na página /agendar. Etapas do
// bot novo (F6.3/F6.4). Desde a M2 das Métricas (22/out/2026) o banco entrega
// cada tentativa já resumida (`metrics_bot_sessions`: o primeiro registro de
// cada passo e a última falha ao confirmar); as regras dos fluxos ficam aqui.

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

/** Uma tentativa: os passos (o primeiro de cada um; a última falha ao confirmar no fim) e o atendimento ligado. */
export type FunnelSession = {
  sessionId: string;
  flow: FunnelFlow;
  phone: string;
  contactId: string | null;
  startedAt: Date;
  lastAt: Date;
  /** Iniciada dentro do período (as dos 2 dias seguintes só dizem quem concluiu depois). */
  inPeriod: boolean;
  events: FunnelEventRow[];
  appointmentId: string | null;
  appointmentStatus: string | null;
};
type Session = FunnelSession;

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

/** Passos soltos → tentativas iniciadas em [start, end) ou depois (como o banco resume; usado nos testes). */
export function groupEvents(events: FunnelEventRow[], start: Date, end: Date): FunnelSession[] {
  const byId = new Map<string, Session>();
  for (const e of [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())) {
    let s = byId.get(e.sessionId);
    if (!s) {
      s = { sessionId: e.sessionId, flow: e.flow, phone: e.phone, contactId: e.contactId, startedAt: e.occurredAt, lastAt: e.occurredAt, inPeriod: false, events: [], appointmentId: null, appointmentStatus: null };
      byId.set(e.sessionId, s);
    }
    s.events.push(e);
    if (e.occurredAt > s.lastAt) s.lastAt = e.occurredAt;
    s.contactId ??= e.contactId;
    if (typeof e.metadata.appointment_id === "string") s.appointmentId = e.metadata.appointment_id;
  }
  const sessions: Session[] = [];
  for (const s of byId.values()) {
    const first = s.events.find((e) => e.step === "started") ?? (s.flow === "handoff" ? s.events[0] : undefined);
    if (!first || first.occurredAt < start) continue;
    s.startedAt = first.occurredAt;
    s.inPeriod = first.occurredAt < end;
    sessions.push(s);
  }
  return sessions;
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
  return buildFunnelReportFromSessions(groupEvents(events, start, end), now);
}

/** O mesmo relatório, a partir das tentativas já resumidas pelo banco. */
export function buildFunnelReportFromSessions(all: FunnelSession[], now: Date = new Date()): FunnelReport {
  const sessions = all.filter((s) => s.inPeriod);

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

/**
 * Tentativas iniciadas no período (e nos 2 dias seguintes, para saber quem
 * concluiu depois), já resumidas pelo banco; só de um telefone, se filtrado.
 */
export async function listFunnelSessions(db: DbClient, clinicId: string, start: Date, end: Date, phone: string | null = null): Promise<FunnelSession[]> {
  const rows = unwrap(
    await db.rpc("metrics_bot_sessions", { p_clinic_id: clinicId, p_start: start.toISOString(), p_end: end.toISOString() }),
    "Agendamento digital",
  );
  return rows
    .filter((r) => !phone || r.contact_phone === phone)
    .map((r) => {
      const base = { sessionId: r.session_id, flow: r.flow as FunnelFlow, phone: r.contact_phone, contactId: r.contact_id };
      const steps = (r.steps ?? []) as { step: string; metadata: Record<string, unknown> | null; source: string; at: string }[];
      const events: FunnelEventRow[] = steps.map((e) => ({
        ...base,
        step: e.step,
        source: e.source === "web" ? "web" : "bot",
        metadata: e.metadata ?? {},
        occurredAt: new Date(e.at),
      }));
      // A última falha ao confirmar (o motivo que conta), depois dos primeiros passos.
      if (r.last_failure) events.push({ ...base, step: "confirm_failed", source: "web", metadata: r.last_failure as Record<string, unknown>, occurredAt: new Date(r.last_at) });
      return {
        ...base,
        startedAt: new Date(r.started_at),
        lastAt: new Date(r.last_at),
        inPeriod: r.in_period,
        events,
        appointmentId: r.appointment_id,
        appointmentStatus: r.appointment_status,
      };
    });
}

// ---------------------------------------------------------------------------
// Agendamento digital (redesign das Métricas, M5, 22/out/2026): o funil
// consolidado por operação, os desfechos, a tabela por fluxo, os motivos, os
// erros e a recepção. Tentativa ≠ agendamento: aqui se contam tentativas;
// "seguem de pé" confere o atendimento gravado. Marcar consulta, retorno e
// exame somam (são marcações); remarcar e cancelar ficam à parte.
// ---------------------------------------------------------------------------

export type DigitalOperation = "marcar" | "consulta" | "retorno" | "exame" | "remarcar" | "cancelar";
export type DigitalOrigin = "todas" | "menu" | "lembrete";

export const DIGITAL_OPERATIONS: { id: DigitalOperation; label: string }[] = [
  { id: "marcar", label: "Marcar (consulta, retorno e exame)" },
  { id: "consulta", label: "Só consulta" },
  { id: "retorno", label: "Só retorno" },
  { id: "exame", label: "Só exame" },
  { id: "remarcar", label: "Remarcar" },
  { id: "cancelar", label: "Cancelar" },
];

const OPERATION_FLOWS: Record<DigitalOperation, FunnelFlow[]> = {
  marcar: ["booking", "return_booking", "exam"],
  consulta: ["booking"],
  retorno: ["return_booking"],
  exame: ["exam"],
  remarcar: ["reschedule"],
  cancelar: ["cancel"],
};

/** Etapas em comum de cada operação (o retorno tem "tinham direito" no lugar de "identificaram"). */
const CONSOLIDATED: Record<"marcar" | "remarcar" | "cancelar", { label: string; steps: string[] }[]> = {
  marcar: [
    { label: "Iniciaram", steps: ["started"] },
    { label: "Identificaram o paciente", steps: ["patient_identified", "RETURN_SELECT"] },
    { label: "Receberam o link", steps: ["link_sent"] },
    { label: "Abriram o link", steps: LINK_OPENED },
    { label: "Marcaram", steps: ["confirmed"] },
  ],
  remarcar: [
    { label: "Iniciaram", steps: ["started"] },
    { label: "Receberam o link", steps: ["link_sent"] },
    { label: "Abriram o link", steps: LINK_OPENED },
    { label: "Remarcaram", steps: ["confirmed"] },
  ],
  cancelar: [
    { label: "Iniciaram", steps: ["started"] },
    { label: "Chegaram à confirmação", steps: ["CANCEL_CONFIRM"] },
    { label: "Cancelaram", steps: ["canceled"] },
  ],
};

const groupOf = (op: DigitalOperation): "marcar" | "remarcar" | "cancelar" => (op === "remarcar" ? "remarcar" : op === "cancelar" ? "cancelar" : "marcar");

export type DigitalStage = {
  label: string;
  count: number;
  /** Parte de quem iniciou. */
  share: number | null;
  /** Saíram entre esta etapa e a seguinte, e quantos deles barrados pela regra. */
  lostToNext: number;
  blockedHere: number;
  slotTakenHere: number;
  biggestLoss: boolean;
};

export type DigitalFlowRow = {
  id: string;
  group: "Marcar" | "Remarcar" | "Cancelar";
  label: string;
  attempts: number;
  concluded: number;
  /** Base: tentativas já terminadas (sem as em andamento). */
  finished: number;
  stages: { label: string; count: number }[];
  worstStep: { from: string; to: string; lost: number } | null;
  blockedReasons: { label: string; count: number }[];
};

export type DigitalReport = {
  attempts: number;
  outcomes: Record<Outcome, number>;
  /** Base da taxa de conclusão: tentativas já terminadas. */
  finished: number;
  /** Concluídas com o atendimento ligado: de pé (não cancelado), canceladas depois e sem ligação. */
  standing: { standing: number; canceledLater: number; unlinked: number };
  stages: DigitalStage[];
  flows: DigitalFlowRow[];
  blocked: { label: string; count: number }[];
  dropped: { label: string; count: number }[];
  errors: { label: string; count: number }[];
  linkOpenedLate: number;
  slotTaken: number;
  reception: {
    requested: number;
    tookOver: number;
    midJourney: number;
    contactsNeeding: number;
    contactsTotal: number;
    byStep: { label: string; count: number }[];
    withoutStep: number;
  };
};

/** Etapa da conversa em que a pessoa pediu ajuda (M3), em português. */
const JOURNEY_STATES: Record<string, string> = {
  WELCOME: "No menu inicial",
  BOOK_SERVICE: "Escolhendo o serviço",
  BOOK_AGENDA: "Escolhendo a agenda",
  BOOK_LOCATION: "Escolhendo o local",
  BOOK_HOME_ADDRESS: "Informando o endereço",
  BOOK_FOR_WHOM: "Dizendo para quem é",
  BOOK_PATIENT_SELECT: "Escolhendo o paciente",
  BOOK_PATIENT_NEW: "Cadastrando o paciente",
  RETURN_SELECT: "Escolhendo o retorno",
  RESCHEDULE_SELECT: "Escolhendo o que remarcar",
  CANCEL_SELECT: "Escolhendo o que cancelar",
  CANCEL_CONFIRM: "Confirmando o cancelamento",
};

const reached = (s: Session, steps: string[]) => s.events.some((e) => steps.includes(e.step));
const tally = (map: Map<string, number>, label: string) => map.set(label, (map.get(label) ?? 0) + 1);
const sorted = (map: Map<string, number>) => [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));

/** Relatório das tentativas iniciadas no período, pela operação e origem escolhidas. */
export function buildDigitalReport(all: FunnelSession[], now: Date, operation: DigitalOperation = "marcar", originFilter: DigitalOrigin = "todas"): DigitalReport {
  const flows = OPERATION_FLOWS[operation];
  const inPeriod = all.filter((s) => s.inPeriod);
  const sessions = inPeriod.filter(
    (s) => flows.includes(s.flow) && (originFilter === "todas" || (originFilter === "lembrete" ? origin(s) === "reminder" : origin(s) === "menu")),
  );
  const defOf = (s: Session) => FLOW_DEFS.find((d) => matches(d, s))!;
  const outcomes: Record<Outcome, number> = { concluded: 0, abandoned: 0, blocked: 0, declined: 0, error: 0, in_progress: 0 };
  const blocked = new Map<string, number>();
  const dropped = new Map<string, number>();
  const errors = new Map<string, number>();
  let linkOpenedLate = 0;
  let slotTaken = 0;
  const standing = { standing: 0, canceledLater: 0, unlinked: 0 };

  const stagesDef = CONSOLIDATED[groupOf(operation)];
  const stageCounts = stagesDef.map(() => 0);
  const blockedAt = stagesDef.map(() => 0);
  const slotTakenAt = stagesDef.map(() => 0);

  for (const s of sessions) {
    const def = defOf(s);
    const outcome = classify(def, s, now.getTime());
    outcomes[outcome]++;
    let max = -1;
    stagesDef.forEach((stage, i) => {
      if (i === 0 ? reached(s, ["started"]) : reached(s, stage.steps)) max = i;
    });
    // Quem passou de uma etapa passou também pelas anteriores (o passo pode não ter sido gravado).
    for (let i = 0; i <= max; i++) stageCounts[i]++;
    const failure = s.events.filter((e) => e.step === "confirm_failed").at(-1);
    if (outcome === "concluded") {
      if (!s.appointmentId) standing.unlinked++;
      else if (s.appointmentStatus === "canceled") standing.canceledLater++;
      else standing.standing++;
    } else if (outcome === "blocked") {
      tally(blocked, reasonLabel(find(s, "blocked")?.metadata.reason));
      if (max >= 0) blockedAt[max]++;
    } else if (outcome === "error") {
      tally(errors, reasonLabel(find(s, "error")?.metadata.reason));
    } else if (outcome === "declined") {
      tally(dropped, 'Desistiram ("não quero mais")');
    } else if (outcome === "abandoned") {
      const abandoned = find(s, "abandoned");
      const reason = abandoned?.metadata.reason;
      if (failure) {
        // Falha do sistema ao confirmar (ex.: horário ocupado): vai para os erros.
        tally(errors, `Ao confirmar: ${reasonLabel(failure.metadata.reason)}`);
        if (failure.metadata.reason === "slot_taken") {
          slotTaken++;
          if (max >= 0) slotTakenAt[max]++;
        }
      } else if (find(s, "link_expired")) {
        linkOpenedLate++;
        tally(dropped, "Abriram o link depois de vencer");
      } else if (reason === "back_to_menu") tally(dropped, "Voltaram ao menu");
      else if (reason === "secretary_took_over") tally(dropped, "A recepção assumiu");
      else if (reason === "timeout") tally(dropped, "Tempo esgotado na conversa");
      else tally(dropped, "Pararam de responder");
    }
  }

  const first = stageCounts[0];
  const losses = stageCounts.map((count, i) => (i < stageCounts.length - 1 ? count - stageCounts[i + 1] : 0));
  const biggest = losses.reduce((best, lost, i) => (lost > (losses[best] ?? 0) ? i : best), 0);
  const stages: DigitalStage[] = stagesDef.map((stage, i) => ({
    label: stage.label,
    count: stageCounts[i],
    share: first ? stageCounts[i] / first : null,
    lostToNext: losses[i],
    blockedHere: blockedAt[i],
    slotTakenHere: slotTakenAt[i],
    biggestLoss: losses[i] > 0 && i === biggest,
  }));

  // Tabela por fluxo (as linhas do grupo escolhido; sem filtro de origem nas linhas de remarcar e cancelar).
  const rows: DigitalFlowRow[] = FLOW_DEFS.filter((d) => flows.includes(d.flow) && (originFilter === "todas" || !d.origin || d.origin === (originFilter === "lembrete" ? "reminder" : "menu"))).map((def) => {
    const list = inPeriod.filter((s) => matches(def, s));
    const counts = def.stages.map(() => 0);
    const reasons = new Map<string, number>();
    let concluded = 0;
    let inProgress = 0;
    for (const s of list) {
      const max = maxStage(def, s);
      for (let i = 0; i <= max; i++) counts[i]++;
      const outcome = classify(def, s, now.getTime());
      if (outcome === "concluded") concluded++;
      if (outcome === "in_progress") inProgress++;
      if (outcome === "blocked") tally(reasons, reasonLabel(find(s, "blocked")?.metadata.reason));
    }
    let worst: DigitalFlowRow["worstStep"] = null;
    for (let i = 0; i < counts.length - 1; i++) {
      const lost = counts[i] - counts[i + 1];
      if (lost > 0 && (!worst || lost > worst.lost)) worst = { from: def.stages[i].label, to: def.stages[i + 1].label, lost };
    }
    return {
      id: def.id,
      group: def.flow === "reschedule" ? "Remarcar" : def.flow === "cancel" ? "Cancelar" : "Marcar",
      label: def.flow === "reschedule" || def.flow === "cancel" ? (def.origin === "reminder" ? "Pelo lembrete" : "Pelo menu") : def.label.replace("Marcar ", "").replace(/^./, (c) => c.toUpperCase()),
      attempts: list.length,
      concluded,
      finished: list.length - inProgress,
      stages: def.stages.map((stage, i) => ({ label: stage.label, count: counts[i] })),
      worstStep: worst,
      blockedReasons: sorted(reasons),
    };
  });

  // Recepção no WhatsApp: por contato (o pedido não está ligado à tentativa nos registros antigos).
  const handoffs = inPeriod.filter((s) => s.flow === "handoff");
  const requested = handoffs.filter((s) => find(s, "requested"));
  const tookOver = handoffs.filter((s) => find(s, "agent_took_over"));
  const contactsNeeding = new Set(handoffs.map((s) => s.phone));
  const contactsTotal = new Set(inPeriod.map((s) => s.phone));
  const steps = new Map<string, number>();
  let withoutStep = 0;
  for (const s of handoffs) {
    const state = s.events[0]?.metadata.journey_state;
    if (typeof state === "string") tally(steps, JOURNEY_STATES[state] ?? "Outra etapa");
    else withoutStep++;
  }

  return {
    attempts: sessions.length,
    outcomes,
    finished: sessions.length - outcomes.in_progress,
    standing,
    stages,
    flows: rows,
    blocked: sorted(blocked),
    dropped: sorted(dropped),
    errors: sorted(errors),
    linkOpenedLate,
    slotTaken,
    reception: {
      requested: requested.length,
      tookOver: tookOver.length,
      midJourney: tookOver.filter((s) => find(s, "agent_took_over")?.metadata.mid_journey === true).length,
      contactsNeeding: contactsNeeding.size,
      contactsTotal: contactsTotal.size,
      byStep: sorted(steps),
      withoutStep,
    },
  };
}
