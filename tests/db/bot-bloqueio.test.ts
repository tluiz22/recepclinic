import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import { getContact } from "../../src/lib/data/patients";
import { resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import { joinWaitlist } from "../../src/lib/data/waitlist/entries";
import { blockContact, getContactBlock, unblockContact } from "../../src/lib/data/whatsapp/contactBlock";
import type { ClinicSender, ListSection, ReplyButton } from "../../src/lib/data/whatsapp/send";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { asDb, at, codeOf, MON1, MON2, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient } from "./helpers";

// F9.6b — Bloquear contato: só o Administrador; cancela sem aviso os
// atendimentos futuros (opção), encerra as séries, tira da lista de espera;
// o bot responde neutro uma vez por dia; desbloquear volta ao normal.

const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});

const NUMBER = "f96b-numero";
const PHONE = "+5584991229701"; // contato do Paciente Um
const BLOCKED_NO_RECEPTION = "Sua conversa está com a recepção, que vai entrar em contato com você.";
const BLOCKED_HANDOFF = "Sua conversa está com a recepção, que responde por aqui assim que possível.";

type Sent = { to: string; kind: string; body: string };
let f: AgendaFixture;
let sent: Sent[] = [];
let seq = 0;

const sender: ClinicSender = {
  clinicId: "",
  clinicLabel: "da Clínica Bot F96b",
  baseUrl: "https://app.exemplo.test",
  template: async () => ({ sent: false, reason: "sem template no teste" }),
  text: async (to, body) => (sent.push({ to, kind: "text", body }), { sent: true, messageId: `wamid.f96b.out.${++seq}`, body }),
  list: async (to: string, body: string, _button: string, _sections: ListSection[]) => (sent.push({ to, kind: "list", body }), { sent: true, messageId: `wamid.f96b.out.${++seq}` }),
  buttons: async (to: string, body: string, _buttons: ReplyButton[]) => (sent.push({ to, kind: "buttons", body }), { sent: true, messageId: `wamid.f96b.out.${++seq}` }),
};

const deps = (): WebhookDeps => ({
  resolveClinic: (id) => resolveClinicByPhoneNumberId(id, env()),
  clientFor: (clinicId) => createClinicServiceClient(clinicId, env()),
  senderFor: async () => sender,
});

async function say(text: string): Promise<Sent[]> {
  sent = [];
  const summary = await processWebhook(
    {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: { metadata: { phone_number_id: NUMBER }, messages: [{ id: `wamid.f96b.in.${++seq}`, from: PHONE.slice(1), type: "text", text: { body: text } }] },
            },
          ],
        },
      ],
    },
    deps(),
    new Date(),
  );
  expect(summary.errors).toBe(0);
  return sent;
}

const contactId = async () => (await adminClient().from("contacts").select("id").eq("clinic_id", f.clinicId).eq("phone", PHONE).single()).data!.id;

async function book(start: Date, serviceId = f.ids.consulta, agendaId = f.ids.agendaDra) {
  const result = await bookAppointment(
    asDb(f.reception),
    f.clinicId,
    { patientId: f.ids.p1, serviceId, agendaId, start, locationId: f.ids.office, channel: "admin", actorId: null },
    NOW,
  );
  return result.appointment.id;
}

let first: string;
let second: string;
let seriesId: string;

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica Bot F96b", "+55849912297");
  await adminClient().from("whatsapp_connections").insert({ clinic_id: f.clinicId, phone_number_id: NUMBER, waba_id: "f96b-waba", status: "connected" });
  first = await book(at(MON1, "08:00"));
  second = await book(at(MON2, "08:00"), f.ids.consulta, f.ids.agendaDra2);
  expect(await joinWaitlist(asDb(f.reception), f.clinicId, first, { via: "admin", actorId: f.reception.id }, new Date())).toBe("joined");
  const { data: series } = await adminClient()
    .from("appointment_series")
    .insert({
      clinic_id: f.clinicId,
      patient_id: f.ids.p1,
      service_id: f.ids.consulta,
      agenda_id: f.ids.agendaDra,
      location_id: f.ids.office,
      interval_weeks: 1,
      weekday: 3,
      start_time: "10:00",
      duration_minutes: 30,
      starts_on: "2031-04-02",
    })
    .select("id")
    .single();
  seriesId = series!.id;
});

afterAll(async () => f.cleanup());

describe("bloquear contato", () => {
  it("só o Administrador; a equipe não grava o bloqueio direto", async () => {
    const id = await contactId();
    expect(await codeOf(() => blockContact(asDb(f.reception), f.clinicId, id, { reason: null, cancelFuture: false }, f.reception.id))).not.toBe("ok");
    const { error } = await f.reception.client.from("contacts").update({ bot_blocked_at: new Date().toISOString() }).eq("id", id);
    expect(error).not.toBeNull();
    expect(await getContactBlock(asDb(f.reception), f.clinicId, id)).toBeNull();
  });

  it("com a opção: cancela sem aviso, encerra a série e tira da lista de espera", async () => {
    const id = await contactId();
    const result = await blockContact(asDb(f.admin), f.clinicId, id, { reason: "Marcações em massa", cancelFuture: true }, f.admin.id);
    expect(result).toEqual({ canceled: 2, seriesEnded: 1, leftWaitlist: 1 });

    const { data: appointments } = await adminClient().from("appointments").select("status, mass_canceled, canceled_via").in("id", [first, second]);
    expect(appointments).toEqual([
      { status: "canceled", mass_canceled: true, canceled_via: "admin" },
      { status: "canceled", mass_canceled: true, canceled_via: "admin" },
    ]);
    const { data: series } = await adminClient().from("appointment_series").select("ended_at").eq("id", seriesId).single();
    expect(series!.ended_at).not.toBeNull();
    const { data: entry } = await adminClient().from("waitlist_entries").select("status").eq("appointment_id", first).single();
    expect(entry!.status).toBe("removed");
    // Sem aviso: nenhuma mensagem dos atendimentos cancelados.
    const { count } = await adminClient().from("whatsapp_messages").select("id", { count: "exact", head: true }).in("appointment_id", [first, second]);
    expect(count).toBe(0);

    const block = await getContactBlock(asDb(f.reception), f.clinicId, id);
    expect(block).toMatchObject({ blockedBy: f.admin.id, reason: "Marcações em massa" });
    expect((await getContact(asDb(f.reception), f.clinicId, id)).botBlockedAt).not.toBeNull();
  });

  it("bot: resposta neutra uma vez por dia, sem menu", async () => {
    expect(await say("oi")).toEqual([{ to: PHONE, kind: "text", body: BLOCKED_NO_RECEPTION }]);
    expect(await say("1")).toEqual([]);
    const { data: convo } = await adminClient().from("conversation_state").select("state").eq("clinic_id", f.clinicId).eq("contact_phone", PHONE).single();
    expect(convo!.state).toBe("WELCOME");

    // Com coexistência (e num dia novo), o texto da recepção que responde por aqui.
    await adminClient().from("whatsapp_connections").update({ coexistence: true }).eq("clinic_id", f.clinicId);
    await adminClient().from("contacts").update({ bot_blocked_notified_at: new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString() }).eq("phone", PHONE).eq("clinic_id", f.clinicId);
    expect(await say("oi")).toEqual([{ to: PHONE, kind: "text", body: BLOCKED_HANDOFF }]);
  });

  it("desbloquear: o bot volta a atender (os cancelados não voltam)", async () => {
    await unblockContact(asDb(f.admin), f.clinicId, await contactId());
    const reply = await say("oi");
    expect(reply.at(-1)!.kind).toBe("list");
    const { data } = await adminClient().from("appointments").select("status").eq("id", first).single();
    expect(data!.status).toBe("canceled");
  });

  it("sem a opção: os atendimentos ficam marcados", async () => {
    const third = await book(at(MON1, "10:00"));
    const result = await blockContact(asDb(f.admin), f.clinicId, await contactId(), { reason: null, cancelFuture: false }, f.admin.id);
    expect(result).toEqual({ canceled: 0, seriesEnded: 0, leftWaitlist: 0 });
    const { data } = await adminClient().from("appointments").select("status").eq("id", third).single();
    expect(data!.status).toBe("scheduled");
    await unblockContact(asDb(f.admin), f.clinicId, await contactId());
  });
});
