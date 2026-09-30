// Agregação do funil de agendamento via WhatsApp (Fase 15 · etapa 5) a partir
// de `bot_funnel_events` — funções puras, sem acesso ao banco; a tela
// `/admin/metricas` busca os eventos e só exibe o resultado.

import type { FunnelFlow } from "../whatsapp/funnel";

export interface FunnelEventRow {
  session_id: string;
  flow: FunnelFlow;
  step: string;
  source: "bot" | "web";
  guardian_phone: string;
  guardian_id: string | null;
  metadata: Record<string, unknown> | null;
  occurred_at: string;
}

interface StageDef {
  label: string;
  // Passos (estados da conversa, resultados ou passos da página) que
  // indicam que a tentativa chegou a esta etapa.
  steps: string[];
}

interface FlowDef {
  flow: FunnelFlow;
  label: string;
  stages: StageDef[];
  success: string;
}

const LINK_OPENED_STEPS = ["page_opened", "date_changed", "confirm_failed", "link_expired", "confirmed"];

// Etapas de cada fluxo, na ordem. Uma tentativa conta em todas as etapas até
// a mais avançada que alcançou (ex.: link aberto sem passar pelo estado de
// escolha de criança — lista de 1 só — ainda conta nas etapas anteriores).
export const FLOW_DEFS: FlowDef[] = [
  {
    flow: "booking",
    label: "Agendar consulta",
    success: "confirmed",
    stages: [
      { label: "Iniciaram", steps: ["started"] },
      { label: "Escolheram o local", steps: ["BOOK_HOME_ADDRESS", "BOOK_PATIENT_SELECT", "BOOK_PATIENT_NEW"] },
      { label: "Receberam o link", steps: ["link_sent"] },
      { label: "Abriram o link", steps: LINK_OPENED_STEPS },
      { label: "Confirmaram", steps: ["confirmed"] },
    ],
  },
  {
    flow: "return_booking",
    label: "Agendar retorno",
    success: "confirmed",
    stages: [
      { label: "Iniciaram", steps: ["started"] },
      { label: "Tinham direito", steps: ["BOOK_PATIENT_SELECT", "BOOK_PATIENT_NEW"] },
      { label: "Receberam o link", steps: ["link_sent"] },
      { label: "Abriram o link", steps: LINK_OPENED_STEPS },
      { label: "Confirmaram", steps: ["confirmed"] },
    ],
  },
  {
    flow: "exam",
    label: "Marcar exame",
    success: "confirmed",
    stages: [
      { label: "Iniciaram", steps: ["started"] },
      { label: "Escolheram o exame", steps: ["EXAM_FOR_WHOM", "BOOK_PATIENT_SELECT", "BOOK_PATIENT_NEW"] },
      { label: "Receberam o link", steps: ["link_sent"] },
      { label: "Abriram o link", steps: LINK_OPENED_STEPS },
      { label: "Confirmaram", steps: ["confirmed"] },
    ],
  },
  {
    flow: "reschedule",
    label: "Remarcar",
    success: "confirmed",
    stages: [
      { label: "Iniciaram", steps: ["started"] },
      { label: "Tinham o que remarcar", steps: ["RESCHEDULE_SELECT", "RESCHEDULE_HOME_ADDRESS"] },
      { label: "Receberam o link", steps: ["link_sent"] },
      { label: "Abriram o link", steps: LINK_OPENED_STEPS },
      { label: "Confirmaram", steps: ["confirmed"] },
    ],
  },
  {
    flow: "cancel",
    label: "Cancelar",
    success: "canceled",
    stages: [
      { label: "Iniciaram", steps: ["started"] },
      { label: "Tinham o que cancelar", steps: ["CANCEL_SELECT", "CANCEL_CONFIRM"] },
      { label: "Chegaram à confirmação", steps: ["CANCEL_CONFIRM"] },
      { label: "Cancelaram", steps: ["canceled"] },
    ],
  },
];

// Sem evento novo por esse tempo = tentativa encerrada (o link de agendar
// vale 30min; o timeout de inatividade do bot é 15min).
const IN_PROGRESS_WINDOW_MS = 30 * 60_000;

const REASON_LABELS: Record<string, string> = {
  // blocked
  no_location: "Nenhum local disponível",
  no_exam_types: "Nenhum exame disponível",
  no_guardian: "Telefone sem cadastro",
  no_appointments: "Sem atendimento futuro",
  no_match: "Data de nascimento não conferiu",
  already_scheduled: "Já tinha atendimento marcado",
  return_home_visit: "Última consulta foi domiciliar",
  return_already_used: "Retorno já utilizado",
  return_no_recent_consultation: "Sem consulta dentro do prazo",
  return_deadline_passed: "Prazo do retorno vencido",
  consultation_age_limit: "Acima da idade limite para consulta",
  return_adult: "Paciente 18+ no retorno",
  exam_self_minor: "Menor de 18 marcando exame para si",
  // error / confirm_failed
  link_error: "Erro ao gerar o link",
  // Só em registros antigos (antes da Fase 20, quando cancelar passava pelo Google).
  calendar_error: "Erro no Google Calendar",
  cancel_error: "Erro ao gravar o cancelamento",
  appointment_not_identified: "Atendimento não identificado",
  no_exam_location: "Local de exames não configurado",
  slot_taken: "Horário ocupado ao confirmar",
  return_used: "Retorno já utilizado ao confirmar",
  "1": "Erro ao confirmar",
  // abandoned
  timeout: "tempo esgotado",
  back_to_menu: "voltou ao menu",
};

export function reasonLabel(reason: string | undefined | null): string {
  if (!reason) return "—";
  return REASON_LABELS[reason] ?? reason;
}

export type SessionOutcome = "concluded" | "abandoned" | "blocked" | "declined" | "error" | "in_progress";

interface Session {
  sessionId: string;
  flow: FunnelFlow;
  guardianPhone: string;
  guardianId: string | null;
  startedAt: string;
  lastAt: string;
  events: FunnelEventRow[];
}

export interface FlowFunnel {
  flow: FunnelFlow;
  label: string;
  stages: { label: string; count: number; conversion: number | null }[];
  outcomes: Record<SessionOutcome, number>;
  blockedReasons: { label: string; count: number }[];
}

export interface IncompleteSession {
  sessionId: string;
  flowLabel: string;
  guardianPhone: string;
  guardianId: string | null;
  startedAt: string;
  lastStage: string;
  detail: string;
}

function groupSessions(events: FunnelEventRow[]): Session[] {
  const byId = new Map<string, Session>();
  for (const event of events) {
    let session = byId.get(event.session_id);
    if (!session) {
      session = {
        sessionId: event.session_id,
        flow: event.flow,
        guardianPhone: event.guardian_phone,
        guardianId: event.guardian_id,
        startedAt: event.occurred_at,
        lastAt: event.occurred_at,
        events: [],
      };
      byId.set(event.session_id, session);
    }
    session.events.push(event);
    if (event.occurred_at < session.startedAt) session.startedAt = event.occurred_at;
    if (event.occurred_at > session.lastAt) session.lastAt = event.occurred_at;
    session.guardianId ??= event.guardian_id;
  }
  return [...byId.values()];
}

function maxStageIndex(def: FlowDef, session: Session): number {
  let max = -1;
  for (const event of session.events) {
    def.stages.forEach((stage, index) => {
      if (index > max && stage.steps.includes(event.step)) max = index;
    });
  }
  return max;
}

function findStep(session: Session, step: string): FunnelEventRow | undefined {
  return session.events.find((event) => event.step === step);
}

function classify(def: FlowDef, session: Session, now: number): SessionOutcome {
  if (findStep(session, def.success)) return "concluded";
  if (findStep(session, "blocked")) return "blocked";
  if (findStep(session, "declined")) return "declined";
  if (findStep(session, "error")) return "error";
  if (findStep(session, "abandoned")) return "abandoned";
  if (now - new Date(session.lastAt).getTime() < IN_PROGRESS_WINDOW_MS) return "in_progress";
  return "abandoned";
}

// Motivo exibido pra uma tentativa não concluída: o do erro/abandono
// explícito, ou a última falha ao confirmar na página, se houver.
function incompleteDetail(session: Session, outcome: SessionOutcome): string {
  if (outcome === "error") {
    return reasonLabel(findStep(session, "error")?.metadata?.reason as string | undefined);
  }
  const abandoned = findStep(session, "abandoned");
  if (abandoned) return `Abandonou (${reasonLabel(abandoned.metadata?.reason as string | undefined)})`;
  if (findStep(session, "link_expired")) return "Abriu o link depois de vencer";
  const failures = session.events.filter((event) => event.step === "confirm_failed");
  const lastFailure = failures[failures.length - 1];
  if (lastFailure) return reasonLabel(lastFailure.metadata?.reason as string | undefined);
  return "Parou de responder";
}

export interface FunnelReport {
  flows: FlowFunnel[];
  totals: { started: number; concluded: number; abandoned: number };
  handoffRequests: number;
  incomplete: IncompleteSession[];
}

// `events`: eventos do período (e um pouco depois, pros passos da página de
// tentativas iniciadas no fim do mês). Só entram tentativas cujo início
// ('started') está dentro de [periodStart, periodEnd).
export function buildFunnelReport(
  events: FunnelEventRow[],
  periodStart: Date,
  periodEnd: Date,
  now: Date = new Date()
): FunnelReport {
  const inPeriod = (iso: string) => {
    const time = new Date(iso).getTime();
    return time >= periodStart.getTime() && time < periodEnd.getTime();
  };
  const allSessions = groupSessions(events);
  const sessions = allSessions.filter((session) => {
    const started = findStep(session, "started") ?? (session.flow === "handoff" ? session.events[0] : undefined);
    return started ? inPeriod(started.occurred_at) : false;
  });

  const handoffRequests = sessions.filter((session) => session.flow === "handoff").length;

  // Quem concluiu o mesmo fluxo numa tentativa posterior não precisa de
  // retomada de contato.
  const lastSuccess = new Map<string, number>();
  for (const session of allSessions) {
    const def = FLOW_DEFS.find((d) => d.flow === session.flow);
    if (!def || !findStep(session, def.success)) continue;
    const key = `${session.guardianPhone}:${session.flow}`;
    const startedAt = new Date(session.startedAt).getTime();
    if (startedAt > (lastSuccess.get(key) ?? 0)) lastSuccess.set(key, startedAt);
  }

  const totals = { started: 0, concluded: 0, abandoned: 0 };
  const incomplete: IncompleteSession[] = [];
  const nowMs = now.getTime();

  const flows = FLOW_DEFS.map((def): FlowFunnel => {
    const flowSessions = sessions.filter((session) => session.flow === def.flow);
    const stageCounts = def.stages.map(() => 0);
    const outcomes: Record<SessionOutcome, number> = {
      concluded: 0,
      abandoned: 0,
      blocked: 0,
      declined: 0,
      error: 0,
      in_progress: 0,
    };
    const blockedReasons = new Map<string, number>();

    for (const session of flowSessions) {
      const max = maxStageIndex(def, session);
      for (let i = 0; i <= max; i++) stageCounts[i] += 1;

      const outcome = classify(def, session, nowMs);
      outcomes[outcome] += 1;

      if (outcome === "blocked") {
        const label = reasonLabel(findStep(session, "blocked")?.metadata?.reason as string | undefined);
        blockedReasons.set(label, (blockedReasons.get(label) ?? 0) + 1);
      }

      if (outcome === "abandoned" || outcome === "error") {
        const successAt = lastSuccess.get(`${session.guardianPhone}:${session.flow}`) ?? 0;
        if (successAt < new Date(session.startedAt).getTime()) {
          incomplete.push({
            sessionId: session.sessionId,
            flowLabel: def.label,
            guardianPhone: session.guardianPhone,
            guardianId: session.guardianId,
            startedAt: session.startedAt,
            lastStage: def.stages[Math.max(max, 0)].label,
            detail: incompleteDetail(session, outcome),
          });
        }
      }
    }

    totals.started += flowSessions.length;
    totals.concluded += outcomes.concluded;
    totals.abandoned += outcomes.abandoned;

    return {
      flow: def.flow,
      label: def.label,
      stages: def.stages.map((stage, index) => ({
        label: stage.label,
        count: stageCounts[index],
        conversion: index === 0 || stageCounts[index - 1] === 0 ? null : stageCounts[index] / stageCounts[index - 1],
      })),
      outcomes,
      blockedReasons: [...blockedReasons.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count),
    };
  });

  incomplete.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  return { flows, totals, handoffRequests, incomplete };
}
