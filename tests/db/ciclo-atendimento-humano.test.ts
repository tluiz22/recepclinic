import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import type { DbClient } from "../../src/lib/data/clients";
import { resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import { finishAttendance, listHumanAttention } from "../../src/lib/data/whatsapp/attention";
import { getConversation, returnToBot } from "../../src/lib/data/whatsapp/conversations";
import { returnDueConversations } from "../../src/lib/data/whatsapp/handoffReturn";
import type { ClinicSender, ListSection, ReplyButton } from "../../src/lib/data/whatsapp/send";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { asDb, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { addMember, adminClient, createClinic, createUser, deleteClinics, deleteUsers, type TestUser } from "./helpers";

// CA — Ciclo de vida do atendimento humano (cliente, 04/nov/2026; docs/arquivo/modulos/ciclo-atendimento-humano.md): situação
// guardada (Aguardando a clínica, Em atendimento), "Finalizar atendimento" pela tela, reativação silenciosa do bot,
// encerramento automático em 12 h e os eventos em handoff_events.
// Conversas pelo webhook com a Meta simulada; clínica com coexistência.

const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});

const NUMBER = "ca-numero";
const HOUR = 60 * 60_000;
type Sent = { kind: "text" | "list" | "buttons"; body: string };

let f: AgendaFixture;
let other: string;
let outsider: TestUser;
let sent: Sent[] = [];
let seq = 0;

const sender: ClinicSender = {
  clinicId: "",
  clinicLabel: "da Clínica Ciclo",
  baseUrl: "https://app.exemplo.test",
  template: async () => ({ sent: false, reason: "sem template no teste" }),
  text: async (_to, body) => (sent.push({ kind: "text", body }), { sent: true, messageId: `wamid.ca.out.${++seq}`, body }),
  list: async (_to: string, body: string, _b: string, _s: ListSection[]) => (sent.push({ kind: "list", body }), { sent: true, messageId: `wamid.ca.out.${++seq}` }),
  buttons: async (_to: string, body: string, _b: ReplyButton[]) => (sent.push({ kind: "buttons", body }), { sent: true, messageId: `wamid.ca.out.${++seq}` }),
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

/** O paciente escreve ou toca numa opção; devolve o que o bot respondeu. `id` repete uma mensagem (Meta reenviando). */
async function say(phone: string, input: string | { id: string }, id = `wamid.ca.in.${++seq}`): Promise<string[]> {
  sent = [];
  const from = phone.slice(1);
  const message = typeof input === "string" ? { id, from, type: "text", text: { body: input } } : { id, from, type: "interactive", interactive: { list_reply: { id: input.id, title: "" } } };
  await webhook({ messages: [message] });
  return sent.map((m) => m.body);
}

/** A recepção responde pelo app (eco). */
const agentReply = (phone: string, body: string, id = `wamid.ca.echo.${++seq}`) =>
  webhook({ message_echoes: [{ id, from: "5584000000000", to: phone.slice(1), type: "text", text: { body } }] });

/** "Oi" › "Falar com a recepção": transfere direto (cliente, 06/nov/2026). */
async function askReception(phone: string) {
  await say(phone, "Oi");
  await say(phone, "4");
}

const reception = () => asDb(f.reception);
const bot = () => createClinicServiceClient(f.clinicId, env()) as unknown as DbClient;

async function conversation(phone: string) {
  const { data } = await adminClient()
    .from("conversation_state")
    .select("state, human_handoff, handoff_status, handoff_status_at, handoff_id")
    .eq("clinic_id", f.clinicId)
    .eq("contact_phone", phone)
    .single();
  return data!;
}

async function events(phone: string) {
  const { data } = await adminClient()
    .from("handoff_events")
    .select("from_status, to_status, origin, actor_id, handoff_id")
    .eq("clinic_id", f.clinicId)
    .eq("contact_phone", phone)
    .order("id");
  return data!;
}

const transitions = async (phone: string) => (await events(phone)).map((e) => `${e.from_status}>${e.to_status}:${e.origin}`);

async function messageCount(phone: string) {
  const { count } = await adminClient().from("whatsapp_messages").select("id", { count: "exact", head: true }).eq("clinic_id", f.clinicId).eq("contact_phone", phone);
  return count ?? 0;
}

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica Ciclo", "+55849912330", { oneBotProfessional: true });
  await adminClient().from("whatsapp_connections").insert({ clinic_id: f.clinicId, phone_number_id: NUMBER, waba_id: "ca-waba", status: "connected", coexistence: true });
  other = await createClinic("Outra clínica (ciclo)");
  outsider = await createUser("ca-fora");
  await addMember(other, outsider.id, ["admin"]);
});

afterAll(async () => {
  await f.cleanup();
  await deleteClinics([other]);
  await deleteUsers([outsider]);
});

describe("ciclo do atendimento humano (CA)", () => {
  const P = "+5584991233001";

  it("1. o pedido de atendimento humano desliga o bot: Aguardando a clínica; o bot não responde", async () => {
    await askReception(P);
    expect(await conversation(P)).toMatchObject({ human_handoff: true, handoff_status: "waiting_clinic" });
    // A primeira mensagem é o assunto (jornada E4), com o agradecimento de sempre; depois, o bot fica calado.
    expect(await say(P, "Quero remarcar a consulta de amanhã")).toEqual([]);
    expect(await say(P, "É urgente")).toEqual([]);
    expect(await transitions(P)).toEqual(["bot>waiting_clinic:patient"]);
  });

  it("2. a recepção responde pelo app: Em atendimento, a mensagem fica no histórico e o bot segue desligado", async () => {
    const before = await messageCount(P);
    await agentReply(P, "Oi! Vou ver um horário para você.");
    expect(await conversation(P)).toMatchObject({ human_handoff: true, handoff_status: "in_progress" });
    expect(await messageCount(P)).toBe(before + 1);
    expect(await transitions(P)).toEqual(["bot>waiting_clinic:patient", "waiting_clinic>in_progress:reception"]);
    // Segunda resposta da recepção: nada muda.
    await agentReply(P, "Um instante.");
    expect((await transitions(P)).length).toBe(2);
  });

  it("5 e 6. \"Obrigado!\" e \"Ok\" em atendimento não mudam a situação nem acordam o bot", async () => {
    expect(await say(P, "Obrigado!")).toEqual([]);
    expect(await say(P, "Ok")).toEqual([]);
    expect(await conversation(P)).toMatchObject({ human_handoff: true, handoff_status: "in_progress" });
    expect((await transitions(P)).length).toBe(2);
  });

  it("4 e 18. o paciente escreve de novo: volta para Aguardando a clínica, sem o bot; a mesma mensagem reenviada pela Meta não muda nada", async () => {
    const id = `wamid.ca.in.dup.${Date.now()}`;
    expect(await say(P, "Segue o pedido médico", id)).toEqual([]);
    expect(await conversation(P)).toMatchObject({ human_handoff: true, handoff_status: "waiting_clinic" });
    expect((await transitions(P)).at(-1)).toBe("in_progress>waiting_clinic:patient");
    // A recepção responde e a Meta reenvia a mensagem antiga: repetida, não reabre.
    await agentReply(P, "Recebido!");
    const count = (await transitions(P)).length;
    expect(await say(P, "Segue o pedido médico", id)).toEqual([]);
    expect(await conversation(P)).toMatchObject({ handoff_status: "in_progress" });
    expect((await transitions(P)).length).toBe(count);
    // Eco repetido da recepção também não muda nada.
    const echo = `wamid.ca.echo.dup.${Date.now()}`;
    await say(P, "Mais uma dúvida");
    await agentReply(P, "Pode falar.", echo);
    const afterEcho = await transitions(P);
    await say(P, "Obrigada");
    await agentReply(P, "Pode falar.", echo);
    expect(await transitions(P)).toEqual(afterEcho);
  });

  it("7, 8, 9, 11 e 16. Finalizar atendimento: o bot volta na hora, sem mensagem nem menu; histórico guardado; repetir não muda nada", async () => {
    const before = await messageCount(P);
    const handoffId = (await conversation(P)).handoff_id;
    sent = [];
    expect(await finishAttendance(reception(), f.clinicId, P)).toBe("finished");
    expect(sent).toEqual([]);
    expect(await conversation(P)).toMatchObject({ human_handoff: false, handoff_status: null, state: "WELCOME" });
    expect(await messageCount(P)).toBe(before);
    expect((await events(P)).at(-1)).toMatchObject({ to_status: "bot", origin: "reception", actor_id: f.reception.id, handoff_id: handoffId });
    const count = (await events(P)).length;
    expect(await finishAttendance(reception(), f.clinicId, P)).toBe("already");
    expect((await events(P)).length).toBe(count);
    expect(await messageCount(P)).toBe(before);
    expect(await listHumanAttention(reception(), f.clinicId, P)).toEqual([]);
  });

  it("10. a próxima mensagem depois de finalizar é do bot", async () => {
    const reply = await say(P, "Oi");
    expect(reply[0]).toMatch(/^Olá, Resp\.! 👋 Seja bem-vindo\(a\)!/);
    expect(await conversation(P)).toMatchObject({ human_handoff: false });
  });

  it("um atendimento novo tem id próprio", async () => {
    await say(P, "4");
    const ids = new Set((await events(P)).map((e) => e.handoff_id));
    expect(ids.size).toBe(2);
    await finishAttendance(reception(), f.clinicId, P);
  });

  it("finalizar com a tela desatualizada: o paciente escreveu depois, a recepção confere antes", async () => {
    const phone = "+5584991233002";
    await askReception(phone);
    await agentReply(phone, "Oi! Já vejo.");
    const [shown] = await listHumanAttention(reception(), f.clinicId, phone);
    await say(phone, "E o exame de sangue?");
    expect(await finishAttendance(reception(), f.clinicId, phone, { seenStatusAt: shown.statusAt })).toBe("patient_wrote");
    expect(await conversation(phone)).toMatchObject({ human_handoff: true, handoff_status: "waiting_clinic" });
    // Com a tela em dia, finaliza.
    const [fresh] = await listHumanAttention(reception(), f.clinicId, phone);
    expect(await finishAttendance(reception(), f.clinicId, phone, { seenStatusAt: fresh.statusAt })).toBe("finished");
  });

  it("hora da situação com microssegundos (gravada pelo banco): finaliza com a tela em dia (cliente, 06/nov/2026)", async () => {
    const phone = "+5584991233003";
    await askReception(phone);
    await say(phone, "Mais uma dúvida");
    // A tela lê milissegundos; o banco guardava microssegundos e a igualdade nunca batia.
    const { error } = await adminClient()
      .from("conversation_state")
      .update({ handoff_status_at: "2026-11-06T12:00:00.123456Z" })
      .eq("clinic_id", f.clinicId)
      .eq("contact_phone", phone);
    expect(error).toBeNull();
    const [shown] = await listHumanAttention(reception(), f.clinicId, phone);
    expect(shown.statusAt.toISOString()).toBe("2026-11-06T12:00:00.123Z");
    expect(await finishAttendance(reception(), f.clinicId, phone, { seenStatusAt: shown.statusAt })).toBe("finished");
  });

  it("#bot no app finaliza pela recepção, sem mensagem ao paciente", async () => {
    const phone = "+5584991233003";
    await askReception(phone);
    sent = [];
    await agentReply(phone, "#bot");
    expect(sent).toEqual([]);
    expect(await conversation(phone)).toMatchObject({ human_handoff: false });
    expect((await transitions(phone)).at(-1)).toBe("waiting_clinic>bot:reception");
  });
});

describe("encerramento automático em 12 h (CA)", () => {
  const A = "+5584991233011"; // Em atendimento
  const B = "+5584991233012"; // Em atendimento, o paciente só agradeceu
  const C = "+5584991233013"; // Aguardando a clínica
  const R = "+5584991233014"; // o paciente respondeu antes das 12 h

  beforeAll(async () => {
    for (const phone of [A, B, C, R]) await askReception(phone);
    for (const phone of [A, B, R]) await agentReply(phone, "Oi! Pode me mandar o pedido?");
    await say(B, "Obrigada!");
  });

  it("12 e 15. antes das 12 h nada encerra; depois, Em atendimento volta ao bot em silêncio", async () => {
    sent = [];
    const later = (hours: number) => new Date(Date.now() + hours * HOUR);
    expect(await returnDueConversations(bot(), f.clinicId, later(11))).toBe(0);
    // O paciente responde antes das 12 h: volta para Aguardando a clínica (13).
    await say(R, "Mandei o pedido por e-mail");
    expect(await returnDueConversations(bot(), f.clinicId, later(12.1))).toBe(2);
    expect(sent).toEqual([]);
    for (const phone of [A, B]) {
      expect(await conversation(phone)).toMatchObject({ human_handoff: false, state: "WELCOME" });
      expect((await events(phone)).at(-1)).toMatchObject({ to_status: "bot", origin: "system", actor_id: null });
    }
    // 13 e 15: quem espera a clínica fica com ela, mesmo dias depois.
    expect(await returnDueConversations(bot(), f.clinicId, later(72))).toBe(0);
    for (const phone of [C, R]) expect(await conversation(phone)).toMatchObject({ human_handoff: true, handoff_status: "waiting_clinic" });
  });

  it("14. execução antiga não encerra conversa que mudou: confere a situação e a hora lidas", async () => {
    const phone = "+5584991233015";
    await askReception(phone);
    await agentReply(phone, "Oi!");
    const [read] = await listHumanAttention(bot(), f.clinicId, phone);
    expect(read.status).toBe("in_progress");
    // Entre a leitura e o encerramento, o paciente escreve.
    await say(phone, "Ainda preciso de ajuda");
    expect(await returnToBot(bot(), f.clinicId, phone, { origin: "system", expected: { status: "in_progress", statusAt: read.statusAt } })).toBe(false);
    expect(await conversation(phone)).toMatchObject({ human_handoff: true, handoff_status: "waiting_clinic" });
    // Outra execução, depois de finalizada: nada muda nem é registrado de novo.
    await finishAttendance(reception(), f.clinicId, phone);
    const count = (await events(phone)).length;
    expect(await returnDueConversations(bot(), f.clinicId, new Date(Date.now() + 48 * HOUR))).toBe(0);
    expect((await events(phone)).length).toBe(count);
  });
});

describe("isolamento entre clínicas (CA)", () => {
  const phone = "+5584991233021";

  beforeAll(async () => {
    await askReception(phone);
  });

  it("17. login de outra clínica não finaliza e não lê os eventos", async () => {
    const out = asDb(outsider);
    expect(await finishAttendance(out, f.clinicId, phone)).toBe("already");
    expect(await getConversation(bot(), f.clinicId, phone)).toMatchObject({ humanHandoff: true, handoffStatus: "waiting_clinic" });
    const { data } = await outsider.client.from("handoff_events").select("id").eq("clinic_id", f.clinicId);
    expect(data).toEqual([]);
    // A equipe da clínica lê; ninguém grava pela tela.
    const { data: own } = await f.reception.client.from("handoff_events").select("id").eq("clinic_id", f.clinicId).eq("contact_phone", phone);
    expect(own!.length).toBe(1);
    const { error } = await f.reception.client
      .from("handoff_events")
      .insert({ clinic_id: f.clinicId, contact_phone: phone, from_status: "bot", to_status: "waiting_clinic", origin: "reception" });
    expect(error).not.toBeNull();
  });
});
