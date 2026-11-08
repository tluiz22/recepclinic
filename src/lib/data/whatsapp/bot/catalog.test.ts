import { describe, expect, it } from "vitest";
import { copyAt, mergeCopies, mixesCopies, type BotAgenda, type BotService } from "./catalog";

// Serviços por profissional (MS, 07/nov/2026): as cópias de mesmo nome e tipo viram uma opção no menu.

const agenda = (id: string, serviceId: string, professionalName: string | null): BotAgenda => ({
  id,
  serviceId,
  name: professionalName ?? "Exames",
  professionalName,
  professionalId: professionalName ? `p-${id}` : null,
  specialty: null,
  specialties: [],
  locationTypes: ["clinic"],
});

const service = (id: string, name: string, priceCents: number, agendas: BotAgenda[], extra: Partial<BotService> = {}): BotService => ({
  id,
  name,
  category: "consultation",
  isGroup: false,
  agendas,
  locationPrices: { clinic: priceCents },
  priceCents,
  returnDeadlineDays: null,
  preparation: null,
  preparationFile: null,
  ...extra,
});

const ana = service("s-ana", "Consulta", 30000, [agenda("a-ana", "s-ana", "Dra. Ana")]);
const bruno = service("s-bruno", "consulta ", 25000, [agenda("a-bruno", "s-bruno", "Dr. Bruno")]);
const retorno = service("s-ret", "Retorno", 0, [agenda("a-ana", "s-ret", "Dra. Ana")], { category: "return_visit" });

describe("catálogo do bot com cópias (MS)", () => {
  it("junta as cópias de mesmo nome e tipo (sem acento, caixa ou espaço) e mantém as outras", () => {
    const merged = mergeCopies([ana, bruno, retorno]);
    expect(merged.map((s) => s.id)).toEqual(["s-ana", "s-ret"]);
    // Agendas por nome do profissional ("Dr. Bruno" antes de "Dra. Ana").
    expect(merged[0].agendas.map((a) => a.serviceId)).toEqual(["s-bruno", "s-ana"]);
    expect(mixesCopies(merged[0])).toBe(true);
    expect(mixesCopies(merged[1])).toBe(false);
  });

  it("não junta tipos diferentes com o mesmo nome", () => {
    const exam = service("s-ex", "Consulta", 100, [agenda("a-ex", "s-ex", null)], { category: "exam" });
    expect(mergeCopies([ana, exam])).toHaveLength(2);
  });

  it("escolhida a agenda, segue com a cópia dela (valor dela)", () => {
    const merged = mergeCopies([ana, bruno, retorno])[0];
    const copies = [ana, bruno, retorno];
    expect(copyAt({ copies }, merged, "a-bruno")).toMatchObject({ id: "s-bruno", priceCents: 25000 });
    expect(copyAt({ copies }, merged, "a-bruno").agendas.map((a) => a.id)).toEqual(["a-bruno"]);
    expect(copyAt({ copies }, merged, "a-ana").id).toBe("s-ana");
    expect(copyAt({ copies }, merged, null)).toBe(merged);
  });
});
