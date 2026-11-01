import { canAccessPath, type ClinicContext } from "../clinicAccess";
import type { Article, Faq } from "./types";

// Quem vê cada artigo: o mesmo que vê a tela que ele explica (papel da área e item
// liberado para a clínica, regras de src/lib/clinicAccess.ts). Artigo sem tela é de
// toda a equipe; o do Suporte (`screen: "support"`) só aparece para o Suporte do
// RecepClinic. A filtragem acontece no servidor, antes de montar a lista ou a busca.

export type CentralViewer = Pick<ClinicContext, "roles" | "isPlatformStaff" | "features">;

export function canSeeArticle(viewer: CentralViewer, article: Article): boolean {
  if (article.status !== "published") return false;
  if (article.screen === "support") return viewer.isPlatformStaff;
  if (!article.screen) return true;
  const query = new URLSearchParams(article.screen.tab ? { tab: article.screen.tab } : {});
  return canAccessPath(viewer, article.screen.path, query);
}

export const visibleArticles = (viewer: CentralViewer, articles: readonly Article[]) => articles.filter((a) => canSeeArticle(viewer, a));

export function visibleFaqs(viewer: CentralViewer, faqs: readonly Faq[], articles: readonly Article[]): Faq[] {
  const ids = new Set(visibleArticles(viewer, articles).map((a) => a.id));
  return faqs.filter((f) => ids.has(f.article));
}
