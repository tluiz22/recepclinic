import { areaOfPath } from "../clinicAccess";
import type { Article } from "./types";

/** Quem usa, em palavras, a partir da tela que o artigo explica (mesmas regras de acesso do painel). */
export function audienceLabel(article: Article): string {
  if (article.screen === "support") return "Só o Suporte do RecepClinic";
  if (!article.screen) return "Toda a equipe";
  switch (areaOfPath(article.screen.path)) {
    case "settings":
      return "Administrador";
    case "finance":
    case "relationship":
      return "Administrador e Recepção, com o item liberado";
    case "metrics":
      return "Administrador e Profissional (a própria agenda), com o item liberado";
    default:
      return "Toda a equipe";
  }
}
