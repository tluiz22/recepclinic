import { agendaArtigos } from "./artigos/agenda";
import { atendimentoArtigos } from "./artigos/atendimento";
import { configuracoesArtigos } from "./artigos/configuracoes";
import { equipeMetricasFinanceiro } from "./artigos/equipe-metricas-financeiro";
import { pacientesArtigos } from "./artigos/pacientes";
import { primeirosPassos } from "./artigos/primeiros-passos";
import { problemasArtigos } from "./artigos/problemas";
import { suporteArtigos } from "./artigos/suporte";
import { whatsappArtigos } from "./artigos/whatsapp";
import type { Article } from "./types";

export { CATEGORIES, categoryOf } from "./categories";
export { FAQS } from "./faq";
export type { Article, Faq } from "./types";

export const ARTICLES: readonly Article[] = [
  ...primeirosPassos,
  ...agendaArtigos,
  ...pacientesArtigos,
  ...atendimentoArtigos,
  ...whatsappArtigos,
  ...configuracoesArtigos,
  ...equipeMetricasFinanceiro,
  ...problemasArtigos,
  ...suporteArtigos,
].sort((a, b) => a.order - b.order);

export const articleById = (id: string) => ARTICLES.find((a) => a.id === id);

const patternOf = (path: string) => new RegExp(`^${path.replace(/:id/g, "[^/]+")}(?:/.*)?$`);

/** Artigo aberto pelo botão "Ajuda desta tela": o mais específico para o caminho (":id" vale por um trecho do endereço). */
export function articleForPath(pathname: string): Article | undefined {
  let best: { article: Article; weight: number } | undefined;
  for (const article of ARTICLES) {
    for (const path of article.contextual ?? []) {
      if (!patternOf(path).test(pathname)) continue;
      const weight = path.replace(/:id/g, "").length + (path.includes(":id") ? 0.5 : 0);
      if (!best || weight > best.weight) best = { article, weight };
    }
  }
  return best?.article;
}
