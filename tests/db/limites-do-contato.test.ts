import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { updateClinicSettings } from "../../src/lib/data/config/clinic";
import { contactForResponsible, setContactActive } from "../../src/lib/data/patients";
import {
  checkBookingLimits,
  contactForLimits,
  listContactLimitEvents,
  listContactsToReview,
  markContactReviewed,
  recordBotLimitEvent,
  setContactBotLimitsExempt,
} from "../../src/lib/data/whatsapp/botLimits";
import { asDb, at, codeOf, MON1, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient, clinicServiceClient, createClinic, deleteClinics } from "./helpers";
import type { DbClient } from "../../src/lib/data/clients";

// Limites do contato (F9.6a). Bot enxuto (F3f): a marcação saiu do chat; os limites valem no portal
// (portal/booking.ts e returnVisit.ts), que grava os mesmos registros. Aqui: telas, Uso, acesso, Revisado e liberar.

const PHONE = "+5584991229699";
let f: AgendaFixture;
let service: DbClient;
let contact: string;

const events = async () =>
  (await adminClient().from("bot_limit_events").select("reason, limit_value, current_value, paused").eq("clinic_id", f.clinicId).order("id")).data!;

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica Limites F96", "+55849912296");
  service = clinicServiceClient(f.clinicId) as unknown as DbClient;
  await adminClient().from("clinic_settings").update({ bot_max_future_appointments: 1, bot_max_new_patients: 2, bot_max_no_shows: 0 }).eq("clinic_id", f.clinicId);
  contact = (await contactForResponsible(asDb(f.admin), f.clinicId, { phone: PHONE, fullName: "Rita Lima" })).id;
  await recordBotLimitEvent(service, f.clinicId, contact, { reason: "future_appointments", limit: 2, current: 2 }, false, new Date(Date.now() - 8000));
  await recordBotLimitEvent(service, f.clinicId, contact, { reason: "new_patients", limit: 2, current: 2 }, false, new Date(Date.now() - 7000));
  await recordBotLimitEvent(service, f.clinicId, contact, { reason: "no_shows", limit: 1, current: 1 }, false, new Date(Date.now() - 6000));
  await recordBotLimitEvent(service, f.clinicId, contact, { reason: "no_shows", limit: 1, current: 1 }, true, new Date(Date.now() - 5000));
});

afterAll(async () => f.cleanup());

describe("limites: telas, Uso e acesso", () => {
  it("tela do contato e Painel (Contatos para revisar), pela equipe", async () => {
    const db = asDb(f.reception);
    const list = await listContactLimitEvents(db, f.clinicId, contact);
    expect(list.map((e) => e.reason)).toEqual(["no_shows", "no_shows", "new_patients", "future_appointments"]);
    expect(list[0].paused).toBe(true);
    const review = await listContactsToReview(db, f.clinicId);
    expect(review).toEqual([expect.objectContaining({ contactId: contact, name: "Rita Lima", hits: 4 })]);
    expect(review[0].last.reason).toBe("no_shows");
    expect(review[0].phone).toBe(PHONE);
  });

  it("Uso: conta cada limite atingido no mês", async () => {
    const { data } = await adminClient().from("clinic_usage_monthly").select("bot_limit_hits").eq("clinic_id", f.clinicId);
    expect(data!.reduce((sum, row) => sum + row.bot_limit_hits, 0)).toBe(4);
  });

  it("a equipe não grava limites; outra clínica não lê", async () => {
    const { error } = await f.reception.client
      .from("bot_limit_events")
      .insert({ clinic_id: f.clinicId, contact_id: contact, reason: "no_shows", limit_value: 1, current_value: 1, paused: false });
    expect(error).not.toBeNull();
    const other = await createClinic("Clínica Outra F96");
    try {
      const { data } = await clinicServiceClient(other).from("bot_limit_events").select("id").eq("clinic_id", f.clinicId);
      expect(data).toEqual([]);
    } finally {
      await deleteClinics([other]);
    }
  });

  it("Configurações › Clínica: faixas dos limites", async () => {
    const db = asDb(f.admin);
    expect(await codeOf(() => updateClinicSettings(db, f.clinicId, { botMaxFutureAppointments: 0 }))).toBe("invalid");
    expect(await codeOf(() => updateClinicSettings(db, f.clinicId, { botMaxNewPatients: 11 }))).toBe("invalid");
    expect(await codeOf(() => updateClinicSettings(db, f.clinicId, { botMaxNoShows: Number.NaN }))).toBe("invalid");
    const saved = await updateClinicSettings(db, f.clinicId, { botMaxFutureAppointments: 1, botMaxNewPatients: 1, botMaxNoShows: 0 });
    expect(saved).toMatchObject({ botMaxFutureAppointments: 1, botMaxNewPatients: 1, botMaxNoShows: 0 });
    expect(await codeOf(() => updateClinicSettings(asDb(f.reception), f.clinicId, { botMaxNoShows: 3 }))).not.toBe("ok");
  });
});

describe("limites: Revisado, liberar e contato desativado (validação, 10/out)", () => {
  it("Revisado (Recepção): sai do Painel e volta no próximo limite", async () => {
    await markContactReviewed(asDb(f.reception), f.clinicId, contact);
    expect(await listContactsToReview(asDb(f.reception), f.clinicId)).toEqual([]);
    await recordBotLimitEvent(service, f.clinicId, contact, { reason: "new_patients", limit: 1, current: 1 }, false, new Date(Date.now() + 2000));
    expect(await listContactsToReview(asDb(f.reception), f.clinicId)).toEqual([expect.objectContaining({ contactId: contact, hits: 1 })]);
  });

  it("liberar: só o Administrador; o número liberado aparece como liberado para os limites", async () => {
    expect(await codeOf(() => setContactBotLimitsExempt(asDb(f.reception), f.clinicId, contact, true))).not.toBe("ok");
    const { error } = await f.reception.client.from("contacts").update({ bot_limits_exempt_at: new Date().toISOString() }).eq("id", contact);
    expect(error).not.toBeNull();
    await setContactBotLimitsExempt(asDb(f.admin), f.clinicId, contact, true);
    const { data } = await adminClient().from("contacts").select("bot_limits_exempt_at, bot_limits_exempt_by").eq("id", contact).single();
    expect(data!.bot_limits_exempt_at).not.toBeNull();
    expect(data!.bot_limits_exempt_by).toBe(f.admin.id);
    expect(await contactForLimits(service, f.clinicId, PHONE)).toEqual({ id: contact, exempt: true });
    await setContactBotLimitsExempt(asDb(f.admin), f.clinicId, contact, false);
    expect((await contactForLimits(service, f.clinicId, PHONE))!.exempt).toBe(false);
  });

  it("contato desativado continua contando", async () => {
    const before = (await events()).length;
    const p = (await adminClient().from("patients").select("id").eq("clinic_id", f.clinicId).eq("full_name", "Paciente Um").single()).data!.id;
    await adminClient().from("patient_contacts").insert({ clinic_id: f.clinicId, patient_id: p, contact_id: contact });
    await bookAppointment(
      asDb(f.reception),
      f.clinicId,
      { patientId: p, bookedByContactId: contact, serviceId: f.ids.consulta, agendaId: f.ids.agendaDra, start: at(MON1, "08:00"), locationId: f.ids.office, channel: "admin", actorId: null },
      NOW,
    );
    await setContactActive(asDb(f.reception), f.clinicId, contact, false);
    expect(await contactForLimits(service, f.clinicId, PHONE)).toMatchObject({ id: contact });
    expect(await checkBookingLimits(service, f.clinicId, contact, NOW)).toMatchObject({ reason: "future_appointments", limit: 1, current: 1 });
    expect((await events()).length).toBe(before);
  });
});
