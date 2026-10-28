import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addAvailabilityWindows,
  deactivateServiceWindowsOutside,
  listServiceWindows,
  updateAvailabilityWindow,
} from "../../src/lib/data/config/availability";
import { createLocation } from "../../src/lib/data/config/locations";
import { getService, setServiceLocations } from "../../src/lib/data/config/services";
import { getFreeSlots } from "../../src/lib/data/agenda/slots";
import { asDb, MON1, NOW, setupAgendaClinic, type AgendaFixture, type AgendaIds } from "./agendaFixture";
import type { TestUser } from "./helpers";

// C5 (cliente, 28/out/2026; caso do Prick test na produção): horário de um
// serviço num local que ele não usa marca o local no serviço; tirar o local
// do serviço desativa os horários dele ali.
let fixture: AgendaFixture;
let clinicId: string;
let admin: TestUser;
let ids: AgendaIds;
let roomB: string;
const db = asDb;

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste de horário e local", "859888600");
  ({ clinicId, admin, ids } = fixture);
  roomB = (await createLocation(db(admin), clinicId, { name: "Sala B", type: "clinic", address: "Rua C, 3" })).id;
});

afterAll(async () => {
  await fixture.cleanup();
});

describe("horário do serviço e locais do serviço", () => {
  it("horário do serviço num local que ele não usa: salva, marca o local e o horário passa a valer", async () => {
    // O Exame só é oferecido no Consultório; o horário vai na Sala B, terça.
    const saved = await addAvailabilityWindows(
      db(admin),
      clinicId,
      { agendaId: ids.agendaExams, locationId: roomB, serviceId: ids.exame, startTime: "14:00", endTime: "15:00", capacity: null },
      [2],
    );
    expect(saved.locationAdded).toEqual({ service: "Exame", location: "Sala B" });
    const service = await getService(db(admin), clinicId, ids.exame);
    expect(service.locations).toContainEqual({ locationId: roomB, priceCents: null });
    const slots = await getFreeSlots(db(admin), clinicId, { serviceId: ids.exame, agendaId: ids.agendaExams, date: "2031-03-11" }, NOW);
    expect(slots.length).toBeGreaterThan(0);

    // Editar para um local já marcado: nada a marcar.
    const edited = await updateAvailabilityWindow(db(admin), clinicId, saved.windows[0].id, {
      locationId: roomB,
      serviceId: ids.exame,
      weekday: 2,
      startTime: "14:00",
      endTime: "16:00",
      capacity: null,
    });
    expect(edited.locationAdded).toBeNull();
  });

  it("tirar o local do serviço desativa os horários dele ali; os de outros locais ficam", async () => {
    await setServiceLocations(db(admin), clinicId, ids.exame, [{ locationId: ids.office, priceCents: null }]);
    expect(await deactivateServiceWindowsOutside(db(admin), clinicId, ids.exame, [ids.office])).toBe(1);
    const windows = await listServiceWindows(db(admin), clinicId, ids.exame);
    expect(windows.map((w) => w.locationId)).toEqual([ids.office]);
    expect(await getFreeSlots(db(admin), clinicId, { serviceId: ids.exame, agendaId: ids.agendaExams, date: MON1 }, NOW)).not.toHaveLength(0);
  });
});
