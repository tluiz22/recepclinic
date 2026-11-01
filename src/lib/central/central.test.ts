import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canSeeArticle, visibleArticles, visibleFaqs } from "./access";
import { articleForPath, ARTICLES, CATEGORIES, FAQS } from "./index";
import { articleText } from "./search";

const base = { roles: [] as never[], isPlatformStaff: false };
const admin = { ...base, roles: ["admin" as const], features: ["whatsapp_bot", "finance", "relationship", "metrics_performance"] as never };
const reception = { ...base, roles: ["reception" as const], features: ["finance", "relationship"] as never };
const professional = { ...base, roles: ["professional" as const], features: [] as never };
const staff = { roles: [], isPlatformStaff: true, features: [] as never };

describe("Central de Ajuda: conteúdo", () => {
  it("ids únicos, categorias existentes e relacionados/FAQs apontam para artigos reais", () => {
    const ids = ARTICLES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    const cats = new Set(CATEGORIES.map((c) => c.id));
    for (const a of ARTICLES) {
      expect(cats.has(a.category), `${a.id}: categoria`).toBe(true);
      for (const r of a.related) expect(ids, `${a.id} → ${r}`).toContain(r);
    }
    for (const f of FAQS) expect(ids, `FAQ ${f.id} → ${f.article}`).toContain(f.article);
    expect(new Set(FAQS.map((f) => f.id)).size).toBe(FAQS.length);
  });
  it("nenhum artigo vazio", () => {
    for (const a of ARTICLES) {
      expect(a.title.length, a.id).toBeGreaterThan(5);
      expect(a.summary.length, a.id).toBeGreaterThan(10);
      expect(articleText(a).length, a.id).toBeGreaterThan(120);
      expect(/^[a-z0-9-]+$/.test(a.id), a.id).toBe(true);
    }
    for (const f of FAQS) expect(f.answer.length, f.id).toBeGreaterThan(20);
  });
  it("toda categoria tem artigo, e o tamanho mínimo da central", () => {
    for (const c of CATEGORIES) expect(ARTICLES.some((a) => a.category === c.id), c.id).toBe(true);
    expect(ARTICLES.length).toBeGreaterThanOrEqual(40);
    expect(FAQS.length).toBeGreaterThanOrEqual(30);
  });
});

describe("Central de Ajuda: acesso", () => {
  const byId = (id: string) => ARTICLES.find((a) => a.id === id)!;
  it("artigo do Suporte só para o Suporte", () => {
    const internal = ARTICLES.filter((a) => a.screen === "support");
    expect(internal.length).toBeGreaterThan(0);
    for (const a of internal) {
      expect(canSeeArticle(staff, a)).toBe(true);
      expect(canSeeArticle(admin, a)).toBe(false);
      expect(canSeeArticle(reception, a)).toBe(false);
      expect(canSeeArticle(professional, a)).toBe(false);
    }
  });
  it("Configurações é só do Administrador; Agenda, de todos", () => {
    expect(canSeeArticle(admin, byId("config-horarios"))).toBe(true);
    expect(canSeeArticle(reception, byId("config-horarios"))).toBe(false);
    expect(canSeeArticle(professional, byId("config-horarios"))).toBe(false);
    for (const who of [admin, reception, professional]) expect(canSeeArticle(who, byId("marcar-atendimento"))).toBe(true);
  });
  it("Financeiro e Relacionamento seguem papel e item da clínica", () => {
    expect(canSeeArticle(reception, byId("financeiro-quem-paga"))).toBe(true);
    expect(canSeeArticle({ ...reception, features: [] as never }, byId("financeiro-quem-paga"))).toBe(false);
    expect(canSeeArticle(professional, byId("relacionamento"))).toBe(false);
  });
  it("a FAQ some junto com o artigo; a lista visível não vaza o interno", () => {
    const faqs = visibleFaqs(professional, FAQS, ARTICLES);
    expect(faqs.some((f) => f.article === "config-horarios")).toBe(false);
    expect(visibleArticles(admin, ARTICLES).some((a) => a.category === "suporte")).toBe(false);
    expect(visibleArticles(staff, ARTICLES).some((a) => a.category === "suporte")).toBe(true);
  });
  it("rascunho nunca aparece", () => {
    expect(canSeeArticle(staff, { ...byId("marcar-atendimento"), status: "draft" })).toBe(false);
  });
});

describe("Central de Ajuda: ajuda contextual", () => {
  it("a tela mais específica vence", () => {
    expect(articleForPath("/admin/agenda/marcar")?.id).toBe("marcar-atendimento");
    expect(articleForPath("/admin/agenda")?.id).toBe("agenda-visualizar");
    expect(articleForPath("/admin/configuracoes/horarios")?.id).toBe("config-horarios");
    expect(articleForPath("/admin/pacientes/novo")?.id).toBe("cadastrar-paciente");
    expect(articleForPath("/admin/pacientes/abc-123")?.id).toBe("ficha-do-paciente");
    expect(articleForPath("/admin/pacientes/contato/abc")?.id).toBe("responsavel-e-contato");
    expect(articleForPath("/admin/configuracoes")?.id).toBe("config-clinica");
    expect(articleForPath("/admin/consultas")?.id).toBe("resumo-do-dia");
    expect(articleForPath("/admin/dashboard")?.id).toBe("inicio-do-painel");
    expect(articleForPath("/admin/nada")).toBeUndefined();
  });
});

describe("Central de Ajuda: capturas de tela", () => {
  it("toda captura citada existe e nenhuma ficou sem uso", () => {
    const used = new Set<string>();
    for (const a of ARTICLES) {
      for (const image of a.images ?? []) {
        used.add(`${image.file}.png`);
        expect(existsSync(`public/ajuda/${image.file}.png`), `${a.id}: ${image.file}`).toBe(true);
        expect(image.alt.length, a.id).toBeGreaterThan(15);
        expect(image.caption.length, a.id).toBeGreaterThan(15);
      }
    }
    const files = readdirSync("public/ajuda").filter((f) => f.endsWith(".png"));
    expect(files.filter((f) => !used.has(f))).toEqual([]);
  });
});
