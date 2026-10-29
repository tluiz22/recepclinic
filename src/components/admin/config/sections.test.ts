import { describe, expect, it } from "vitest";
import { computeSetup, type SetupInput } from "../../../lib/data/config/setup";
import { configSections, pendingBySection } from "./sections";

// Mesmo caso do guia (setup.test.ts): a Espirometria fica sem horário; e um
// local sem endereço.
const input = (): SetupInput => ({
  professionals: [{ id: "p1", displayName: "Thiago Luiz", isActive: true }],
  agendas: [{ id: "a1", name: "Thiago Luiz", professionalId: "p1", isActive: true }],
  locations: [{ id: "l1", name: "Consultorio TI", type: "clinic", address: null, isActive: true }],
  services: [
    { id: "s1", name: "Consulta", category: "consultation", schedulingMode: "individual", isActive: true, agendaIds: ["a1"], locations: [{ locationId: "l1", priceCents: null }] },
    { id: "s2", name: "Espirometria", category: "exam", schedulingMode: "individual", isActive: true, agendaIds: ["a1"], locations: [{ locationId: "l1", priceCents: null }] },
  ],
  windows: [{ agendaId: "a1", locationId: "l1", serviceId: "s1" }],
  features: ["exams"],
});

describe("menu lateral de Configurações (R9)", () => {
  it("põe as pendências do guia ao lado da seção, como o guia conta", () => {
    const pending = pendingBySection(computeSetup(input()));
    // Serviço sem horário conta em Serviços (cliente, 21/out/2026).
    expect(pending.get("servicos")).toBe(1);
    expect(pending.has("horarios")).toBe(false);
    expect(pending.get("locais")).toBe(1);
    expect(pending.has("profissionais")).toBe(false);
    expect(pending.has("clinica")).toBe(false);
  });

  it("passo que falta conta 1", () => {
    const setup = computeSetup({ ...input(), windows: [] });
    expect(setup.steps.find((s) => s.key === "hours")!.status).toBe("missing");
    expect(pendingBySection(setup).get("horarios")).toBe(1);
  });

  it("4 grupos; Convênios e Nota fiscal com o item liberado; WhatsApp para todos (F8.1)", () => {
    const ids = (features: Parameters<typeof configSections>[0], support: boolean) =>
      configSections(features, support, null).map((g) => [g.title, g.items.map((s) => s.id)]);
    expect(ids([], false)).toEqual([
      ["A clínica", ["clinica", "equipe"]],
      ["Atendimento", ["profissionais", "locais", "agendas", "servicos", "horarios", "feriados"]],
      ["Mensagens", ["lembretes", "mensagens", "whatsapp"]],
    ]);
    const full = configSections(["insurance", "finance"], true, null);
    expect(full.map((g) => g.title)).toEqual(["A clínica", "Atendimento", "Mensagens", "Financeiro"]);
    expect(full[1].items.at(-1)!.id).toBe("convenios");
    expect(full[2].items.at(-1)!.id).toBe("whatsapp");
    expect(full[2].items.at(-1)!.supportOnly).toBeUndefined();
    expect(full[3].items).toMatchObject([{ id: "nota_fiscal", href: "/admin/configuracoes/nota-fiscal" }]);
  });
});
