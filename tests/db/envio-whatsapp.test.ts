import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment, cancelAppointment } from "../../src/lib/data/agenda/appointments";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import type { DbClient } from "../../src/lib/data/clients";
import { resolveClinicByPhoneNumberId, resolveClinicsByWabaId } from "../../src/lib/data/platform";
import { setWhatsappAccessToken } from "../../src/lib/data/whatsapp/connection";
import { recordOutboundMessage } from "../../src/lib/data/whatsapp/messages";
import { clinicCancellationSummary, notifyClinicCancellations, sendAppointmentNotice } from "../../src/lib/data/whatsapp/notices";
import { cancelByClinic } from "../../src/lib/data/agenda/blocks";
import { createClinicSender } from "../../src/lib/data/whatsapp/send";
import { createDefaultTemplates, refreshTemplateStatuses } from "../../src/lib/data/whatsapp/templateSync";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { asDb, at, MON1, MON2, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient, createUser, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";

// F6.2 — Envio pela conexão da clínica: templates padrão criados na conta,
// avisos de marcado/remarcado/cancelado, preparo depois da entrega e situação
// dos templates pelo webhook. A Meta é simulada (nenhuma chamada sai).

const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});

const NUMBER = "f62-numero";
const WABA = "f62-waba";
const BASE_URL = "https://app.exemplo.test";

type Call = { method: string; path: string; body: Record<string, unknown> | null };
let fakes = 0;

/** Meta de mentira: guarda as chamadas; templates pela situação de `metaStatus`. */
function fakeMeta(metaStatus: Record<string, { status: string; reason?: string }> = {}) {
  const calls: Call[] = [];
  const run = ++fakes;
  let next = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v[\d.]+/, "");
    calls.push({ method: init?.method ?? "GET", path: `${path}${url.search}`, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (path.endsWith("/messages")) return new Response(JSON.stringify({ messages: [{ id: `wamid.f62.${run}.${++next}` }] }));
    if (path.endsWith("/message_templates") && init?.method === "POST") {
      return new Response(JSON.stringify({ id: `tpl-${++next}`, status: "PENDING", category: "UTILITY" }));
    }
    if (path.endsWith("/message_templates")) {
      const name = url.searchParams.get("name") ?? "";
      const known = metaStatus[name];
      const data = known ? [{ id: `tpl-${name}`, name, language: "pt_BR", status: known.status, rejected_reason: known.reason ?? "NONE" }] : [];
      return new Response(JSON.stringify({ data }));
    }
    return new Response(JSON.stringify({ error: { code: 100, message: "inesperado" } }), { status: 400 });
  };
  return { calls, fetcher };
}

let f: AgendaFixture;
let support: TestUser;
let service: DbClient;

const sender = (fetcher: typeof fetch) => createClinicSender(service, f.clinicId, { baseUrl: BASE_URL, fetcher });

async function outbound(appointmentId: string) {
  const { data } = await adminClient()
    .from("whatsapp_messages")
    .select("message_type, template_name, body, status, wa_message_id")
    .eq("clinic_id", f.clinicId)
    .eq("appointment_id", appointmentId)
    .eq("direction", "outbound")
    .order("created_at");
  return data ?? [];
}

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica Envio F62", "+55849912260");
  support = await createUser("f62-suporte");
  await makePlatformStaff(support.id);
  await adminClient().from("whatsapp_connections").insert({ clinic_id: f.clinicId, phone_number_id: NUMBER, waba_id: WABA, status: "connected" });
  await setWhatsappAccessToken(support.client as unknown as DbClient, f.clinicId, "token-f62");
  service = createClinicServiceClient(f.clinicId, env());
});

afterAll(async () => {
  await f.cleanup();
  await deleteUsers([support]);
});

describe("templates padrão na conta da clínica (Suporte)", () => {
  it("cria os que a conta não tem; o que já existe só tem a situação guardada", async () => {
    const meta = fakeMeta({ rc_lembrete_v1: { status: "APPROVED" } });
    const result = await createDefaultTemplates(service, f.clinicId, meta.fetcher);
    expect(result.ok && result.lines.map((l) => [l.key, l.status, l.problem])).toEqual([
      ["confirmation", "pending", null],
      ["reschedule", "pending", null],
      ["cancellation", "pending", null],
      ["clinic_cancellation", "pending", null],
      ["reminder", "approved", null],
      ["exam_preparation", "pending", null],
    ]);
    const created = meta.calls.filter((c) => c.method === "POST");
    expect(created.map((c) => c.path)).toEqual(Array(5).fill(`/${WABA}/message_templates`));
    expect(created[0].body).toMatchObject({ name: "rc_confirmacao_v1", language: "pt_BR", category: "UTILITY" });
    // Exemplo de cada variável, exigido pela Meta.
    const body = (created[0].body!.components as { type: string; example?: { body_text: string[][] } }[])[0];
    expect(body.example!.body_text[0]).toHaveLength(6);
    expect(meta.calls.every((c) => !c.path.includes("token"))).toBe(true);
  });

  it("Atualizar situação traz a aprovação e a recusa com o motivo", async () => {
    const meta = fakeMeta({
      rc_confirmacao_v1: { status: "APPROVED" },
      rc_remarcacao_v1: { status: "APPROVED" },
      rc_cancelamento_v1: { status: "APPROVED" },
      rc_cancelamento_clinica_v1: { status: "PENDING" },
      rc_lembrete_v1: { status: "APPROVED" },
      rc_preparo_exame_v1: { status: "REJECTED", reason: "INVALID_FORMAT" },
    });
    expect(await refreshTemplateStatuses(service, f.clinicId, meta.fetcher)).toMatchObject({ ok: true });
    const { data } = await adminClient().from("whatsapp_templates").select("template_key, status, rejection_reason").eq("clinic_id", f.clinicId);
    expect(Object.fromEntries((data ?? []).map((t) => [t.template_key, [t.status, t.rejection_reason]]))).toEqual({
      confirmation: ["approved", null],
      reschedule: ["approved", null],
      cancellation: ["approved", null],
      clinic_cancellation: ["pending", null],
      reminder: ["approved", null],
      exam_preparation: ["rejected", "INVALID_FORMAT"],
    });
  });

  it("o webhook guarda a situação avisada pela Meta, só nas clínicas daquela conta", async () => {
    const deps: WebhookDeps = {
      resolveClinic: (id) => resolveClinicByPhoneNumberId(id, env()),
      clientFor: (clinicId) => createClinicServiceClient(clinicId, env()),
      resolveClinicsByWaba: (waba) => resolveClinicsByWabaId(waba, env()),
    };
    const event = (waba: string) => ({
      object: "whatsapp_business_account",
      entry: [
        {
          id: waba,
          changes: [
            {
              field: "message_template_status_update",
              value: { event: "APPROVED", message_template_id: 99, message_template_name: "rc_preparo_exame_v1", message_template_language: "pt_BR", reason: "NONE" },
            },
          ],
        },
      ],
    });
    expect(await processWebhook(event("outra-waba"), deps)).toMatchObject({ templates: 0, errors: 0 });
    expect(await processWebhook(event(WABA), deps)).toMatchObject({ templates: 1, errors: 0 });
    const { data } = await adminClient()
      .from("whatsapp_templates")
      .select("status, rejection_reason, meta_template_id")
      .eq("clinic_id", f.clinicId)
      .eq("template_key", "exam_preparation")
      .single();
    expect(data).toEqual({ status: "approved", rejection_reason: null, meta_template_id: "99" });
  });
});

describe("avisos ao paciente", () => {
  it("marcado e cancelado saem pelo template aprovado, com as variáveis do atendimento", async () => {
    const meta = fakeMeta();
    const s = await sender(meta.fetcher);
    const { appointment } = await bookAppointment(
      asDb(f.reception),
      f.clinicId,
      { patientId: f.ids.p1, serviceId: f.ids.consulta, agendaId: f.ids.agendaDra, start: at(MON1, "08:00"), locationId: f.ids.office, channel: "admin", actorId: f.reception.id },
      NOW,
    );
    expect(await sendAppointmentNotice(asDb(f.reception), f.clinicId, appointment.id, "confirmation", s, NOW)).toBe("sent");
    await cancelAppointment(asDb(f.reception), f.clinicId, appointment.id, { channel: "admin", actorId: f.reception.id }, NOW);
    expect(await sendAppointmentNotice(asDb(f.reception), f.clinicId, appointment.id, "cancellation", s, NOW)).toBe("sent");

    const [confirmation, cancellation] = meta.calls.map((c) => c.body as { to: string; template: { name: string; components: { parameters: { text: string }[] }[] } });
    expect(meta.calls[0].path).toBe(`/${NUMBER}/messages`);
    expect(confirmation.to).toBe("55849912260" + "01");
    expect(confirmation.template.name).toBe("rc_confirmacao_v1");
    expect(confirmation.template.components[0].parameters.map((p) => p.text)).toEqual([
      "Resp.",
      "da Clínica Envio F62",
      "Consulta com Dra. Agenda",
      "Paciente Um",
      "segunda, 10/03 às 08:00",
      "Consultório — Rua A, 1",
    ]);
    // O cancelamento não leva o local.
    expect(cancellation.template.components[0].parameters).toHaveLength(5);

    const messages = await outbound(appointment.id);
    expect(messages.map((m) => [m.message_type, m.template_name, m.status])).toEqual([
      ["appointment_confirmation", "rc_confirmacao_v1", "sent"],
      ["appointment_cancellation", "rc_cancelamento_v1", "sent"],
    ]);
    expect(messages[0].body).toContain("Aqui é da Clínica Envio F62.\nSeu atendimento está marcado:");
    expect(messages[0].wa_message_id).toMatch(/^wamid\.f62\.\d+\.1$/);
  });

  it("\"do\" na clínica; sem template aprovado, registra \"não enviado\" sem chamar a Meta; sem conexão, nada", async () => {
    await adminClient().from("clinic_settings").update({ message_article: "do" }).eq("clinic_id", f.clinicId);
    await adminClient().from("whatsapp_templates").update({ status: "pending" }).eq("clinic_id", f.clinicId).eq("template_key", "reschedule");
    const meta = fakeMeta();
    const s = await sender(meta.fetcher);
    expect(s?.clinicLabel).toBe("do Clínica Envio F62");
    const { appointment } = await bookAppointment(
      asDb(f.reception),
      f.clinicId,
      { patientId: f.ids.p2, serviceId: f.ids.consulta, agendaId: f.ids.agendaDra2, start: at(MON1, "08:00"), locationId: f.ids.office, channel: "admin", actorId: null },
      NOW,
    );
    expect(await sendAppointmentNotice(asDb(f.reception), f.clinicId, appointment.id, "reschedule", s, NOW)).toBe("skipped_no_template");
    expect(meta.calls).toEqual([]);
    expect((await outbound(appointment.id)).map((m) => [m.message_type, m.status])).toEqual([["appointment_reschedule", "skipped_no_template"]]);

    expect(await sendAppointmentNotice(asDb(f.reception), f.clinicId, appointment.id, "confirmation", null, NOW)).toBe("not_connected");
    expect(await outbound(appointment.id)).toHaveLength(1);
    await adminClient().from("whatsapp_connections").update({ status: "pending" }).eq("clinic_id", f.clinicId);
    expect(await sender(meta.fetcher)).toBeNull();
    await adminClient().from("whatsapp_connections").update({ status: "connected" }).eq("clinic_id", f.clinicId);
    await adminClient().from("clinic_settings").update({ message_article: "da" }).eq("clinic_id", f.clinicId);
  });
});

describe("preparo do exame depois da entrega (webhook)", () => {
  it("confirmação do exame entregue: o preparo sai pelo template com o link, uma vez só", async () => {
    await adminClient().from("services").update({ preparation_instructions: "Jejum de 4 horas." }).eq("id", f.ids.exame);
    const { appointment } = await bookAppointment(
      asDb(f.reception),
      f.clinicId,
      { patientId: f.ids.p3, serviceId: f.ids.exame, agendaId: f.ids.agendaExams, start: at(MON1, "08:00"), locationId: f.ids.office, channel: "admin", actorId: null },
      NOW,
    );
    await recordOutboundMessage(service, f.clinicId, {
      phone: "+5584991226003",
      appointmentId: appointment.id,
      messageType: "appointment_confirmation",
      status: "sent",
      waMessageId: "wamid.f62.conf-exame",
    });
    const meta = fakeMeta();
    const deps: WebhookDeps = {
      resolveClinic: (id) => resolveClinicByPhoneNumberId(id, env()),
      clientFor: (clinicId) => createClinicServiceClient(clinicId, env()),
      senderFor: (clinicId) => createClinicSender(createClinicServiceClient(clinicId, env()), clinicId, { baseUrl: BASE_URL, fetcher: meta.fetcher }),
    };
    const delivered = (status: string) => ({
      entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: NUMBER }, statuses: [{ id: "wamid.f62.conf-exame", status }] } }] }],
    });

    expect(await processWebhook(delivered("delivered"), deps, NOW)).toMatchObject({ statuses: 1, preparations: 1, errors: 0 });
    expect(await processWebhook(delivered("read"), deps, NOW)).toMatchObject({ statuses: 1, preparations: 0 });

    expect(meta.calls).toHaveLength(1);
    const sent = meta.calls[0].body as { template: { name: string; components: { parameters: { text: string }[] }[] } };
    expect(sent.template.name).toBe("rc_preparo_exame_v1");
    expect(sent.template.components[0].parameters.map((p) => p.text)).toEqual([
      "Resp.",
      "da Clínica Envio F62",
      "Exame",
      `${BASE_URL}/preparo/${f.ids.exame}`,
    ]);
    expect((await outbound(appointment.id)).map((m) => [m.message_type, m.status])).toEqual([
      ["appointment_confirmation", "read"],
      ["exam_preparation", "sent"],
    ]);
  });
});

describe("cancelamento pela clínica (F6.5)", () => {
  it("cada paciente recebe o aviso com o link de remarcação; sem template aprovado, fica para a tela Avisar", async () => {
    const book = async (patientId: string, agendaId: string) =>
      (
        await bookAppointment(
          asDb(f.reception),
          f.clinicId,
          { patientId, serviceId: f.ids.consulta, agendaId, start: at(MON2, "08:00"), locationId: f.ids.office, channel: "admin", actorId: null },
          NOW,
        )
      ).appointment.id;
    const a1 = await book(f.ids.p1, f.ids.agendaDra);
    const a2 = await book(f.ids.p3, f.ids.agendaDra2);
    const canceled = await cancelByClinic(asDb(f.reception), f.clinicId, [a1, a2], f.reception.id, NOW);
    expect(canceled.every((c) => c.rebookingLink)).toBe(true);
    const items = canceled.map((c) => ({ appointmentId: c.appointment.id, rebookingLinkId: c.rebookingLink!.id }));

    // Template ainda em análise: nenhum sai, os dois vão para a tela Avisar.
    const meta = fakeMeta();
    const s = await sender(meta.fetcher);
    let notices = await notifyClinicCancellations(asDb(f.reception), f.clinicId, items, s, NOW);
    expect(notices.map((n) => n.status)).toEqual(["skipped_no_template", "skipped_no_template"]);
    expect(clinicCancellationSummary(notices)).toBe("2 atendimentos cancelados. 0 avisos enviados pelo WhatsApp; 2 não saíram: avise abaixo.");
    expect(meta.calls).toEqual([]);

    await adminClient().from("whatsapp_templates").update({ status: "approved" }).eq("clinic_id", f.clinicId).eq("template_key", "clinic_cancellation");
    notices = await notifyClinicCancellations(asDb(f.reception), f.clinicId, items, s, NOW);
    expect(clinicCancellationSummary(notices)).toBe("2 atendimentos cancelados. Todos receberam o aviso pelo WhatsApp.");
    const sent = meta.calls[0].body as { template: { name: string; components: { parameters: { text: string }[] }[] } };
    expect(sent.template.name).toBe("rc_cancelamento_clinica_v1");
    expect(sent.template.components[0].parameters.map((p) => p.text)).toEqual([
      "Resp.",
      "da Clínica Envio F62",
      "Paciente",
      "Consulta",
      "segunda, 17/03 às 08:00",
      `${BASE_URL}/agendar/${items[0].rebookingLinkId}`,
    ]);
    // As duas tentativas têm o mesmo horário (relógio do teste): procura a enviada pela situação.
    const sentMessage = (await outbound(a1)).find((m) => m.status === "sent");
    expect(sentMessage).toMatchObject({ message_type: "appointment_mass_cancellation" });
    expect(sentMessage!.body).toContain("Precisamos cancelar o atendimento de Paciente (Consulta) de segunda, 17/03 às 08:00.");
  });
});
