// Funil do portal (frente Usabilidade, U1; cliente 13/nov/2026): a visita anônima. O cookie guarda o id da visita, a
// clínica e o passo mais longe; a página só grava quando o passo avança. Sem nome, celular nem IP.

export const VISIT_COOKIE = "rc_visita";
/** Uma visita dura como a sessão do portal: depois disso, outra. */
export const VISIT_TTL_MS = 2 * 60 * 60_000;

export type VisitEntry = "clinic" | "professional" | "whatsapp";

/** Passos na ordem do caminho (o número é o gravado em `portal_visits.furthest`). */
export const VISIT_STEPS = [
  { step: 1, id: "entry", label: "Entraram no portal", where: "Página da clínica, do profissional ou link do WhatsApp" },
  { step: 2, id: "professionals", label: "Viram a lista de profissionais", where: "Depois de escolher a especialidade" },
  { step: 3, id: "professional", label: "Escolheram o profissional", where: "Tipo de atendimento: particular ou convênio" },
  { step: 4, id: "times", label: "Viram os horários", where: "Calendário com os dias livres" },
  { step: 5, id: "time", label: "Escolheram um horário", where: "Tela de confirmar o celular" },
  { step: 6, id: "held", label: "Reservaram o horário", where: "Celular confirmado; escolhem para quem é a consulta" },
  { step: 7, id: "review", label: "Chegaram à revisão", where: "Resumo antes de confirmar" },
  { step: 8, id: "booked", label: "Marcaram", where: "Consulta criada na agenda" },
] as const;

export type VisitStepId = (typeof VISIT_STEPS)[number]["id"];
export const stepNumber = (id: VisitStepId): number => VISIT_STEPS.find((s) => s.id === id)!.step;

export type VisitCookie = { id: string; clinic: string; furthest: number; entry: VisitEntry };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ENTRIES: readonly VisitEntry[] = ["clinic", "professional", "whatsapp"];

export const formatVisitCookie = (c: VisitCookie) => `${c.id}.${c.clinic}.${c.furthest}.${c.entry}`;

export function parseVisitCookie(raw: string | null | undefined): VisitCookie | null {
  if (!raw || raw.length > 140) return null;
  const [id, clinic, step, entry, ...rest] = raw.split(".");
  const furthest = Number(step);
  if (rest.length || !UUID.test(id ?? "") || !UUID.test(clinic ?? "") || !Number.isInteger(furthest) || furthest < 1 || furthest > 8) return null;
  if (!ENTRIES.includes(entry as VisitEntry)) return null;
  return { id, clinic, furthest, entry: entry as VisitEntry };
}

/**
 * Robôs de busca, prévias de link e ferramentas não contam; sem navegador identificado, também não. Nomes de robô
 * só com a barra da versão ("Googlebot/2.1"), para não pegar celulares como o CUBOT; a prévia do WhatsApp e do
 * Telegram começa pelo nome do aplicativo (o navegador dentro do aplicativo, não).
 */
export function isBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  return /[a-z]bot\/|\bbot\b|crawler|spider|slurp|facebookexternalhit|^whatsapp\/|^telegrambot|^curl\/|^wget\/|^python|headlesschrome|lighthouse/i.test(userAgent);
}

/** Passo a partir do qual não se abre visita nova sem o cookie (aba reaberta depois de 2 horas, outro navegador). */
export const NEW_VISIT_MAX_STEP = 4;

/**
 * O que fazer ao abrir um passo: `write` grava no banco (visita nova ou passo à frente); `cookie` renova o prazo do
 * cookie (2 horas desde a última tela) mesmo sem gravar. A entrada é a da primeira tela da visita.
 */
export type VisitPlan = { write: boolean; cookie: VisitCookie } | null;

export function planVisit(current: VisitCookie | null, clinicId: string, step: number, entry: VisitEntry, newId: () => string): VisitPlan {
  const clinic = clinicId.toLowerCase();
  if (current && current.clinic === clinic) {
    if (step <= current.furthest) return { write: false, cookie: current };
    return { write: true, cookie: { ...current, furthest: step } };
  }
  if (step > NEW_VISIT_MAX_STEP) return null;
  return { write: true, cookie: { id: newId(), clinic, furthest: step, entry } };
}

export type StepCount = { entry: VisitEntry; furthest: number; visits: number };
export type FunnelRow = { step: number; id: VisitStepId; label: string; where: string; reached: number; share: number | null; stoppedHere: number };

/** Funil: quem chegou ao menos até cada passo (passo pulado conta como passado) e quantos pararam ali. */
export function visitFunnel(rows: readonly StepCount[], entry: VisitEntry | null = null): FunnelRow[] {
  const picked = entry ? rows.filter((r) => r.entry === entry) : rows;
  const stopped = new Map<number, number>();
  for (const r of picked) stopped.set(r.furthest, (stopped.get(r.furthest) ?? 0) + r.visits);
  const total = [...stopped.values()].reduce((a, b) => a + b, 0);
  return VISIT_STEPS.map((s) => {
    let reached = 0;
    for (const [furthest, n] of stopped) if (furthest >= s.step) reached += n;
    return { ...s, reached, share: total > 0 ? reached / total : null, stoppedHere: s.step === 8 ? 0 : (stopped.get(s.step) ?? 0) };
  });
}

/** O passo onde mais visitas pararam (fora o último); null sem perdas. */
export function biggestLoss(funnel: readonly FunnelRow[]): FunnelRow | null {
  let worst: FunnelRow | null = null;
  for (const row of funnel) if (row.stoppedHere > 0 && (!worst || row.stoppedHere > worst.stoppedHere)) worst = row;
  return worst;
}
