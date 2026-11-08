import { describe, expect, it } from "vitest";
import type { BotAgenda, BotCatalog, BotService } from "./catalog";
import { buildScope, EXAMS_CHOICE, NO_SPECIALTY, professionalsOf, PROFESSIONAL_KEY, scopeCatalog, specialtyOptions } from "./professionalScope";

// MB (cliente, 07/nov/2026): quem atende pelo bot, a escolha da conversa e o catálogo no contexto dela.

const agenda = (id: string, professional: { id: string; name: string; specialties?: { id: string; name: string }[] } | null): BotAgenda => ({
  id,
  serviceId: "",
  name: professional?.name ?? "Exames",
  professionalName: professional?.name ?? null,
  professionalId: professional?.id ?? null,
  specialty: null,
  specialties: professional?.specialties ?? [],
  locationTypes: ["clinic"],
});

const service = (id: string, category: BotService["category"], agendas: BotAgenda[]): BotService => ({
  id,
  name: id,
  category,
  isGroup: false,
  agendas: agendas.map((a) => ({ ...a, serviceId: id })),
  locationPrices: { clinic: 100 },
  priceCents: 100,
  returnDeadlineDays: null,
  preparation: null,
  preparationFile: null,
});

const ana = { id: "ana", name: "Dra. Ana", specialties: [{ id: "ped", name: "Pediatria" }] };
const joao = { id: "joao", name: "Dr. João", specialties: [{ id: "car", name: "Cardiologia" }, { id: "ped", name: "Pediatria" }] };
const novo = { id: "novo", name: "Dr. Novo" };

const catalog: BotCatalog = {
  services: [
    service("consulta", "consultation", [agenda("a-ana", ana), agenda("a-joao", joao), agenda("a-novo", novo)]),
    service("eco", "exam", [agenda("a-joao", joao)]),
    service("raio", "exam", [agenda("a-exames", null)]),
  ],
  copies: [],
  locations: [],
};

describe("escopo do profissional (MB)", () => {
  it("vários profissionais: sem escolha, nenhum em uso; Exames quando há exame em agenda sem profissional", () => {
    const scope = buildScope(catalog, {});
    expect(scope.professionals.map((p) => p.id)).toEqual(["joao", "novo", "ana"]);
    expect(scope).toMatchObject({ multi: true, choice: null, current: null, examsOption: true });
  });

  it("especialidades em ordem, quem não tem nenhuma em \"Outros profissionais\"; profissionais de cada uma", () => {
    const scope = buildScope(catalog, {});
    expect(specialtyOptions(scope, "Outros")).toEqual([
      { id: "car", name: "Cardiologia" },
      { id: "ped", name: "Pediatria" },
      { id: NO_SPECIALTY, name: "Outros" },
    ]);
    expect(professionalsOf(scope, "ped").map((p) => p.id)).toEqual(["joao", "ana"]);
    expect(professionalsOf(scope, NO_SPECIALTY).map((p) => p.id)).toEqual(["novo"]);
  });

  it("escolha guardada: o catálogo só com os serviços dele e os exames da equipe; Exames: só exames", () => {
    const scope = buildScope(catalog, { [PROFESSIONAL_KEY]: "joao" });
    expect(scope.current?.id).toBe("joao");
    const scoped = scopeCatalog(catalog, scope);
    expect(scoped.services.map((s) => [s.id, s.agendas.map((a) => a.id)])).toEqual([
      ["consulta", ["a-joao"]],
      ["eco", ["a-joao"]],
      ["raio", ["a-exames"]],
    ]);
    const exams = scopeCatalog(catalog, buildScope(catalog, { [PROFESSIONAL_KEY]: EXAMS_CHOICE }));
    // Serviços da equipe (MS, S3): em "Exames", só os da agenda sem profissional (o eco é do Dr. João).
    expect(exams.services.map((s) => s.id)).toEqual(["raio"]);
  });

  it("escolha que não vale mais (profissional saiu do bot) é ignorada", () => {
    expect(buildScope(catalog, { [PROFESSIONAL_KEY]: "saiu" }).choice).toBeNull();
  });

  it("um profissional só: nada muda (ele é o profissional em uso, o catálogo inteiro)", () => {
    const single: BotCatalog = { services: [service("consulta", "consultation", [agenda("a-ana", ana)]), service("raio", "exam", [agenda("a-exames", null)])], copies: [], locations: [] };
    const scope = buildScope(single, {});
    expect(scope).toMatchObject({ multi: false, choice: null });
    expect(scope.current?.id).toBe("ana");
    expect(scopeCatalog(single, scope)).toBe(single);
  });
});
