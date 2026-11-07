import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import type { DbClient } from "../../src/lib/data/clients";
import { resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import { getConversation, setConversationClassification } from "../../src/lib/data/whatsapp/conversations";
import type { ClinicSender, ListSection, ReplyButton } from "../../src/lib/data/whatsapp/send";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
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

async function say(phone: string, input: string | { id: string }): Promise<string[]> {
  sent = [];
  const from = phone.slice(1);
  const id = `wamid.na.in.${++seq}`;
  const message = typeof input === "string" ? { id, from, type: "text", text: { body: input } } : { id, from, type: "interactive", interactive: { list_reply: { id: input.id, title: "" } } };
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
  f = await setupAgendaClinic("Clínica NA", "+55849912440");
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
