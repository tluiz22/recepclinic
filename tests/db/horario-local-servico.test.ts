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
import { DataError } from "../../src/lib/data/errors";
import { asDb, MON1, NOW, setupAgendaClinic, type AgendaFixture, type AgendaIds } from "./agendaFixture";
import type { TestUser } from "./helpers";

// C5 (cliente, 28/out/2026; caso do Prick test na produção), revista em 10/nov/2026: horário de um serviço num local
// que ele não usa é recusado (a tela só mostra os serviços do local); tirar o local do serviço desativa os horários
// dele ali.
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
  it("horário do serviço num local que ele não usa: recusado (cliente, 10/nov; sai a C5 de 28/out)", async () => {
    // O Exame só é oferecido no Consultório; o horário na Sala B é recusado, e o local não entra no serviço.
    const input = { agendaId: ids.agendaExams, locationId: roomB, serviceId: ids.exame, startTime: "14:00", endTime: "15:00", capacity: null };
    const error = await addAvailabilityWindows(db(admin), clinicId, input, [2]).catch((e: DataError) => e);
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).fields?.serviceId).toMatch(/não é atendido neste local/);
    expect((await getService(db(admin), clinicId, ids.exame)).locations.map((l) => l.locationId)).not.toContain(roomB);

    // Com o local marcado no serviço, salva e passa a valer; editar segue a mesma regra.
    await setServiceLocations(db(admin), clinicId, ids.exame, [
      { locationId: ids.office, priceCents: null },
      { locationId: roomB, priceCents: null },
    ]);
    const saved = await addAvailabilityWindows(db(admin), clinicId, input, [2]);
    expect(await getFreeSlots(db(admin), clinicId, { serviceId: ids.exame, agendaId: ids.agendaExams, date: "2031-03-11" }, NOW)).not.toHaveLength(0);
    const edited = await updateAvailabilityWindow(db(admin), clinicId, saved.windows[0].id, { locationId: ids.home, serviceId: ids.exame, weekday: 2, startTime: "14:00", endTime: "16:00", capacity: null }).catch((e: DataError) => e);
    expect(edited).toBeInstanceOf(DataError);
  });

  it("tirar o local do serviço desativa os horários dele ali; os de outros locais ficam", async () => {
    await setServiceLocations(db(admin), clinicId, ids.exame, [{ locationId: ids.office, priceCents: null }]);
    expect(await deactivateServiceWindowsOutside(db(admin), clinicId, ids.exame, [ids.office])).toBe(1);
    const windows = await listServiceWindows(db(admin), clinicId, ids.exame);
    expect(windows.map((w) => w.locationId)).toEqual([ids.office]);
    expect(await getFreeSlots(db(admin), clinicId, { serviceId: ids.exame, agendaId: ids.agendaExams, date: MON1 }, NOW)).not.toHaveLength(0);
  });
});
