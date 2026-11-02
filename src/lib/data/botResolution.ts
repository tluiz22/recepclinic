import { IN_PROGRESS_MS, sessionOutcome, sessionStep, type FunnelSession } from "./botFunnel";

// Resolução sem a recepção (EA, cliente, 02/nov/2026; docs/evolucao-assistente.md, seção 4): quanto das
// necessidades dos pacientes o assistente resolve sozinho. Fonte: as mesmas tentativas do funil
// (bot_funnel_events), sem tabela nova. Função pura.
//
// Necessidade = mesmo contato + mesmo tipo (marcar, remarcar, cancelar, dúvida, pedido de recepção) em 24h a partir
// da primeira tentativa (decisão 7), com o melhor desfecho: resolvida > em andamento > recepção > inconclusiva.
// Entra no período pela data da primeira tentativa.
//
// Desfecho de cada tentativa:
// - Marcar, remarcar, cancelar: concluída = resolvida; parou porque pediu a recepção ou a recepção assumiu (ou uma
//   transferência ligada a ela) = recepção; em andamento = em andamento; o resto (abandono, regra, erro, desistência)
//   = inconclusiva.
// - Dúvida (flow "info"): "Resolvido" (ou "Marcar" depois da resposta) = resolvida; "Falar com a recepção" =
//   recepção; sem confirmação = inconclusiva (decisão 8), ou em andamento nos primeiros 30 minutos.
// - Transferência sem tentativa nem dúvida ligada (pedido de recepção, "não entendi", sem horário, recepção que
//   assumiu): pedido de recepção, sempre recepção.
//
// Taxa = resolvidas ÷ (resolvidas + recepção + inconclusivas). As em andamento ficam fora até terminar.

export type NeedType = "marcar" | "remarcar" | "cancelar" | "duvida" | "recepcao";
export type NeedOutcome = "resolved" | "human" | "inconclusive" | "in_progress";

export const NEED_TYPES: { type: NeedType; label: string }[] = [
  { type: "marcar", label: "Marcar (consulta, retorno e exame)" },
  { type: "remarcar", label: "Remarcar" },
  { type: "cancelar", label: "Cancelar" },
  { type: "duvida", label: "Dúvidas" },
  { type: "recepcao", label: "Pedidos de recepção" },
];

export const NEED_WINDOW_MS = 24 * 60 * 60_000;

/** Uma tentativa já classificada. */
export type NeedItem = { phone: string; type: NeedType; startedAt: Date; inPeriod: boolean; outcome: NeedOutcome; unconfirmed: boolean };

/** Uma necessidade: as tentativas do mesmo contato e tipo na janela de 24h. */
export type Need = { phone: string; type: NeedType; startedAt: Date; outcome: NeedOutcome; attempts: number; unconfirmed: boolean };

type Counts = { total: number; resolved: number; human: number; inconclusive: number; inProgress: number };

export type ResolutionReport = Counts & {
  /** Base da taxa: resolvidas + recepção + inconclusivas. */
  eligible: number;
  rate: number | null;
  /** Dúvidas respondidas sem o "Resolvido" (dentro das inconclusivas). */
  unconfirmed: number;
  byType: (Counts & { type: NeedType; label: string; eligible: number; rate: number | null })[];
  /** Por dia da primeira tentativa (chave "yyyy-MM-dd" no fuso da clínica). */
  byDay: { day: string; eligible: number; resolved: number; rate: number | null }[];
};

const TYPE_OF_FLOW: Partial<Record<FunnelSession["flow"], NeedType>> = {
  booking: "marcar",
  return_booking: "marcar",
  exam: "marcar",
  reschedule: "remarcar",
  cancel: "cancelar",
  info: "duvida",
};

const RANK: Record<NeedOutcome, number> = { resolved: 3, in_progress: 2, human: 1, inconclusive: 0 };

/** Tentativas → itens classificados (transferências ligadas a uma tentativa ou dúvida não contam à parte). */
export function classifyNeedItems(sessions: FunnelSession[], now: Date): NeedItem[] {
  const handoffs = sessions.filter((s) => s.flow === "handoff");
  // Tentativas e dúvidas que terminaram com a recepção.
  const linked = new Set<string>();
  for (const h of handoffs) {
    const meta = h.events[0]?.metadata ?? {};
    for (const key of ["journey_session_id", "info_session_id"] as const) if (typeof meta[key] === "string") linked.add(meta[key] as string);
  }
  const known = new Set(sessions.map((s) => s.sessionId));
  const items: NeedItem[] = [];
  for (const s of sessions) {
    const base = { phone: s.phone, startedAt: s.startedAt, inPeriod: s.inPeriod, unconfirmed: false };
    if (s.flow === "handoff") {
      const meta = s.events[0]?.metadata ?? {};
      const link = [meta.journey_session_id, meta.info_session_id].find((id) => typeof id === "string" && known.has(id));
      if (link) continue;
      items.push({ ...base, type: "recepcao", outcome: "human" });
      continue;
    }
    const type = TYPE_OF_FLOW[s.flow];
    if (!type) continue;
    if (type === "duvida") {
      const outcome: NeedOutcome = sessionStep(s, "resolved")
        ? "resolved"
        : sessionStep(s, "escalated") || linked.has(s.sessionId)
          ? "human"
          : sessionStep(s, "not_resolved") || now.getTime() - s.lastAt.getTime() >= IN_PROGRESS_MS
            ? "inconclusive"
            : "in_progress";
      items.push({ ...base, type, outcome, unconfirmed: outcome === "inconclusive" && !sessionStep(s, "not_resolved") });
      continue;
    }
    const result = sessionOutcome(s, now);
    if (!result) continue;
    const reason = sessionStep(s, "abandoned")?.metadata.reason;
    const outcome: NeedOutcome =
      result === "concluded"
        ? "resolved"
        : result === "in_progress"
          ? "in_progress"
          : linked.has(s.sessionId) || reason === "reception_requested" || reason === "secretary_took_over"
            ? "human"
            : "inconclusive";
    items.push({ ...base, type, outcome });
  }
  return items;
}

/** Itens → necessidades iniciadas no período (mesmo contato e tipo em 24h, melhor desfecho). */
export function groupNeeds(items: NeedItem[]): Need[] {
  const sorted = [...items].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const open = new Map<string, Need & { inPeriod: boolean }>();
  const needs: (Need & { inPeriod: boolean })[] = [];
  for (const item of sorted) {
    const key = `${item.phone}:${item.type}`;
    const current = open.get(key);
    if (current && item.startedAt.getTime() - current.startedAt.getTime() < NEED_WINDOW_MS) {
      current.attempts++;
      if (RANK[item.outcome] > RANK[current.outcome]) current.outcome = item.outcome;
      current.unconfirmed = current.outcome === "inconclusive" && (current.unconfirmed || item.unconfirmed);
      continue;
    }
    const need = { phone: item.phone, type: item.type, startedAt: item.startedAt, outcome: item.outcome, attempts: 1, unconfirmed: item.unconfirmed, inPeriod: item.inPeriod };
    open.set(key, need);
    needs.push(need);
  }
  return needs.filter((n) => n.inPeriod).map(({ inPeriod: _, ...need }) => need);
}

const emptyCounts = (): Counts => ({ total: 0, resolved: 0, human: 0, inconclusive: 0, inProgress: 0 });

function add(counts: Counts, outcome: NeedOutcome): void {
  counts.total++;
  if (outcome === "resolved") counts.resolved++;
  else if (outcome === "human") counts.human++;
  else if (outcome === "inconclusive") counts.inconclusive++;
  else counts.inProgress++;
}

const eligibleOf = (c: Counts) => c.resolved + c.human + c.inconclusive;
const rateOf = (c: Counts) => (eligibleOf(c) ? c.resolved / eligibleOf(c) : null);

/** Relatório do período: `dayOf` dá o dia (fuso da clínica) da primeira tentativa. */
export function buildResolutionReport(sessions: FunnelSession[], now: Date, dayOf: (date: Date) => string): ResolutionReport {
  const needs = groupNeeds(classifyNeedItems(sessions, now));
  const total = emptyCounts();
  const byType = new Map<NeedType, Counts>(NEED_TYPES.map((t) => [t.type, emptyCounts()]));
  const byDay = new Map<string, Counts>();
  let unconfirmed = 0;
  for (const need of needs) {
    add(total, need.outcome);
    add(byType.get(need.type)!, need.outcome);
    const day = dayOf(need.startedAt);
    if (!byDay.has(day)) byDay.set(day, emptyCounts());
    add(byDay.get(day)!, need.outcome);
    if (need.unconfirmed) unconfirmed++;
  }
  return {
    ...total,
    eligible: eligibleOf(total),
    rate: rateOf(total),
    unconfirmed,
    byType: NEED_TYPES.map(({ type, label }) => {
      const c = byType.get(type)!;
      return { type, label, ...c, eligible: eligibleOf(c), rate: rateOf(c) };
    }),
    byDay: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, c]) => ({ day, eligible: eligibleOf(c), resolved: c.resolved, rate: rateOf(c) })),
  };
}
