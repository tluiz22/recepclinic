import type { Article } from "../types";

type Input = Omit<Article, "status" | "keywords" | "synonyms" | "related" | "order"> & Partial<Pick<Article, "keywords" | "synonyms" | "related" | "order">>;

/** Artigo publicado, com os campos de busca vazios quando não informados. */
export const article = (input: Input): Article => ({ status: "published", keywords: [], synonyms: [], related: [], order: 100, ...input });
