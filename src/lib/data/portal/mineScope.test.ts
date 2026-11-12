import type { AstroGlobal } from "astro";
import { describe, expect, it } from "vitest";
import { mineRewriteTarget, mineScope, type PortalPage } from "./page";

// Minhas consultas pelo link do profissional (validação da F3, cliente 10/nov): o endereço dele e só as dele.

const astro = (url: string, params: Record<string, string> = {}) => ({ url: new URL(url), params }) as unknown as AstroGlobal;
const helena = { id: "p1", slug: "dra-helena", name: "Dra. Helena", agendaId: "a1" };
const page = { kind: "open", base: "/clinica", portal: { professionals: [helena], exams: [] } } as unknown as Extract<PortalPage, { kind: "open" }>;

describe("Minhas consultas pelo link do profissional", () => {
  it("o endereço do profissional reescreve para a tela da clínica com o profissional, mantendo os parâmetros", () => {
    expect(mineRewriteTarget(astro("http://x/portal/clinica/dra-helena/minhas-consultas/remarcar?a=1&date=2026-11-11", { clinica: "Clinica", profissional: "Dra-Helena" }), "/remarcar")).toBe(
      "/portal/clinica/minhas-consultas/remarcar?a=1&date=2026-11-11&profissional=dra-helena",
    );
  });

  it("com o profissional: lista, Voltar e Agendar no endereço dele", () => {
    const scope = mineScope(astro("http://x/portal/clinica/minhas-consultas?profissional=dra-helena"), page);
    expect(scope.professional?.id).toBe("p1");
    expect(scope.listHref).toBe("/clinica/dra-helena/minhas-consultas");
    expect(scope.home).toBe("/clinica/dra-helena");
  });

  it("sem profissional ou com um que não está no portal: a lista da clínica", () => {
    for (const url of ["http://x/portal/clinica/minhas-consultas", "http://x/portal/clinica/minhas-consultas?profissional=outro"]) {
      const scope = mineScope(astro(url), page);
      expect(scope.professional).toBeNull();
      expect(scope.listHref).toBe("/clinica/minhas-consultas");
      expect(scope.home).toBe("/clinica");
    }
  });
});
