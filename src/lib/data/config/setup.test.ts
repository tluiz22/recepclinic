import { describe, expect, it } from "vitest";
import { computeSetup, type SetupInput } from "./setup";

// Caso real do staging (07/out): horários só para a Consulta; a Espirometria
// fica sem horário e some do bot.
const base = (): SetupInput => ({
  professionals: [{ id: "p1", displayName: "Thiago Luiz", isActive: true }],
  agendas: [{ id: "a1", name: "Thiago Luiz", professionalId: "p1", isActive: true }],
  locations: [{ id: "l1", name: "Consultorio TI", type: "clinic", address: "Rua A, 1", isActive: true }],
  services: [
    { id: "s1", name: "Consulta", category: "consultation", isActive: true, agendaIds: ["a1"], locations: [{ locationId: "l1", priceCents: null }] },
    { id: "s2", name: "Espirometria", category: "exam", isActive: true, agendaIds: ["a1"], locations: [{ locationId: "l1", priceCents: null }] },
  ],
  windows: [{ agendaId: "a1", locationId: "l1", serviceId: "s1" }],
  features: ["exams"],
});

const statusOf = (input: SetupInput) => Object.fromEntries(computeSetup(input).steps.map((s) => [s.key, s.status]));

describe("jornada de configuração (F6.3b)", () => {
  it("serviço sem horário próprio nem 'qualquer serviço': atenção em Horários, com o link já com agenda e serviço", () => {
    const setup = computeSetup(base());
    expect(setup.complete).toBe(false);
    expect(setup.issues.services.get("s2")).toEqual(["no_hours"]);
    expect(setup.issues.services.get("s1")).toBeUndefined();
    const hours = setup.steps.find((s) => s.key === "hours")!;
    expect(hours.status).toBe("attention");
    expect(hours.items).toEqual([
      {
        text: "Espirometria: sem horário de atendimento: não aparece no bot nem no link de agendar.",
        href: "/admin/configuracoes/horarios?agenda=a1&servico=s2",
      },
    ]);
  });

  it("horário 'qualquer serviço' cobre todos os serviços da agenda: configuração completa", () => {
    const input = base();
    input.windows = [{ agendaId: "a1", locationId: "l1", serviceId: null }];
    const setup = computeSetup(input);
    expect(setup.complete).toBe(true);
    expect(statusOf(input)).toEqual({ clinic: "done", professionals: "done", locations: "done", agendas: "done", services: "done", hours: "done" });
  });

  it("clínica do zero: falta cada passo", () => {
    expect(statusOf({ professionals: [], agendas: [], locations: [], services: [], windows: [], features: [] })).toEqual({
      clinic: "done",
      professionals: "missing",
      locations: "missing",
      agendas: "missing",
      services: "missing",
      hours: "missing",
    });
  });

  it("profissional sem agenda, consultório sem endereço, agenda e local sem serviço", () => {
    const input = base();
    input.professionals.push({ id: "p2", displayName: "Dra. Nova", isActive: true });
    input.locations.push({ id: "l2", name: "Sala 2", type: "clinic", address: null, isActive: true });
    input.agendas.push({ id: "a2", name: "Exames", professionalId: null, isActive: true });
    const setup = computeSetup(input);
    expect(setup.issues.professionals.get("p2")).toEqual(["no_agenda"]);
    expect(setup.steps.find((s) => s.key === "professionals")!.items[0].href).toBe("/admin/configuracoes/agendas/novo?profissional=p2");
    expect(setup.issues.locations.get("l2")).toEqual(["no_address", "no_service"]);
    expect(setup.issues.agendas.get("a2")).toEqual(["no_service", "no_hours"]);
    expect(setup.steps.find((s) => s.key === "agendas")!.items.map((i) => i.text)).toEqual([
      "Exames: nenhum serviço ativo usa este cadastro.",
      "Exames: sem horário de atendimento: ninguém consegue marcar nela.",
    ]);
  });

  it("serviço sem agenda ou sem local: atenção em Serviços (não em Horários)", () => {
    const input = base();
    input.services[0].agendaIds = [];
    const setup = computeSetup(input);
    expect(setup.issues.services.get("s1")).toEqual(["no_agenda", "no_hours"]);
    expect(setup.steps.find((s) => s.key === "services")!.items.map((i) => i.text)).toEqual(["Consulta: sem agenda ativa: não recebe atendimentos."]);
  });

  it("itens desligados na matriz não contam: exame sem 'Exames', domiciliar sem 'Atendimento domiciliar'", () => {
    const input = base();
    input.features = [];
    input.locations.push({ id: "l3", name: "Domiciliar", type: "home_visit", address: null, isActive: true });
    const setup = computeSetup(input);
    expect(setup.issues.services.has("s2")).toBe(false);
    expect(setup.issues.locations.has("l3")).toBe(false);
    expect(setup.complete).toBe(true);
  });

  it("desativados não contam", () => {
    const input = base();
    input.services[1].isActive = false;
    expect(computeSetup(input).complete).toBe(true);
  });
});
