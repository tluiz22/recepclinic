// Central de Ajuda (cliente, 01/nov/2026): o manual do RecepClinic dentro do painel.
// Os artigos moram no código (src/lib/central/artigos/), versionados com as telas
// que explicam, sem tabela no banco: o acesso vem das regras das próprias telas.

export type CategoryId =
  | "primeiros-passos"
  | "agenda"
  | "pacientes"
  | "atendimento"
  | "whatsapp"
  | "configuracoes"
  | "equipe"
  | "metricas"
  | "financeiro"
  | "problemas"
  | "suporte";

export type Category = { id: CategoryId; title: string; description: string; icon: string; order: number };

/** Uma tela do painel que o artigo explica: define quem vê (papel e item liberado, como na tela). */
export type Screen = { path: string; tab?: string };

export type ArticleField = { name: string; text: string };
export type ArticleProblem = { problem: string; solution: string };

export type Article = {
  /** Endereço: /admin/ajuda/{id}. Sem acento, em minúsculas e com hífen. */
  id: string;
  title: string;
  /** Uma frase: aparece na lista e na busca. */
  summary: string;
  category: CategoryId;
  /** Módulo do painel, por extenso ("Agenda › Marcar"). */
  module: string;
  /** Onde a funcionalidade está, em passos de menu ("Agenda › Marcar"). */
  where: string;
  /** Tela que o artigo explica; sem ela, é de toda a equipe. `support`: só o Suporte do RecepClinic. */
  screen?: Screen | "support";
  keywords: string[];
  synonyms: string[];
  related: string[];
  order: number;
  status: "published" | "draft";
  intro: string;
  whenToUse?: string;
  prerequisites?: string[];
  steps?: string[];
  fields?: ArticleField[];
  result?: string;
  notes?: string[];
  problems?: ArticleProblem[];
  /** Telas do painel (caminhos) que abrem este artigo no botão "Ajuda desta tela". */
  contextual?: string[];
  /** Capturas reais da tela (public/ajuda/), com o ponto principal destacado em vermelho. */
  images?: ArticleImage[];
};

export type ArticleImage = { file: string; alt: string; caption: string };

export type Faq = {
  id: string;
  question: string;
  answer: string;
  /** Artigo com a explicação completa. */
  article: string;
  keywords: string[];
  /** Mesmo controle de acesso do artigo ligado. */
};
