import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addAvailabilityWindow } from "../../src/lib/data/config/availability";
import { adminClient, withDatabase } from "./helpers";
import { asDb, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// Migração 20270110130000 (cliente, 10/nov): horários ainda ligados de serviço desativado antes da regra de 08/nov
// ficam desativados e marcados como "saíram com o serviço"; os de serviço ativo e os gerais não mudam.

const MIGRATION = readFileSync(new URL("../../supabase/migrations/20270110130000_horarios_de_servico_desativado.sql", import.meta.url), "utf8");
let f: AgendaFixture;
let leftover: string;
let ofActive: string;

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica Horários de serviço desativado", "+55849912393");
  const a = asDb(f.admin);
  const add = (serviceId: string, startTime: string, endTime: string) =>
    addAvailabilityWindow(a, f.clinicId, { agendaId: f.ids.agendaDra, locationId: f.ids.office, serviceId, weekday: 3, startTime, endTime, capacity: null });
  leftover = (await add(f.ids.consulta, "14:00", "15:00")).id;
  ofActive = (await add(f.ids.retorno, "15:00", "16:00")).id;
  // Desativado como antes de 08/nov: direto no banco, sem a regra que tira os horários junto.
  await adminClient().from("services").update({ is_active: false }).eq("id", f.ids.consulta);
  await withDatabase((db) => db.query(MIGRATION));
});

afterAll(async () => f.cleanup());

describe("horários de serviço desativado (dados de antes de 08/nov)", () => {
  it("o do serviço desativado sai, marcado para voltar com o serviço; os outros ficam", async () => {
    const { data } = await adminClient().from("availability_windows").select("id, is_active, off_with_service").eq("clinic_id", f.clinicId);
    const byId = new Map(data!.map((w) => [w.id, w]));
    expect(byId.get(leftover)).toMatchObject({ is_active: false, off_with_service: true });
    expect(byId.get(ofActive)).toMatchObject({ is_active: true, off_with_service: false });
    // Os gerais da agenda (sem serviço) não mudam.
    expect(data!.filter((w) => w.id !== leftover).every((w) => w.is_active)).toBe(true);
  });
});
