import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { reminderButtonPayload } from "../../src/lib/data/whatsapp/reminders";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import type { DbClient } from "../../src/lib/data/clients";
import { resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import { getConversation, setConversationClassification } from "../../src/lib/data/whatsapp/conversations";
import { countAwaitingClinic, listClassifiedConversations, listHumanAttention } from "../../src/lib/data/whatsapp/attention";
import type { ClinicSender, ListSection, ReplyButton } from "../../src/lib/data/whatsapp/send";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { asDb, at, codeOf, MON1, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { addMember, adminClient, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, type TestUser } from "./helpers";

// NA — Conversas que não são atendimento (cliente, 06/nov/2026; docs/conversas-nao-atendimento.md). NA1: a marcação no
// banco (quem marca, isolamento por clínica, trilha em handoff_events, o atendimento aberto saindo sem mensagem e o
// estado do bot zerado). Conversas pelo webhook com a Meta simulada; clínica com coexistência.

const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});

const NUMBER = "na-numero";
type Sent = { kind: "text" | "list" | "buttons"; body: string };

let f: AgendaFixture;
let other: string;
let outsider: TestUser;
let professional: TestUser;
let sent: Sent[] = [];
let seq = 0;

const sender: ClinicSender = {
  clinicId: "",
  clinicLabel: "da Clínica NA",
  baseUrl: "https://app.exemplo.test",
  template: async () => ({ sent: false, reason: "sem template no teste" }),
  text: async (_to, body) => (sent.push({ kind: "text", body }), { sent: true, messageId: `wamid.na.out.${++seq}`, body }),
  list: async (_to: string, body: string, _b: string, _s: ListSection[]) => (sent.push({ kind: "list", body }), { sent: true, messageId: `wamid.na.out.${++seq}` }),
  buttons: async (_to: string, body: string, _b: ReplyButton[]) => (sent.push({ kind: "buttons", body }), { sent: true, messageId: `wamid.na.out.${++seq}` }),
};

const deps = (): WebhookDeps => ({
  resolveClinic: (id) => resolveClinicByPhoneNumberId(id, env()),
  clientFor: (clinicId) => createClinicServiceClient(clinicId, env()),
  senderFor: async () => sender,
});

async function webhook(value: Record<string, unknown>) {
  const summary = await processWebhook({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: NUMBER }, ...value } }] }] }, deps(), new Date());
  expect(summary.errors).toBe(0);
  return summary;
}

async function say(phone: string, input: string | { id: string } | { payload: string }): Promise<string[]> {
  sent = [];
  const from = phone.slice(1);
  const id = `wamid.na.in.${++seq}`;
  const message =
    typeof input === "string"
      ? { id, from, type: "text", text: { body: input } }
      : "payload" in input
        ? { id, from, type: "button", button: { payload: input.payload, text: "botão" } }
        : { id, from, type: "interactive", interactive: { list_reply: { id: input.id, title: "" } } };
  await webhook({ messages: [message] });
  return sent.map((m) => m.body);
}

const agentReply = (phone: string, body: string) =>
  webhook({ message_echoes: [{ id: `wamid.na.echo.${++seq}`, from: "5584000000000", to: phone.slice(1), type: "text", text: { body } }] });

const reception = () => asDb(f.reception);
const admin = () => asDb(f.admin);

async function conversation(phone: string) {
  const { data } = await adminClient()
    .from("conversation_state")
    .select("state, context, human_handoff, handoff_status, assigned_to, funnel_session_id, classification, classified_at, classified_by")
    .eq("clinic_id", f.clinicId)
    .eq("contact_phone", phone)
    .single();
  return data!;
}

async function events(phone: string) {
  const { data } = await adminClient()
    .from("handoff_events")
    .select("kind, from_status, to_status, origin, actor_id, classification_from, classification_to")
    .eq("clinic_id", f.clinicId)
    .eq("contact_phone", phone)
    .order("id");
  return data!;
}

async function messageCount(phone: string) {
  const { count } = await adminClient().from("whatsapp_messages").select("id", { count: "exact", head: true }).eq("clinic_id", f.clinicId).eq("contact_phone", phone);
  return count ?? 0;
}

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica NA", "+55849912440", { oneBotProfessional: true });
  await adminClient().from("whatsapp_connections").insert({ clinic_id: f.clinicId, phone_number_id: NUMBER, waba_id: "na-waba", status: "connected", coexistence: true });
  other = await createClinic("Outra clínica (NA)");
  outsider = await createUser("na-fora");
  await addMember(other, outsider.id, ["admin", "reception"]);
  professional = await createUser("na-profissional");
  await addMember(f.clinicId, professional.id, ["professional"]);
});

afterAll(async () => {
  await f.cleanup();
  await deleteClinics([other]);
  await deleteUsers([outsider, professional]);
});

describe("NA1: marcar a conversa como não atendimento", () => {
  const P = "+5584991244001";
  const Q = "+5584991244002";

  it("a conversa nasce como atendimento", async () => {
    await say(P, "Oi");
    expect(await conversation(P)).toMatchObject({ classification: "patient", classified_at: null, classified_by: null });
  });

  it("perfil: o Profissional não marca; a Recepção e o Administrador marcam", async () => {
    expect(await codeOf(() => setConversationClassification(asDb(professional), f.clinicId, P, "personal"))).toBe("forbidden");
    expect((await conversation(P)).classification).toBe("patient");
    expect(await setConversationClassification(reception(), f.clinicId, P, "personal")).toBe(true);
    expect(await conversation(P)).toMatchObject({ classification: "personal", classified_by: f.reception.id });
    expect(await setConversationClassification(admin(), f.clinicId, P, "administrative")).toBe(true);
    expect(await conversation(P)).toMatchObject({ classification: "administrative", classified_by: f.admin.id });
  });

  it("clínica: quem é de outra clínica não marca, nem conhecendo o número", async () => {
    expect(await codeOf(() => setConversationClassification(asDb(outsider), f.clinicId, P, "patient"))).toBe("forbidden");
    expect((await conversation(P)).classification).toBe("administrative");
    // A mesma função na clínica dele não acha a conversa desta.
    expect(await codeOf(() => setConversationClassification(asDb(outsider), other, P, "personal"))).not.toBe("ok");
  });

  it("valor inválido é recusado; repetir a mesma marcação não muda nada nem registra de novo", async () => {
    expect(await codeOf(() => setConversationClassification(reception(), f.clinicId, P, "spam" as never))).toBe("invalid");
    const count = (await events(P)).length;
    expect(await setConversationClassification(reception(), f.clinicId, P, "administrative")).toBe(false);
    expect((await events(P)).length).toBe(count);
  });

  it("auditoria: cada troca vira um evento classified com de/para, quem e quando", async () => {
    const trail = (await events(P)).filter((e) => e.kind === "classified");
    expect(trail).toEqual([
      expect.objectContaining({ classification_from: "patient", classification_to: "personal", actor_id: f.reception.id, origin: "reception" }),
      expect.objectContaining({ classification_from: "personal", classification_to: "administrative", actor_id: f.admin.id, origin: "reception" }),
    ]);
  });

  it("a credencial do bot (e o login direto) não muda a classificação sem a função", async () => {
    const { error } = await clinicServiceClient(f.clinicId).from("conversation_state").update({ classification: "patient" }).eq("clinic_id", f.clinicId).eq("contact_phone", P);
    expect(error?.code).toBe("42501");
    const direct = await f.reception.client.from("conversation_state").update({ classification: "patient" }).eq("clinic_id", f.clinicId).eq("contact_phone", P).select("id");
    expect(direct.error ?? direct.data?.length === 0).toBeTruthy();
    expect((await conversation(P)).classification).toBe("administrative");
  });

  it("voltar para atendimento: estado inicial, sem mensagem; o evento registra a volta", async () => {
    const before = await messageCount(P);
    sent = [];
    expect(await setConversationClassification(reception(), f.clinicId, P, "patient")).toBe(true);
    expect(sent).toEqual([]);
    expect(await messageCount(P)).toBe(before);
    expect(await conversation(P)).toMatchObject({ classification: "patient", state: "WELCOME", human_handoff: false });
    expect((await events(P)).at(-1)).toMatchObject({ kind: "classified", classification_from: "administrative", classification_to: "patient" });
    const conv = await getConversation(createClinicServiceClient(f.clinicId, env()) as unknown as DbClient, f.clinicId, P);
    expect(conv?.classification).toBe("patient");
  });

  it("atendimento aberto na hora da marcação sai de Aguardando/Em atendimento sem mensagem e sem o 'finalizado'", async () => {
    await say(Q, "Oi");
    await say(Q, "4"); // Falar com a recepção
    await agentReply(Q, "Oi, sou eu, da recepção");
    expect(await conversation(Q)).toMatchObject({ human_handoff: true, handoff_status: "in_progress" });
    const before = await messageCount(Q);
    const count = (await events(Q)).length;
    sent = [];
    expect(await setConversationClassification(reception(), f.clinicId, Q, "personal")).toBe(true);
    expect(sent).toEqual([]);
    expect(await messageCount(Q)).toBe(before);
    expect(await conversation(Q)).toMatchObject({ human_handoff: false, handoff_status: null, assigned_to: null, state: "WELCOME", context: {} });
    const added = (await events(Q)).slice(count);
    expect(added).toEqual([expect.objectContaining({ kind: "classified", from_status: "in_progress", to_status: "bot", classification_to: "personal" })]);
  });

  it("marcar no meio de um fluxo do bot fecha a tentativa do funil como classified", async () => {
    await setConversationClassification(reception(), f.clinicId, Q, "patient");
    await say(Q, "Oi");
    await say(Q, "1"); // Consultas: abre uma tentativa
    await say(Q, "1");
    const session = (await conversation(Q)).funnel_session_id;
    expect(session).not.toBeNull();
    await setConversationClassification(reception(), f.clinicId, Q, "administrative");
    expect((await conversation(Q)).funnel_session_id).toBeNull();
    const { data } = await adminClient().from("bot_funnel_events").select("step, metadata").eq("clinic_id", f.clinicId).eq("session_id", session!).order("id");
    expect(data!.at(-1)).toMatchObject({ step: "abandoned", metadata: expect.objectContaining({ reason: "classified" }) });
  });

  it("conversa que não existe: erro, nada criado", async () => {
    expect(await codeOf(() => setConversationClassification(reception(), f.clinicId, "+5584991244099", "personal"))).not.toBe("ok");
    const { count } = await adminClient().from("conversation_state").select("id", { count: "exact", head: true }).eq("clinic_id", f.clinicId).eq("contact_phone", "+5584991244099");
    expect(count).toBe(0);
  });
});

describe("NA2: bot e webhook no número marcado", () => {
  const P = "+5584991244003";
  const R = "+5584991244001"; // contato do Paciente Um (tem consulta marcada)
  let consult: string;

  const lastMessage = async (phone: string) => {
    const { data } = await adminClient()
      .from("whatsapp_messages")
      .select("direction, message_type")
      .eq("clinic_id", f.clinicId)
      .eq("contact_phone", phone)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    return data!;
  };
  const handoffFunnel = async (phone: string) => {
    const { count } = await adminClient().from("bot_funnel_events").select("id", { count: "exact", head: true }).eq("clinic_id", f.clinicId).eq("contact_phone", phone).eq("flow", "handoff");
    return count ?? 0;
  };

  beforeAll(async () => {
    consult = (
      await bookAppointment(asDb(f.reception), f.clinicId, { patientId: f.ids.p1, serviceId: f.ids.consulta, agendaId: f.ids.agendaDra, start: at(MON1, "08:00"), locationId: f.ids.office, channel: "admin", actorId: null }, NOW)
    ).appointment.id;
    await adminClient().from("appointments").update({ reminder_sent_at: new Date().toISOString() }).eq("id", consult);
  });

  it("calado: o bot não responde ao número marcado; a mensagem fica no histórico e não abre atendimento", async () => {
    await say(P, "Oi");
    await setConversationClassification(reception(), f.clinicId, P, "personal");
    const before = await messageCount(P);
    expect(await say(P, "Oi, chego às 19h")).toEqual([]);
    expect(await say(P, "4")).toEqual([]); // "Falar com a recepção" do menu: nada
    expect(await say(P, "quero falar com a atendente")).toEqual([]);
    expect(await messageCount(P)).toBe(before + 3);
    expect(await lastMessage(P)).toMatchObject({ direction: "inbound" });
    expect(await conversation(P)).toMatchObject({ human_handoff: false, handoff_status: null, state: "WELCOME", classification: "personal" });
  });

  it("eco: a resposta da equipe pelo app fica no histórico, não pausa, não abre atendimento nem conta no funil", async () => {
    const before = await messageCount(P);
    const funnel = await handoffFunnel(P);
    await agentReply(P, "Combinado, deixo a chave");
    expect(await messageCount(P)).toBe(before + 1);
    expect(await lastMessage(P)).toMatchObject({ direction: "outbound", message_type: "agent_reply" });
    expect(await conversation(P)).toMatchObject({ human_handoff: false, handoff_status: null });
    expect(await handoffFunnel(P)).toBe(funnel);
    // "#bot" no número marcado também não muda nada (a volta é pela tela).
    await agentReply(P, "#bot");
    expect((await conversation(P)).classification).toBe("personal");
  });

  it("lembrete: Confirmar e Cancelar do lembrete seguem valendo no número marcado, com o caminho que abrem", async () => {
    await say(R, "Oi");
    await setConversationClassification(reception(), f.clinicId, R, "administrative");
    let reply = await say(R, { payload: reminderButtonPayload("confirm", consult) });
    expect(reply[0]).toContain("Presença confirmada ✓");
    await adminClient().from("appointments").update({ patient_confirmed_at: null }).eq("id", consult);
    reply = await say(R, { payload: reminderButtonPayload("cancel", consult) });
    expect(reply[0]).toContain("Confirma o cancelamento da consulta de *Paciente Um*");
    reply = await say(R, "não");
    expect(reply[0]).toBe("Ok, mantivemos sua consulta marcada.\n\nDeseja confirmar sua presença?");
    reply = await say(R, { id: "yes" });
    expect(reply[0]).toContain("Presença confirmada ✓");
    // Fim do caminho do lembrete: o resto volta a ficar sem bot.
    expect(await say(R, "Oi")).toEqual([]);
    expect(await conversation(R)).toMatchObject({ human_handoff: false, classification: "administrative" });
  });

  it("\"Voltar ao menu\" no caminho do lembrete, num número marcado: sem menu, o caminho fecha", async () => {
    await adminClient().from("appointments").update({ patient_confirmed_at: null }).eq("id", consult);
    await say(R, { payload: reminderButtonPayload("cancel", consult) });
    expect(await say(R, "0")).toEqual([]);
    expect((await conversation(R)).state).toBe("WELCOME");
  });

  it("reativação: de volta para atendimento, a próxima mensagem é do bot (do começo), sem mensagem na hora", async () => {
    sent = [];
    await setConversationClassification(reception(), f.clinicId, P, "patient");
    expect(sent).toEqual([]);
    const reply = await say(P, "Oi");
    expect(reply[0]).toMatch(/^Olá(, [^!]+)?! 👋/);
    await say(P, "4");
    expect(await conversation(P)).toMatchObject({ human_handoff: true, handoff_status: "waiting_clinic" });
    // E o eco volta a pausar como sempre.
    await agentReply(P, "Oi, aqui é a recepção");
    expect((await conversation(P)).handoff_status).toBe("in_progress");
  });
});

describe("NA3: métricas e contadores", () => {
  const A = "+5584991244011"; // vai ser marcado
  const B = "+5584991244012"; // segue como atendimento (operacional)

  const sessions = async () => {
    const { data, error } = await f.admin.client.rpc("metrics_bot_sessions", {
      p_clinic_id: f.clinicId,
      p_start: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
      p_end: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(error).toBeNull();
    return (data ?? []) as { session_id: string; flow: string; contact_phone: string }[];
  };
  const of = (rows: { contact_phone: string; flow: string }[], phone: string) => rows.filter((r) => r.contact_phone === phone).map((r) => r.flow).sort();

  beforeAll(async () => {
    for (const phone of [A, B]) {
      await say(phone, "Oi");
      await say(phone, "1");
      await say(phone, "1"); // tentativa de marcar
      await say(phone, "0");
      await say(phone, "4"); // pedido de recepção (aguardando a clínica)
    }
  });

  it("antes da marcação, os dois números contam", async () => {
    const rows = await sessions();
    expect(of(rows, A).length).toBeGreaterThan(0);
    expect(of(rows, A)).toEqual(of(rows, B));
    expect((await listHumanAttention(reception(), f.clinicId)).map((i) => i.phone)).toEqual(expect.arrayContaining([A, B]));
  });

  it("marcado: o número inteiro sai das métricas (inclusive o passado) e dos pendentes; o outro número fica igual", async () => {
    const before = await sessions();
    const waitingBefore = await countAwaitingClinic(reception(), f.clinicId);
    await setConversationClassification(reception(), f.clinicId, A, "administrative");
    const after = await sessions();
    expect(of(after, A)).toEqual([]);
    // Os números de atendimento ficam exatamente como antes.
    const others = (rows: typeof before) => rows.filter((r) => r.contact_phone !== A).map((r) => r.session_id).sort();
    expect(others(after)).toEqual(others(before));
    expect(await countAwaitingClinic(reception(), f.clinicId)).toBe(waitingBefore - 1);
    expect((await listHumanAttention(reception(), f.clinicId)).map((i) => i.phone)).not.toContain(A);
    expect((await listHumanAttention(reception(), f.clinicId)).map((i) => i.phone)).toContain(B);
  });

  it("de volta para atendimento: o passado volta a contar", async () => {
    await setConversationClassification(reception(), f.clinicId, A, "patient");
    const rows = await sessions();
    expect(of(rows, A)).toEqual(of(rows, B));
  });
});

describe("NA5: aba Pessoal e administrativo do Atendimento (sem a Central)", () => {
  const S = "+5584991244021";

  it("lista o número marcado com o tipo, quem marcou e o aviso de mensagem nova, que some com a resposta da clínica", async () => {
    await say(S, "Oi");
    await setConversationClassification(reception(), f.clinicId, S, "administrative");
    let item = (await listClassifiedConversations(reception(), f.clinicId)).find((i) => i.phone === S)!;
    expect(item).toMatchObject({ classification: "administrative", classifiedBy: f.reception.id });
    await say(S, "Segue o boleto");
    item = (await listClassifiedConversations(reception(), f.clinicId)).find((i) => i.phone === S)!;
    expect(item.hasNew).toBe(true);
    expect(item.lastMessageAt).toBeInstanceOf(Date);
    await agentReply(S, "Recebido, obrigada");
    item = (await listClassifiedConversations(reception(), f.clinicId)).find((i) => i.phone === S)!;
    expect(item.hasNew).toBe(false);
    // Fora do Aguardando/Em atendimento.
    expect((await listHumanAttention(reception(), f.clinicId)).map((i) => i.phone)).not.toContain(S);
  });

  it("de volta para atendimento: sai da lista", async () => {
    await setConversationClassification(reception(), f.clinicId, S, "patient");
    expect((await listClassifiedConversations(reception(), f.clinicId)).map((i) => i.phone)).not.toContain(S);
  });
});
