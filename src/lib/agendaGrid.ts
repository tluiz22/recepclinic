// Agenda em colunas (F5a; R3, cliente, 08/nov/2026): regras puras da grade por horário. Uma coluna por agenda, em
// grupos de especialidade; até 7 agendas, só o filtro "Agenda"; a partir de 8, Especialidade ou Profissional (um de
// cada vez). Linhas de 30 min; cada item ocupa a altura da duração e, quando dois se sobrepõem na mesma agenda (exames
// em paralelo, turma), dividem a largura.

/** A partir de quantas agendas a grade rola para o lado e ganha os filtros Especialidade e Profissional. */
export const MANY_AGENDAS = 8;
/** Grupo da agenda da Equipe e do profissional sem especialidade. */
export const EXAMS_GROUP = "Exames";
export const OTHERS_GROUP = "Outros";

export type GridAgenda = { id: string; name: string; isActive: boolean; kind: "professional" | "resource"; professionalId: string | null };
export type GridColumn = { id: string; name: string; isActive: boolean; group: string; specialties: string[] };

/**
 * Colunas em ordem: por grupo (a primeira especialidade do profissional; a Equipe em "Exames", no fim; sem
 * especialidade em "Outros", antes dos exames) e, dentro dele, pelo nome.
 */
export function buildColumns(agendas: GridAgenda[], specialtiesOf: Map<string, string[]>): GridColumn[] {
  const columns = agendas.map((agenda) => {
    const specialties = agenda.kind === "resource" ? [] : (specialtiesOf.get(agenda.professionalId ?? "") ?? []);
    const group = agenda.kind === "resource" ? EXAMS_GROUP : (specialties[0] ?? OTHERS_GROUP);
    return { id: agenda.id, name: agenda.name, isActive: agenda.isActive, group, specialties };
  });
  const rank = (group: string) => (group === EXAMS_GROUP ? 2 : group === OTHERS_GROUP ? 1 : 0);
  return columns.sort(
    (a, b) => rank(a.group) - rank(b.group) || a.group.localeCompare(b.group, "pt-BR") || a.name.localeCompare(b.name, "pt-BR"),
  );
}

/** Especialidades para o filtro (as que têm alguma agenda), em ordem alfabética; "Exames" e "Outros" no fim. */
export function specialtyOptions(columns: GridColumn[]): string[] {
  const names = new Set<string>();
  let exams = false;
  let others = false;
  for (const column of columns) {
    if (column.group === EXAMS_GROUP) exams = true;
    else if (column.group === OTHERS_GROUP) others = true;
    for (const name of column.specialties) names.add(name);
  }
  return [...[...names].sort((a, b) => a.localeCompare(b, "pt-BR")), ...(others ? [OTHERS_GROUP] : []), ...(exams ? [EXAMS_GROUP] : [])];
}

export type ColumnFilter = { specialty: string | null; agendaId: string | null };

/**
 * Filtro da grade: o profissional (uma agenda) ou a especialidade (qualquer uma do profissional; "Exames" e "Outros"
 * pelo grupo). Um de cada vez: com os dois, vale o profissional. Valor que não existe vira "todas".
 */
export function filterColumns(columns: GridColumn[], filter: ColumnFilter): { columns: GridColumn[]; filter: ColumnFilter } {
  if (filter.agendaId) {
    const one = columns.filter((c) => c.id === filter.agendaId);
    if (one.length) return { columns: one, filter: { specialty: null, agendaId: filter.agendaId } };
  }
  if (filter.specialty) {
    const name = filter.specialty;
    const some = columns.filter((c) => c.group === name || c.specialties.includes(name));
    if (some.length) return { columns: some, filter: { specialty: name, agendaId: null } };
  }
  return { columns, filter: { specialty: null, agendaId: null } };
}

/** Grupos seguidos na ordem das colunas, para a faixa de especialidades acima dos nomes. */
export function groupRuns(columns: Pick<GridColumn, "group">[]): { group: string; span: number }[] {
  const runs: { group: string; span: number }[] = [];
  for (const column of columns) {
    const last = runs[runs.length - 1];
    if (last && last.group === column.group) last.span += 1;
    else runs.push({ group: column.group, span: 1 });
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Horas e posições
// ---------------------------------------------------------------------------

export const SLOT_MINUTES = 30;
/** Altura de 1 minuto na grade, em px (30 min = 60 px). */
export const PX_PER_MINUTE = 2;
/** Dia sem nada: a grade mostra das 8 às 18. */
export const DEFAULT_RANGE = { start: 8 * 60, end: 18 * 60 };

/** Faixa de horas da grade (em minutos do dia), em meias horas inteiras, cobrindo tudo o que aparece. */
export function gridRange(spans: { start: number; end: number }[]): { start: number; end: number } {
  const valid = spans.filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start);
  if (valid.length === 0) return DEFAULT_RANGE;
  const start = Math.max(0, Math.floor(Math.min(...valid.map((s) => s.start)) / SLOT_MINUTES) * SLOT_MINUTES);
  const end = Math.min(24 * 60, Math.ceil(Math.max(...valid.map((s) => s.end)) / SLOT_MINUTES) * SLOT_MINUTES);
  return end > start ? { start, end } : DEFAULT_RANGE;
}

/** Linhas da grade: "08:00", "08:30"… do começo ao fim da faixa. */
export function gridLines(range: { start: number; end: number }): string[] {
  const lines: string[] = [];
  for (let minute = range.start; minute < range.end; minute += SLOT_MINUTES) {
    lines.push(`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
  }
  return lines;
}

/**
 * Faixas lado a lado dentro de uma coluna: itens que se sobrepõem no tempo ficam em faixas diferentes e dividem a
 * largura pelo número de faixas do grupo de sobreposição deles. Devolve, na ordem recebida, a faixa e o total.
 */
export function assignLanes(spans: { start: number; end: number }[]): { lane: number; lanes: number }[] {
  const order = spans.map((s, i) => ({ ...s, i })).sort((a, b) => a.start - b.start || b.end - a.end);
  const result: { lane: number; lanes: number }[] = spans.map(() => ({ lane: 0, lanes: 1 }));
  let cluster: typeof order = [];
  let clusterEnd = -Infinity;
  let laneEnds: number[] = [];
  const close = () => {
    for (const item of cluster) result[item.i].lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };
  for (const item of order) {
    if (item.start >= clusterEnd) {
      close();
      clusterEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.end);
    } else laneEnds[lane] = item.end;
    result[item.i].lane = lane;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  close();
  return result;
}
