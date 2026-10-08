import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment, cancelAppointment } from "../../src/lib/data/agenda/appointments";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import type { DbClient } from "../../src/lib/data/clients";
import { resolveClinicByPhoneNumberId, resolveClinicsByWabaId } from "../../src/lib/data/platform";
import { setWhatsappAccessToken } from "../../src/lib/data/whatsapp/connection";
import { recordOutboundMessage } from "../../src/lib/data/whatsapp/messages";
import { clinicCancellationSummary, notifyClinicCancellations, sendAppointmentNotice } from "../../src/lib/data/whatsapp/notices";
import { cancelByClinic } from "../../src/lib/data/agenda/blocks";
import { listGuidanceResendable, resendGuidance } from "../../src/lib/data/whatsapp/guidance";
import { createClinicSender, guidanceSender } from "../../src/lib/data/whatsapp/send";
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
      // Orientações gerais da consulta (08/out).
      ["consultation_guidance", "pending", null],
      // F7: resumo do dia e oferta de vaga.
      ["daily_summary_consultations", "pending", null],
      ["daily_summary_consultations_today", "pending", null],
      ["daily_summary_exams", "pending", null],
      ["daily_summary_exams_today", "pending", null],
      ["waitlist_offer", "pending", null],
    ]);
    const created = meta.calls.filter((c) => c.method === "POST");
    expect(created.map((c) => c.path)).toEqual(Array(11).fill(`/${WABA}/message_templates`));
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
      rc_preparo_exame_v2: { status: "REJECTED", reason: "INVALID_FORMAT" },
    });
    expect(await refreshTemplateStatuses(service, f.clinicId, meta.fetcher)).toMatchObject({ ok: true });
    const { data } = await adminClient()
      .from("whatsapp_templates")
      .select("template_key, status, rejection_reason")
      .eq("clinic_id", f.clinicId)
      .not("template_key", "like", "daily_summary%")
      .neq("template_key", "waitlist_offer");
    expect(Object.fromEntries((data ?? []).map((t) => [t.template_key, [t.status, t.rejection_reason]]))).toEqual({
      confirmation: ["approved", null],
      reschedule: ["approved", null],
      cancellation: ["approved", null],
      clinic_cancellation: ["pending", null],
      reminder: ["approved", null],
      exam_preparation: ["rejected", "INVALID_FORMAT"],
      consultation_guidance: ["pending", null],
    });
  });

  it("Meta diz que já existe (criado antes, resposta perdida): guarda a situação dele e a mensagem sai em português", async () => {
    await adminClient().from("whatsapp_templates").delete().eq("clinic_id", f.clinicId).eq("template_key", "daily_summary_exams");
    let created = false;
    const meta: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const name = url.searchParams.get("name");
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { name: string };
        if (body.name === "rc_resumo_exames_amanha_v1") {
          created = true;
          return new Response(
            JSON.stringify({
              error: { message: "Invalid parameter", code: 100, error_subcode: 2388024, error_user_title: "Já existe conteúdo nesse idioma", error_user_msg: "Já existe conteúdo em Portuguese (BR) para esse modelo." },
            }),
            { status: 400 },
          );
        }
        return new Response(JSON.stringify({ error: { message: "Invalid parameter", code: 100, error_user_msg: "Texto recusado." } }), { status: 400 });
      }
      // A listagem só "enxerga" o template depois da tentativa de criação (atraso da Meta).
      // Só este template é "encontrado"; os outros dão erro na criação e ficam como estão no banco.
      const visible = name === "rc_resumo_exames_amanha_v1" && created;
      const data = visible ? [{ id: "tpl-x", name, language: "pt_BR", status: "PENDING" }] : [];
      return new Response(JSON.stringify({ data }));
    };
    const result = await createDefaultTemplates(service, f.clinicId, meta);
    const line = result.ok ? result.lines.find((l) => l.key === "daily_summary_exams") : null;
    expect(line).toMatchObject({ status: "pending", problem: null });
    // O erro de outro template sai com a explicação da Meta, não "Invalid parameter".
    expect(result.ok && result.lines.find((l) => l.key === "confirmation")!.problem).toBe("Texto recusado.");
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
              value: { event: "APPROVED", message_template_id: 99, message_template_name: "rc_preparo_exame_v2", message_template_language: "pt_BR", reason: "NONE" },
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
    // Um minuto depois: a ordem das mensagens sai do horário de cada uma.
    expect(await sendAppointmentNotice(asDb(f.reception), f.clinicId, appointment.id, "cancellation", s, new Date(NOW.getTime() + 60_000))).toBe("sent");

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
    expect(sent.template.name).toBe("rc_preparo_exame_v2");
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

describe("orientações gerais da consulta depois da entrega (08/out)", () => {
  it("com o envio ligado: sai uma vez pelo template com o link; desligado, nada; sem template, reenviar", async () => {
    await adminClient().from("bot_messages").insert({ clinic_id: f.clinicId, message_key: "consultation_guidance", body: "Chegue 15 minutos antes." });
    await adminClient().from("whatsapp_templates").update({ status: "approved" }).eq("clinic_id", f.clinicId).eq("template_key", "consultation_guidance");
    const book = async (time: string) =>
      (
        await bookAppointment(
          asDb(f.reception),
          f.clinicId,
          { patientId: f.ids.p1, serviceId: f.ids.consulta, agendaId: f.ids.agendaDra, start: at(MON2, time), locationId: f.ids.office, channel: "admin", actorId: null },
          NOW,
        )
      ).appointment.id;
    const cancel = (id: string) => cancelAppointment(service, f.clinicId, id, { channel: "admin", actorId: null }, NOW);
    const meta = fakeMeta();
    const deps: WebhookDeps = {
      resolveClinic: (id) => resolveClinicByPhoneNumberId(id, env()),
      clientFor: (clinicId) => createClinicServiceClient(clinicId, env()),
      senderFor: (clinicId) => createClinicSender(createClinicServiceClient(clinicId, env()), clinicId, { baseUrl: BASE_URL, fetcher: meta.fetcher }),
    };
    const status = (wamid: string, value: string) =>
      processWebhook({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: NUMBER }, statuses: [{ id: wamid, status: value }] } }] }] }, deps, NOW);
    const confirmationDelivered = async (appointmentId: string, wamid: string) => {
      await recordOutboundMessage(service, f.clinicId, { phone: "+5584991226001", appointmentId, messageType: "appointment_confirmation", status: "sent", waMessageId: wamid });
      return status(wamid, "delivered");
    };

    // Envio desligado (padrão): nada sai.
    const first = await book("10:00");
    expect(await confirmationDelivered(first, "wamid.f62.conf-guia-1")).toMatchObject({ errors: 0 });
    expect(meta.calls).toEqual([]);
    await cancel(first);

    await adminClient().from("clinic_settings").update({ guidance_enabled: true }).eq("clinic_id", f.clinicId);
    const consult = await book("10:30");
    expect(await confirmationDelivered(consult, "wamid.f62.conf-guia-2")).toMatchObject({ errors: 0 });
    await status("wamid.f62.conf-guia-2", "read");
    expect(meta.calls).toHaveLength(1);
    const sent = meta.calls[0].body as { template: { name: string; components: { parameters: { text: string }[] }[] } };
    expect(sent.template.name).toBe("rc_orientacoes_consulta_v1");
    expect(sent.template.components[0].parameters.map((p) => p.text)).toEqual(["Resp.", "da Clínica Envio F62", "Paciente Um", `${BASE_URL}/orientacoes/${f.clinicId}`]);
    expect((await outbound(consult)).map((m) => [m.message_type, m.status])).toEqual([
      ["appointment_confirmation", "read"],
      ["consultation_guidance", "sent"],
    ]);
    await cancel(consult);

    // Sem o template aprovado: fica com "Reenviar orientações".
    await adminClient().from("whatsapp_templates").update({ status: "pending" }).eq("clinic_id", f.clinicId).eq("template_key", "consultation_guidance");
    const pending = await book("11:30");
    await confirmationDelivered(pending, "wamid.f62.conf-guia-3");
    expect((await outbound(pending)).at(-1)).toMatchObject({ message_type: "consultation_guidance", status: "skipped_no_template" });
    expect(await listGuidanceResendable(asDb(f.reception), f.clinicId, [pending])).toEqual(new Set([pending]));

    await adminClient().from("whatsapp_templates").update({ status: "approved" }).eq("clinic_id", f.clinicId).eq("template_key", "consultation_guidance");
    // Um minuto depois: a tentativa nova é a mais recente.
    const later = new Date(NOW.getTime() + 60_000);
    const resend = async () => resendGuidance(asDb(f.reception), f.clinicId, pending, f.reception.id, guidanceSender((await sender(meta.fetcher))!), later);
    expect(await resend()).toBe("sent");
    expect(await listGuidanceResendable(asDb(f.reception), f.clinicId, [pending])).toEqual(new Set());
    expect(await resend()).toBe("not_eligible");
    await cancel(pending);
    await adminClient().from("clinic_settings").update({ guidance_enabled: false }).eq("clinic_id", f.clinicId);
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
