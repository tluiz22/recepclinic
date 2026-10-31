import { compileKnowledge, type CompiledKb, type KbContent } from "../../knowledge/match";
import type { DbClient } from "../clients";
import { unwrap } from "../errors";

// Base publicada (BC 3.2, cache da seção 6 do plano): a última fotografia de
// kb_publications, compilada uma vez por instância do servidor e guardada pelo
// número da versão. Cada uso confere só a versão (uma linha); publicação nova
// troca o cache na mesma hora. Não há dado de clínica nem de paciente aqui.

let cached: CompiledKb | null = null;

/** null = nada publicado ainda (o bot segue como hoje). */
export async function publishedKnowledge(db: DbClient): Promise<CompiledKb | null> {
  const [latest] = unwrap(
    await db.from("kb_publications").select("version").order("version", { ascending: false }).limit(1),
    "Base de conhecimento",
  );
  if (!latest) return null;
  if (cached?.version === latest.version) return cached;
  const [row] = unwrap(
    await db.from("kb_publications").select("version, content").eq("version", latest.version).limit(1),
    "Base de conhecimento",
  );
  if (!row) return null;
  cached = compileKnowledge(row.version, row.content as unknown as KbContent);
  return cached;
}

/** Só para os testes. */
export function clearKnowledgeCache(): void {
  cached = null;
}
