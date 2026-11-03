import type { DbClient } from "./clients";
import { DataError, unwrap, unwrapOne } from "./errors";

// Problemas conhecidos (IS5; cliente, 03/nov/2026; docs/implantacao-segura.md): o registro do Suporte com o que já
// aconteceu e como resolver, em Sistema › Problemas conhecidos. Da plataforma (`known_issues`, sem clinic_id); o
// banco só deixa o Suporte ler e gravar.

export type KnownIssueLink = { label: string; href: string };

export type KnownIssue = {
  id: string;
  title: string;
  symptom: string;
  cause: string;
  solution: string;
  /** Texto como foi digitado (um link por linha). */
  linksText: string;
  links: KnownIssueLink[];
  updatedAt: Date;
};

export type KnownIssueInput = { title: string; symptom: string; cause: string; solution: string; links: string };

/**
 * Um link por linha: "Rótulo | https://…" ou só o endereço (o rótulo vira o próprio endereço). Aceita endereço
 * completo (http/https) e caminho do sistema ("/guia/…"); o resto fica de fora.
 */
export function parseKnownIssueLinks(text: string): KnownIssueLink[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const bar = line.lastIndexOf("|");
      const label = bar >= 0 ? line.slice(0, bar).trim() : "";
      const href = (bar >= 0 ? line.slice(bar + 1) : line).trim();
      return { label: label || href, href };
    })
    .filter((link) => /^https?:\/\/\S+$/.test(link.href) || /^\/[^\s/]\S*$/.test(link.href));
}

type Row = { id: string; title: string; symptom: string; cause: string; solution: string; links: string; updated_at: string };
const COLUMNS = "id, title, symptom, cause, solution, links, updated_at";
const toIssue = (row: Row): KnownIssue => ({
  id: row.id,
  title: row.title,
  symptom: row.symptom,
  cause: row.cause,
  solution: row.solution,
  linksText: row.links,
  links: parseKnownIssueLinks(row.links),
  updatedAt: new Date(row.updated_at),
});

/** A lista, o mais novo em cima; `search` procura no título, no sintoma, na causa e na solução (sem acento). */
export async function listKnownIssues(db: DbClient, search = ""): Promise<KnownIssue[]> {
  const rows = unwrap(await db.from("known_issues").select(COLUMNS).order("created_at", { ascending: false }), "Problemas conhecidos") as Row[];
  const issues = rows.map(toIssue);
  const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const terms = fold(search).split(/\s+/).filter(Boolean);
  if (!terms.length) return issues;
  return issues.filter((issue) => {
    const text = fold([issue.title, issue.symptom, issue.cause, issue.solution].join(" "));
    return terms.every((term) => text.includes(term));
  });
}

function validate(input: KnownIssueInput): KnownIssueInput {
  const clean = {
    title: input.title.trim(),
    symptom: input.symptom.trim(),
    cause: input.cause.trim(),
    solution: input.solution.trim(),
    links: input.links.trim(),
  };
  const fields: Record<string, string> = {};
  if (clean.title.length < 3) fields.titulo = "Informe o título (3 caracteres ou mais).";
  if (clean.title.length > 200) fields.titulo = "Título com até 200 caracteres.";
  if (!clean.symptom) fields.sintoma = "Informe o sintoma (o que a clínica relata).";
  if (!clean.solution) fields.solucao = "Informe a solução.";
  if (Object.keys(fields).length) throw new DataError("invalid", "Problema conhecido: dados inválidos", fields);
  return clean;
}

/** Cria (sem `id`) ou altera um problema conhecido. */
export async function saveKnownIssue(db: DbClient, input: KnownIssueInput, actorId: string, id?: string | null, now: Date = new Date()): Promise<string> {
  const clean = validate(input);
  const values = { ...clean, updated_at: now.toISOString(), updated_by: actorId };
  if (id) {
    unwrapOne(await db.from("known_issues").update(values).eq("id", id).select("id").maybeSingle(), "Problema conhecido");
    return id;
  }
  return unwrapOne(await db.from("known_issues").insert(values).select("id").maybeSingle(), "Problema conhecido").id;
}

export async function deleteKnownIssue(db: DbClient, id: string): Promise<void> {
  unwrapOne(await db.from("known_issues").delete().eq("id", id).select("id").maybeSingle(), "Problema conhecido");
}
