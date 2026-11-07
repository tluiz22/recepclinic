import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { listProfessionals } from "../../src/lib/data/config/professionals";
import { adminClient, clinicServiceClient, createClinic, deleteClinics, withDatabase } from "./helpers";

// ME (cliente, 07/nov/2026): o texto livre de hoje vira especialidade da lista
// global (nome ou sinônimo, sem acento nem maiúscula; partes separadas por
// vírgula, ponto e vírgula ou barra). O que não casa fica sem especialidade
// (pendente, M2). O bot (credencial da clínica) lê as especialidades.

let clinicId: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  clinicId = await createClinic("Especialidades");
  const texts: Record<string, string | null> = {
    nome: "pediatria",
    sinonimo: "Cardiologista",
    partes: "Pediatria, Pneumologia pediátrica / pneumo",
    acento: "Ginecologia e Obstetricia",
    nada: "Terapia cognitivo-comportamental",
    vazio: null,
  };
  for (const [key, specialty] of Object.entries(texts)) {
    const { data, error } = await adminClient()
      .from("professionals")
      .insert({ clinic_id: clinicId, display_name: `Prof ${key}`, profession: "Médica", specialty })
      .select("id")
      .single();
    if (error) throw error;
    ids[key] = data.id;
  }
  await withDatabase((db) => db.query("select app.link_legacy_specialties()"));
});

afterAll(async () => {
  await deleteClinics([clinicId]);
});

describe("conversão do texto livre (ME)", () => {
  it("liga pelo nome, pelo sinônimo e pelas partes; o resto fica pendente", async () => {
    const list = await listProfessionals(clinicServiceClient(clinicId) as unknown as DbClient, clinicId);
    const names = (key: string) => list.find((p) => p.id === ids[key])!.specialties.map((s) => s.name);
    expect(names("nome")).toEqual(["Pediatria"]);
    expect(names("sinonimo")).toEqual(["Cardiologia"]);
    // "pneumo" é sinônimo de Pneumologia: entra depois das duas primeiras.
    expect(names("partes")).toEqual(["Pediatria", "Pneumologia pediátrica", "Pneumologia"]);
    expect(names("acento")).toEqual(["Ginecologia e obstetrícia"]);
    expect(names("nada")).toEqual([]);
    expect(names("vazio")).toEqual([]);
  });

  it("rodar de novo não duplica nem mexe em quem já tem", async () => {
    const before = await withDatabase((db) => db.query("select count(*)::int as n from public.professional_specialties where clinic_id = $1", [clinicId]));
    await withDatabase((db) => db.query("select app.link_legacy_specialties()"));
    const after = await withDatabase((db) => db.query("select count(*)::int as n from public.professional_specialties where clinic_id = $1", [clinicId]));
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("o bot não grava especialidade", async () => {
    const { error } = await clinicServiceClient(clinicId)
      .from("professional_specialties")
      .insert({ clinic_id: clinicId, professional_id: ids.nada, specialty_id: (await listProfessionals(adminClient() as unknown as DbClient, clinicId)).find((p) => p.id === ids.nome)!.specialties[0].id, position: 0 });
    expect(error?.code).toBe("42501");
  });
});
