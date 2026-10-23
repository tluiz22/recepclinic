import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment, cancelAppointment } from "../../src/lib/data/agenda/appointments";
import type { DbClient } from "../../src/lib/data/clients";
import { listAppointmentsWithFailedSends } from "../../src/lib/data/sends";
import { joinWaitlist } from "../../src/lib/data/waitlist/entries";
import { processWaitlist } from "../../src/lib/data/waitlist/offers";
import { recordOutboundMessage, updateDeliveryStatus, type SendOutcome } from "../../src/lib/data/whatsapp/messages";
import { runAppointmentReminders } from "../../src/lib/data/whatsapp/reminders";
import { runSendRetries, scheduleRetryAfterLateFailure } from "../../src/lib/data/whatsapp/retries";
import { reminderSender, waitlistOfferSender, type ClinicSender } from "../../src/lib/data/whatsapp/send";
import { asDb, at, MON1, MON2, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient, clinicServiceClient } from "./helpers";

// Reenvio automático de envios com falha técnica (cliente, 23/out/2026):
// mais duas tentativas, 10 e 30 minutos depois da primeira falha; só falha
// técnica; o envio precisa ainda fazer sentido; envio novo toma o lugar.

let f: AgendaFixture;
let db: DbClient;
let seq = 0;
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

const technical = (request: Record<string, unknown>): SendOutcome => ({
  sent: false,
  reason: "Envio pelo WhatsApp: algo deu errado (código 131000)",
  failure: { code: 131000, technical: true },
  request,
  body: "corpo",
});
const permanent = (request: Record<string, unknown>): SendOutcome => ({
  sent: false,
  reason: "Envio pelo WhatsApp: número sem WhatsApp (código 131026)",
  failure: { code: 131026, technical: false },
  request,
  body: "corpo",
});
const ok = (request: Record<string, unknown>): SendOutcome => ({ sent: true, messageId: `wamid.reenvio.${++seq}`, request, body: "corpo" });

/** Envio de mentira: cada envio (primeiro ou reenvio) usa o próximo resultado da fila. */
let next: ((request: Record<string, unknown>) => SendOutcome)[] = [];
const resends: Record<string, unknown>[] = [];
const take = (request: Record<string, unknown>) => (next.shift() ?? ok)(request);
const sender: ClinicSender = {
  clinicId: "",
  clinicLabel: "da Clínica Reenvio",
  baseUrl: "https://app.exemplo.test",
  template: async (to, key, template) => take({ to, type: "template", template: { name: template.name, key } }),
  text: async (to) => take({ to, type: "text" }),
  list: async (to) => take({ to, type: "interactive" }),
  buttons: async (to) => take({ to, type: "interactive" }),
  resend: async (request) => (resends.push(request), take(request)),
};

const messagesOf = async (appointmentId: string, type = "appointment_reminder") =>
  (
    await adminClient()
      .from("whatsapp_messages")
      .select("id, status, attempt, first_attempt_id, failure_code, retry_at, retry_payload, wa_message_id")
      .eq("appointment_id", appointmentId)
      .eq("message_type", type)
      .order("created_at")
      .order("attempt")
  ).data!;

const book = async (patientId: string, serviceId: string, agendaId: string, start: Date) =>
  (await bookAppointment(asDb(f.reception), f.clinicId, { patientId, serviceId, agendaId, start, locationId: f.ids.office, channel: "admin", actorId: null }, NOW)).appointment;

/** Tira o atendimento das próximas rodadas do lembrete (a rotina pega todos ainda sem lembrete). */
const settle = (appointmentId: string) => adminClient().from("appointments").update({ reminder_sent_at: NOW.toISOString() }).eq("id", appointmentId);

const remind = () => runAppointmentReminders(db, f.clinicId, { trigger: "manual", sender: reminderSender(sender) }, NOW);

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica Reenvio", "849666600");
  db = clinicServiceClient(f.clinicId) as unknown as DbClient;
  await adminClient().from("whatsapp_connections").insert({ clinic_id: f.clinicId, phone_number_id: "reenvio-numero", waba_id: "reenvio-waba", status: "connected" });
  await adminClient().from("whatsapp_templates").insert([
    { clinic_id: f.clinicId, template_key: "reminder", name: "rc_lembrete_v1", status: "approved" },
    { clinic_id: f.clinicId, template_key: "waitlist_offer", name: "rc_oferta_vaga_v1", status: "approved" },
  ]);
});

afterAll(async () => f.cleanup());

describe("lembrete com falha técnica", () => {
  let first = "";

  it("a 1ª falha guarda o motivo e o pedido e prevê a 2ª tentativa 10 minutos depois", async () => {
    first = (await book(f.ids.p1, f.ids.consulta, f.ids.agendaDra, at(MON1, "09:00"))).id;
    next = [technical];
    expect(await remind()).toMatchObject({ totals: { candidates: 1, failed: 1 } });
    const [row] = await messagesOf(first);
    expect(row).toMatchObject({ status: "failed", attempt: 1, first_attempt_id: null, failure_code: 131000 });
    expect(new Date(row.retry_at!)).toEqual(minutes(10));
    expect(row.retry_payload).toMatchObject({ request: { type: "template" }, context: { scheduledAt: at(MON1, "09:00").toISOString() } });

    // Na aba Envios: "Tentando de novo (2 de 3)", ainda sem contar como falha.
    const [listed] = await listAppointmentsWithFailedSends(db, f.clinicId, {}, NOW);
    expect(listed).toMatchObject({ id: first, failedSends: 0, retrying: [2] });
  });

  it("antes da hora, nada; na hora, sai com o mesmo pedido e conta como lembrado", async () => {
    expect(await runSendRetries(db, f.clinicId, sender, minutes(5))).toMatchObject({ due: 0 });
    next = [ok];
    expect(await runSendRetries(db, f.clinicId, sender, minutes(10))).toMatchObject({ due: 1, sent: 1 });
    expect(resends.at(-1)).toMatchObject({ type: "template", template: { name: "rc_lembrete_v1" } });

    const rows = await messagesOf(first);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ attempt: 1, retry_at: null, retry_payload: null });
    expect(rows[1]).toMatchObject({ status: "sent", attempt: 2, first_attempt_id: rows[0].id, retry_at: null });
    const { data } = await adminClient().from("appointments").select("reminder_sent_at").eq("id", first).single();
    expect(new Date(data!.reminder_sent_at!)).toEqual(minutes(10));
    expect(await listAppointmentsWithFailedSends(db, f.clinicId, {}, NOW)).toEqual([]);
  });

  it("a Meta avisa depois que não entregou (técnica): nova tentativa 20 minutos depois da 2ª; não técnica: nenhuma", async () => {
    const [, second] = await messagesOf(first);
    const failed = await updateDeliveryStatus(db, f.clinicId, second.wa_message_id!, "failed");
    expect(failed.updated).toBe(true);
    expect(await scheduleRetryAfterLateFailure(db, f.clinicId, second.id, { code: 131000, title: "Something went wrong" }, minutes(11))).toBe(true);
    let rows = await messagesOf(first);
    expect(new Date(rows[1].retry_at!)).toEqual(minutes(31));
    expect(rows[1]).toMatchObject({ failure_code: 131000 });

    // Agora uma não técnica, na mesma mensagem: a tentativa prevista sai e o pedido some.
    expect(await scheduleRetryAfterLateFailure(db, f.clinicId, second.id, { code: 131026, title: "Message undeliverable" }, minutes(12))).toBe(false);
    rows = await messagesOf(first);
    expect(rows[1]).toMatchObject({ failure_code: 131026, retry_at: null, retry_payload: null });
  });

  it("três falhas técnicas: depois da 3ª, nenhuma tentativa e o 'Não entregue' na aba Envios", async () => {
    const appointment = (await book(f.ids.p2, f.ids.consulta, f.ids.agendaDra, at(MON1, "10:00"))).id;
    next = [technical];
    await remind();
    next = [technical];
    expect(await runSendRetries(db, f.clinicId, sender, minutes(10))).toMatchObject({ due: 1, failed: 1 });
    const middle = await messagesOf(appointment);
    expect(new Date(middle[1].retry_at!)).toEqual(minutes(30));
    expect((await listAppointmentsWithFailedSends(db, f.clinicId, {}, NOW)).find((a) => a.id === appointment)).toMatchObject({ failedSends: 0, retrying: [3] });

    next = [technical];
    expect(await runSendRetries(db, f.clinicId, sender, minutes(30))).toMatchObject({ due: 1, gaveUp: 1 });
    const rows = await messagesOf(appointment);
    expect(rows.map((r) => [r.attempt, r.status, r.retry_at])).toEqual([
      [1, "failed", null],
      [2, "failed", null],
      [3, "failed", null],
    ]);
    expect(rows.every((r) => r.first_attempt_id === null || r.first_attempt_id === rows[0].id)).toBe(true);
    expect((await listAppointmentsWithFailedSends(db, f.clinicId, {}, NOW)).find((a) => a.id === appointment)).toMatchObject({ failedSends: 1, retrying: [] });
    await settle(appointment);
  });

  it("falha não técnica (número sem WhatsApp): nenhuma tentativa", async () => {
    const appointment = (await book(f.ids.p3, f.ids.consulta, f.ids.agendaDra, at(MON1, "11:00"))).id;
    next = [permanent];
    await remind();
    const [row] = await messagesOf(appointment);
    expect(row).toMatchObject({ status: "failed", failure_code: 131026, retry_at: null });
    await settle(appointment);
  });

  it("remarcado antes da tentativa: não reenvia", async () => {
    const appointment = (await book(f.ids.p1, f.ids.exame, f.ids.agendaExams, at(MON1, "08:00"))).id;
    next = [technical];
    await remind();
    await adminClient().from("appointments").update({ scheduled_at: at(MON1, "08:20").toISOString() }).eq("id", appointment);
    const before = resends.length;
    expect(await runSendRetries(db, f.clinicId, sender, minutes(10))).toMatchObject({ due: 1, dropped: 1 });
    expect(resends.length).toBe(before);
    expect(await messagesOf(appointment)).toHaveLength(1);
    await settle(appointment);
  });

  it("envio novo do mesmo tipo (pelo botão da tela) toma o lugar da tentativa prevista", async () => {
    const appointment = (await book(f.ids.p2, f.ids.exame, f.ids.agendaExams, at(MON1, "08:40"))).id;
    next = [technical];
    await remind();
    expect((await messagesOf(appointment))[0].retry_at).not.toBeNull();
    await recordOutboundMessage(db, f.clinicId, { phone: "+5584966660002", appointmentId: appointment, messageType: "appointment_reminder", status: "sent", waMessageId: "wamid.tela.1" }, minutes(3));
    expect((await messagesOf(appointment))[0].retry_at).toBeNull();
    expect(await runSendRetries(db, f.clinicId, sender, minutes(10))).toMatchObject({ due: 0 });
  });
});

describe("oferta de vaga com falha técnica", () => {
  it("a vaga fica reservada para a pessoa; quando o reenvio sai, os 60 minutos contam dali", async () => {
    const service = { serviceId: f.ids.consulta, agendaId: f.ids.agendaDra2 };
    const waiting = await book(f.ids.p3, service.serviceId, service.agendaId, at(MON2, "08:00"));
    await joinWaitlist(db, f.clinicId, waiting.id, { via: "whatsapp_bot", actorId: null }, NOW);
    await book(f.ids.p1, service.serviceId, service.agendaId, at(MON1, "08:00")); // ocupa o horário antes da vaga
    const source = await book(f.ids.p2, service.serviceId, service.agendaId, at(MON1, "08:30"));
    await cancelAppointment(asDb(f.reception), f.clinicId, source.id, { channel: "admin", actorId: null }, NOW);
    const { data: opening } = await adminClient().from("waitlist_openings").select("id").eq("opened_by_appointment_id", source.id).single();

    next = [technical];
    expect(await processWaitlist(db, f.clinicId, waitlistOfferSender(sender, db), NOW)).toMatchObject({ offered: 1, skipped: 0 });
    const offerRow = async () =>
      (await adminClient().from("waitlist_offers").select("id, status, expires_at, whatsapp_message_id, details").eq("opening_id", opening!.id).single()).data!;
    let offer = await offerRow();
    expect(offer).toMatchObject({ status: "pending", whatsapp_message_id: null, details: { retrying: true } });
    // Reservada até a última tentativa (30 min) e os 60 minutos depois dela, com folga de 5.
    expect(new Date(offer.expires_at)).toEqual(minutes(95));
    expect((await adminClient().from("waitlist_openings").select("status").eq("id", opening!.id).single()).data!.status).toBe("offering");

    next = [technical];
    await runSendRetries(db, f.clinicId, sender, minutes(10));
    expect(new Date((await offerRow()).expires_at)).toEqual(minutes(10 + 20 + 60 + 5));

    next = [ok];
    expect(await runSendRetries(db, f.clinicId, sender, minutes(30))).toMatchObject({ sent: 1 });
    offer = await offerRow();
    expect(offer).toMatchObject({ status: "pending", details: {} });
    expect(offer.whatsapp_message_id).toMatch(/^wamid\.reenvio\./);
    expect(new Date(offer.expires_at)).toEqual(minutes(90));
    const rows = await messagesOf(waiting.id, "waitlist_offer");
    expect(rows.map((r) => [r.attempt, r.status])).toEqual([
      [1, "failed"],
      [2, "failed"],
      [3, "sent"],
    ]);
  });

  it("as três falharam: a pessoa é pulada e a vaga volta para a fila", async () => {
    const service = { serviceId: f.ids.consulta, agendaId: f.ids.agendaDra2 };
    const { data: entry } = await adminClient().from("waitlist_entries").select("appointment_id").eq("clinic_id", f.clinicId).eq("status", "active").single();
    // Nova vaga: a oferta anterior foi recusada pela pessoa.
    await adminClient().from("waitlist_offers").update({ status: "declined" }).eq("clinic_id", f.clinicId).eq("status", "pending");
    await adminClient().from("waitlist_openings").update({ status: "closed", closed_reason: "declined" }).eq("clinic_id", f.clinicId).eq("status", "offering");
    const source = await book(f.ids.p2, service.serviceId, service.agendaId, at(MON1, "08:30"));
    await cancelAppointment(asDb(f.reception), f.clinicId, source.id, { channel: "admin", actorId: null }, minutes(31));
    const { data: opening } = await adminClient().from("waitlist_openings").select("id").eq("opened_by_appointment_id", source.id).single();

    next = [technical];
    await processWaitlist(db, f.clinicId, waitlistOfferSender(sender, db), minutes(31));
    next = [technical, technical];
    await runSendRetries(db, f.clinicId, sender, minutes(41));
    expect(await runSendRetries(db, f.clinicId, sender, minutes(61))).toMatchObject({ gaveUp: 1 });
    const { data: offer } = await adminClient().from("waitlist_offers").select("status, details").eq("opening_id", opening!.id).single();
    expect(offer).toMatchObject({ status: "skipped", details: { retries_exhausted: true } });
    expect((await adminClient().from("waitlist_openings").select("status").eq("id", opening!.id).single()).data!.status).toBe("open");
    expect(entry!.appointment_id).toBeTruthy();
  });
});

describe("resumo do dia e nota fiscal", () => {
  it("resumo cujo dia já passou: não reenvia", async () => {
    await recordOutboundMessage(
      db,
      f.clinicId,
      {
        phone: "+5584966669999",
        contactId: null,
        messageType: "daily_summary_consultas",
        status: "failed",
        retry: { outcome: technical({ to: "5584966669999", type: "template" }), context: { until: minutes(5).toISOString() } },
      },
      NOW,
    );
    const before = resends.length;
    expect(await runSendRetries(db, f.clinicId, sender, minutes(10))).toMatchObject({ due: 1, dropped: 1 });
    expect(resends.length).toBe(before);
  });

  it("as funções da nota só servem à credencial da clínica, e só para a própria clínica", async () => {
    const unknown = "00000000-0000-4000-8000-000000000000";
    const { data, error } = await clinicServiceClient(f.clinicId).rpc("nfse_invoice_issued_for_retry", { p_invoice_id: unknown });
    expect(error).toBeNull();
    expect(data).toBe(false);
    const asReception = await f.reception.client.rpc("nfse_invoice_issued_for_retry", { p_invoice_id: unknown });
    expect(asReception.error?.code).toBe("42501");
    const follow = await f.reception.client.rpc("nfse_delivery_follow_retry", { p_previous_message_id: unknown, p_message_id: unknown, p_sent: true, p_error: "" });
    expect(follow.error?.code).toBe("42501");
  });
});
