import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { listOrigins, summarizeOrigins } from "../../src/lib/data/performance";
import { asDb, at, MON1, MON2, MON3, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { registerPatient } from "../../src/lib/data/patients";
import { adminClient } from "./helpers";

// F6, parte 1: de onde vêm as marcações (recepção, WhatsApp e link do portal, com a entrada e o lugar do link).

let fixture: AgendaFixture;

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste da origem", "849333600");
  const { clinicId, ids, admin } = fixture;
  let phone = 10;
  const newPatient = async () => {
    phone += 1;
    const r = await registerPatient(asDb(admin), clinicId, { fullName: `Paciente da Origem ${phone}`, birthdate: "2020-01-01", contact: { mode: "new", fullName: `Resp. ${phone}`, phone: `849333600${phone}` } }, "2031-03-09");
    if (r.status !== "created") throw new Error(r.status);
    return r.patient.id;
  };
  const book = async (date: string, time: string, channel: "admin" | "whatsapp_bot" | "portal", mark?: { entry: string; place?: string }) => {
    const { appointment } = await bookAppointment(
      asDb(admin),
      clinicId,
      { patientId: await newPatient(), serviceId: ids.consulta, agendaId: ids.agendaDra, start: at(date, time), locationId: ids.office, channel, actorId: admin.id },
      NOW,
    );
    if (mark) await adminClient().from("appointments").update({ portal_entry: mark.entry, portal_place: mark.place ?? null }).eq("id", appointment.id);
  };
  await book(MON1, "08:00", "admin");
  await book(MON2, "08:00", "whatsapp_bot");
  await book(MON1, "09:00", "portal", { entry: "whatsapp" });
  await book(MON2, "09:00", "portal", { entry: "clinic_link", place: "instagram" });
  await book(MON3, "08:00", "portal", { entry: "professional_link" });
});

afterAll(async () => {
  await fixture.cleanup();
});

describe("origem das marcações", () => {
  const period = () => ({ start: new Date(Date.now() - 3600_000), end: new Date(Date.now() + 3600_000) });

  it("separa recepção, WhatsApp (bot e link do bot) e link do portal, com o lugar", async () => {
    const { clinicId, ids, admin } = fixture;
    const rows = await listOrigins(asDb(admin), clinicId, { ...period(), agendaIds: [ids.agendaDra] });
    const o = summarizeOrigins(rows);
    expect(o).toMatchObject({ total: 5, reception: 1, whatsapp: 2, portalLink: 2, placeUnknown: 1 });
    expect(o.entries.map((e) => e.key).sort()).toEqual(["clinic_link", "professional_link"]);
    expect(o.places).toEqual([{ key: "instagram", total: 1 }]);
  });

  it("outra agenda e outro período não trazem nada", async () => {
    const { clinicId, ids, admin } = fixture;
    expect(await listOrigins(asDb(admin), clinicId, { ...period(), agendaIds: [ids.agendaDra2] })).toEqual([]);
    const past = { start: new Date("2020-01-01"), end: new Date("2020-02-01") };
    expect(await listOrigins(asDb(admin), clinicId, { ...past, agendaIds: [ids.agendaDra] })).toEqual([]);
  });
});
