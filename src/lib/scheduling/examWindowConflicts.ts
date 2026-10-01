import type { SupabaseClient } from "@supabase/supabase-js";

export interface ExamWindowCandidate {
  weekday: number;
  startTime: string;
  endTime: string;
}

export interface ExamWindowConflict {
  /**
   * `same_exam`: o exame já tem uma janela que se sobrepõe a essa.
   * `group`: um dos dois exames é em grupo/turma.
   */
  kind: "same_exam" | "group";
  otherExamTypeId: string;
  otherExamName: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

/**
 * Regra de sobreposição das janelas de exame (ajuste de out/2026):
 * - exames individuais diferentes podem dividir o mesmo dia e horário — a
 *   busca de horários livres já considera qualquer atendimento ativo
 *   (`getBusyIntervals`), então a médica nunca fica com dois ao mesmo tempo;
 * - o mesmo exame não pode ter duas janelas sobrepostas;
 * - a janela de um exame em grupo/turma não pode coincidir com a de nenhum
 *   outro exame — a turma conta só as próprias vagas e não olha a agenda.
 *
 * Exames inativos não contam. Devolve o primeiro conflito encontrado.
 */
export async function findExamWindowConflict(
  supabase: SupabaseClient,
  {
    examTypeId,
    schedulingMode,
    windows,
    ignoreSameExam = false,
  }: {
    examTypeId: string;
    schedulingMode: string;
    windows: ExamWindowCandidate[];
    /** Checando janelas já gravadas do próprio exame (troca de modo, reativação). */
    ignoreSameExam?: boolean;
  }
): Promise<ExamWindowConflict | null> {
  if (!windows.length) return null;

  const { data: existing, error } = await supabase
    .from("exam_type_availability_windows")
    .select("exam_type_id, weekday, start_time, end_time, exam_types!inner ( name, scheduling_mode, is_active )")
    .in("weekday", [...new Set(windows.map((window) => window.weekday))])
    .eq("is_active", true)
    .eq("exam_types.is_active", true);

  if (error) throw error;

  const isGroup = schedulingMode === "group";

  for (const candidate of windows) {
    for (const other of existing ?? []) {
      if (other.weekday !== candidate.weekday) continue;
      const otherStart = other.start_time.slice(0, 5);
      const otherEnd = other.end_time.slice(0, 5);
      if (!(candidate.startTime < otherEnd && candidate.endTime > otherStart)) continue;

      const otherExam = other.exam_types as unknown as { name: string; scheduling_mode: string };
      const sameExam = other.exam_type_id === examTypeId;
      if (sameExam && ignoreSameExam) continue;

      if (sameExam || isGroup || otherExam.scheduling_mode === "group") {
        return {
          kind: sameExam ? "same_exam" : "group",
          otherExamTypeId: other.exam_type_id,
          otherExamName: otherExam.name,
          weekday: other.weekday,
          startTime: otherStart,
          endTime: otherEnd,
        };
      }
    }
  }

  return null;
}

/**
 * Onde o conflito apareceu:
 * - `add`: cadastrando um horário novo na tela do exame;
 * - `mode`: salvando o exame como "Em grupo/turma";
 * - `reactivate`: reativando um exame inativo.
 */
export type ExamWindowConflictContext = "add" | "mode" | "reactivate";

const ERROR_CODES: Record<ExamWindowConflictContext, Record<ExamWindowConflict["kind"], string>> = {
  add: { same_exam: "overlap_same", group: "overlap_group" },
  mode: { same_exam: "mode_overlap", group: "mode_overlap" },
  reactivate: { same_exam: "reactivate_overlap", group: "reactivate_overlap" },
};

/**
 * O conflito vai para a tela pela URL do redirect (`error`, `other`, `when`);
 * a tela relê o nome do outro exame pelo id, em vez de exibir texto da URL.
 */
export function conflictQuery(conflict: ExamWindowConflict, context: ExamWindowConflictContext): string {
  return new URLSearchParams({
    error: ERROR_CODES[context][conflict.kind],
    other: conflict.otherExamTypeId,
    when: `${conflict.weekday}-${conflict.startTime}-${conflict.endTime}`,
  }).toString();
}

const WEEKDAY_LABELS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

const GROUP_REASON =
  "Exame em grupo/turma não pode dividir horário com outro exame, porque a turma não olha a agenda: os dois poderiam ser marcados ao mesmo tempo. Exames individuais podem dividir horário entre si.";

/**
 * Mensagem do conflito a partir da URL; `null` se o `error` não é de
 * conflito ou os parâmetros não batem.
 */
export async function describeConflictFromUrl(
  supabase: SupabaseClient,
  searchParams: URLSearchParams
): Promise<string | null> {
  const error = searchParams.get("error");
  if (!["overlap_same", "overlap_group", "mode_overlap", "reactivate_overlap"].includes(error ?? "")) return null;

  const match = /^([0-6])-(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(searchParams.get("when") ?? "");
  const otherId = searchParams.get("other") ?? "";
  if (!match || !/^[0-9a-f-]{36}$/i.test(otherId)) return null;

  const { data: other } = await supabase.from("exam_types").select("name").eq("id", otherId).maybeSingle();
  if (!other) return null;

  const when = `${WEEKDAY_LABELS[Number(match[1])]} ${match[2]}–${match[3]}`;

  switch (error) {
    case "overlap_same":
      return `Esse horário se sobrepõe a outro já cadastrado para este exame (${when}).`;
    case "overlap_group":
      return `Esse horário coincide com ${other.name} (${when}). ${GROUP_REASON}`;
    case "mode_overlap":
      return `Não foi possível salvar como "Em grupo/turma": um dos horários deste exame coincide com ${other.name} (${when}). Ajuste os horários antes de mudar o modo. ${GROUP_REASON}`;
    default:
      return `Não foi possível reativar: um dos horários deste exame coincide com ${other.name} (${when}). Remova ou ajuste um dos horários antes. ${GROUP_REASON}`;
  }
}
