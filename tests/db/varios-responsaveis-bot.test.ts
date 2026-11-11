import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import { contactForResponsible } from "../../src/lib/data/patients";
import { linkPatientContact } from "../../src/lib/data/patientContacts";
import { resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import { declineOffer, type OfferSender } from "../../src/lib/data/waitlist/offers";
import { reminderButtonPayload } from "../../src/lib/data/whatsapp/reminders";
import type { ClinicSender, ListSection, ReplyButton } from "../../src/lib/data/whatsapp/send";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { asDb, at, MON1, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient, clinicServiceClient } from "./helpers";

// F3f, E1 (ponto 1 do /code-review da VR): o bot acha as consultas por qualquer responsável ligado ao paciente
// (`contact_patient_ids`) ou por quem marcou (`booked_by_contact_id`), não só pelo principal (`patients.contact_id`).

const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});

const NUMBER = "vr-bot-numero";
const PREFIX = "+55849912473";
const DAD = `${PREFIX}77`;
const STRANGER = `${PREFIX}88`;
type Sent = { to: string; kind: "text" | "list" | "buttons"; body: string; options: { id: string; title: string }[] };

let f: AgendaFixture;
let sent: Sent[] = [];
let seq = 0;
let dad: string;
let stranger: string;
let consult: string;

const sender: ClinicSender = {
  clinicId: "",
  clinicLabel: "da Clínica VR Bot",
  baseUrl: "https://app.exemplo.test",
  template: async () => ({ sent: false, reason: "sem template no teste" }),
  text: async (to, body) => (sent.push({ to, kind: "text", body, options: [] }), { sent: true, messageId: `wamid.vrb.out.${++seq}`, body }),
  list: async (to: string, body: string, _b: string, sections: ListSection[]) => (
    sent.push({ to, kind: "list", body, options: sections.flatMap((s) => s.rows.map((r) => ({ id: r.id, title: r.title }))) }),
    { sent: true, messageId: `wamid.vrb.out.${++seq}` }
  ),
  buttons: async (to: string, body: string, buttons: ReplyButton[]) => (
    sent.push({ to, kind: "buttons", body, options: buttons }),
    { sent: true, messageId: `wamid.vrb.out.${++seq}` }
  ),
};

const deps = (): WebhookDeps => ({
  resolveClinic: (id) => resolveClinicByPhoneNumberId(id, env()),
  clientFor: (clinicId) => createClinicServiceClient(clinicId, env()),
  senderFor: async () => sender,
});

async function tap(phone: string, payload: string): Promise<Sent[]> {
  sent = [];
  const message = { id: `wamid.vrb.in.${++seq}`, from: phone.slice(1), type: "button", button: { payload, text: "botão" } };
  const summary = await processWebhook({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: NUMBER }, messages: [message] } }] }] }, deps(), new Date());
  expect(summary.errors).toBe(0);
  return sent;
}

const status = async (id: string) => (await adminClient().from("appointments").select("status, patient_confirmed_at").eq("id", id).single()).data!;

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica VR Bot", PREFIX, { oneBotProfessional: true });
  await adminClient().from("whatsapp_connections").insert({ clinic_id: f.clinicId, phone_number_id: NUMBER, waba_id: "vr-bot-waba", status: "connected" });
  await adminClient().from("clinics").update({ portal_slug: `vr-bot-${Date.now()}` }).eq("id", f.clinicId);
  dad = (await contactForResponsible(asDb(f.admin), f.clinicId, { phone: DAD, fullName: "Carlos Souza" })).id;
  stranger = (await contactForResponsible(asDb(f.admin), f.clinicId, { phone: STRANGER, fullName: "Outra Pessoa" })).id;
  await linkPatientContact(asDb(f.reception), f.clinicId, f.ids.p1, dad, "Pai");
  // Marcada pela recepção: quem marcou é a principal (a mãe).
  consult = (
    await bookAppointment(
      asDb(f.reception),
      f.clinicId,
      { patientId: f.ids.p1, serviceId: f.ids.consulta, agendaId: f.ids.agendaDra, start: at(MON1, "08:00"), locationId: f.ids.office, channel: "admin", actorId: null },
      NOW,
    )
  ).appointment.id;
  await adminClient().from("appointments").update({ reminder_sent_at: new Date().toISOString() }).eq("id", consult);
});

afterAll(async () => f.cleanup());

describe("botões do lembrete pelo responsável que não é o principal", () => {
  it("Cancelar: o pai acha a consulta do filho e recebe o portal já no cancelamento (F3f)", async () => {
    const reply = await tap(DAD, reminderButtonPayload("cancel", consult));
    expect(reply[0].body).toContain("Para cancelar a consulta de *Paciente Um*, toque no botão abaixo.");
    const { data: link } = await adminClient().from("portal_links").select("purpose, appointment_id, contact_id").eq("phone", DAD).single();
    expect(link).toEqual({ purpose: "cancel", appointment_id: consult, contact_id: dad });
    expect((await status(consult)).status).toBe("scheduled");
  });

  it("Confirmar: o pai confirma a presença", async () => {
    const reply = await tap(DAD, reminderButtonPayload("confirm", consult));
    expect(reply[0].body).toContain("Presença confirmada ✓");
    expect((await status(consult)).patient_confirmed_at).not.toBeNull();
  });

  it("número que não é responsável nem marcou: não está mais ativo", async () => {
    const reply = await tap(STRANGER, reminderButtonPayload("cancel", consult));
    expect(reply[0].body).toBe("Esse agendamento não está mais ativo.");
  });
});

describe("oferta da lista de espera", () => {
  it("responde quem é responsável ligado; outro número não acha a oferta", async () => {
    const later = consult;
    const service = clinicServiceClient(f.clinicId);
    const { data: entry } = await service.from("waitlist_entries").insert({ clinic_id: f.clinicId, appointment_id: later }).select("id").single();
    const { data: offer } = await service
      .from("waitlist_offers")
      .insert({
        clinic_id: f.clinicId, entry_id: entry!.id, appointment_id: later, slot_scheduled_at: at(MON1, "10:00").toISOString(),
        slot_location_id: f.ids.office, slot_duration_minutes: 30, expires_at: new Date(Date.now() + 3600_000).toISOString(),
      })
      .select("id")
      .single();
    const db = service as unknown as DbClient;
    const noSend: OfferSender = async () => ({ sent: false, reason: "teste" });
    expect((await declineOffer(db, f.clinicId, offer!.id, stranger, noSend)).kind).toBe("not_found");
    expect((await declineOffer(db, f.clinicId, offer!.id, dad, noSend)).kind).toBe("declined");
  });
});
