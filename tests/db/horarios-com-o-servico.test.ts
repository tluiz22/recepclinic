import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addAvailabilityWindows,
  deactivateWindowsWithService,
  listAvailability,
  listServiceWindows,
  reactivateWindowsWithService,
  setAvailabilityWindowActive,
} from "../../src/lib/data/config/availability";
import { setServiceActive } from "../../src/lib/data/config/services";
import { asDb, setupAgendaClinic, type AgendaFixture, type AgendaIds } from "./agendaFixture";
import type { TestUser } from "./helpers";

// Horários que saem e voltam com o serviço (cliente, 08/nov/2026): desativar o
// serviço desativa os horários só dele; reativar traz de volta só esses.
let fixture: AgendaFixture;
let clinicId: string;
let admin: TestUser;
let ids: AgendaIds;
const db = asDb;

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste de horários com o serviço", "859777100");
  ({ clinicId, admin, ids } = fixture);
});

afterAll(async () => {
  await fixture.cleanup();
});

const windowOf = async (id: string) =>
  (await listAvailability(db(admin), clinicId, ids.agendaDra, { includeInactive: true })).find((w) => w.id === id)!;

describe("horários do serviço ao desativar e reativar", () => {
  let wednesday: string;
  let thursday: string;
  let friday: string;

  it("desativar o serviço desativa só os horários ativos dele", async () => {
    const add = async (weekday: number) =>
      (
        await addAvailabilityWindows(
          db(admin),
          clinicId,
          { agendaId: ids.agendaDra, locationId: ids.office, serviceId: ids.consulta, startTime: "20:00", endTime: "21:00", capacity: null },
          [weekday],
        )
      ).windows[0].id;
    wednesday = await add(3);
    thursday = await add(4);
    friday = await add(5);
    // Quinta já estava desativada antes: não volta com o serviço.
    await setAvailabilityWindowActive(db(admin), clinicId, thursday, false);

    const active = (await listServiceWindows(db(admin), clinicId, ids.consulta)).length;
    expect(await deactivateWindowsWithService(db(admin), clinicId, ids.consulta)).toBe(active);
    await setServiceActive(db(admin), clinicId, ids.consulta, false);
    expect(await listServiceWindows(db(admin), clinicId, ids.consulta)).toHaveLength(0);
  });

  it("reativar traz de volta os que saíram com ele; o que cruza com outro horário fica desativado", async () => {
    // Enquanto o serviço estava desativado, entrou um horário geral na sexta à noite, no mesmo lugar.
    await addAvailabilityWindows(
      db(admin),
      clinicId,
      { agendaId: ids.agendaDra, locationId: ids.office, serviceId: null, startTime: "20:00", endTime: "21:00", capacity: null },
      [5],
    );
    await setServiceActive(db(admin), clinicId, ids.consulta, true);
    const { reactivated, blocked } = await reactivateWindowsWithService(db(admin), clinicId, ids.consulta);
    expect(blocked).toBe(1);
    expect(reactivated).toBeGreaterThanOrEqual(1);

    expect((await windowOf(wednesday)).isActive).toBe(true);
    expect((await windowOf(thursday)).isActive).toBe(false);
    expect((await windowOf(friday)).isActive).toBe(false);
    // Ninguém fica marcado para voltar depois.
    expect(await reactivateWindowsWithService(db(admin), clinicId, ids.consulta)).toEqual({ reactivated: 0, blocked: 0 });
  });
});
