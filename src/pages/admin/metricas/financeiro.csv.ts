import type { APIRoute } from "astro";
import { createClient } from "../../../lib/supabase/server";
import { fetchFinancialReport, type FinancialRow } from "../../../lib/metrics/financial";
import { parsePeriod } from "../../../lib/metrics/period";
import { resolveFilter } from "../../../lib/metrics/filter";

// Métricas › Financeiro › "Baixar planilha" (Fase 24 · etapa 3): as mesmas
// linhas da aba, com o período e o filtro da URL. Só a médica (fica sob
// /admin/metricas, ver middleware). CSV no padrão do Excel em português —
// separador ";", vírgula decimal e BOM para os acentos.

const SEPARATOR = ";";

function cell(value: string | number): string {
  const text = String(value);
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function reais(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function line(values: (string | number)[]): string {
  return values.map(cell).join(SEPARATOR);
}

function rowLine(group: string, row: FinancialRow): string {
  return line([
    group,
    row.label,
    row.done.count,
    reais(row.done.cents),
    row.expected.count,
    reais(row.expected.cents),
    row.noShow.count,
    reais(row.noShow.cents),
  ]);
}

export const GET: APIRoute = async ({ request, cookies, url }) => {
  const supabase = createClient(request, cookies);
  const period = parsePeriod(url.searchParams);
  const filter = await resolveFilter(supabase, url.searchParams);
  const report = await fetchFinancialReport(supabase, period, filter);

  const lines = [
    line(["Relatório financeiro"]),
    line(["Período", period.label]),
    ...(filter ? [line(["Só de", filter.label])] : []),
    line(["Valor pela tabela vigente na marcação (esperado, não o recebido). Retornos (inclusos na consulta) e cancelados não entram."]),
    "",
    line([
      "Grupo",
      "Tipo",
      "Realizado (qtd.)",
      "Realizado (R$)",
      "Previsto (qtd.)",
      "Previsto (R$)",
      "Faltas (qtd.)",
      "Perdido com faltas (R$)",
    ]),
    ...report.visits.map((row) => rowLine("Consultas", row)),
    ...report.exams.map((row) => rowLine("Exames", row)),
    rowLine("Total", report.total),
  ];

  const fileName =
    period.from === period.to ? `financeiro_${period.from}.csv` : `financeiro_${period.from}_a_${period.to}.csv`;

  return new Response(`\uFEFF${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
};
