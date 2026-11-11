import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import { resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import { listHumanAttention } from "../../src/lib/data/whatsapp/attention";
import { markHandoffSubjectAsked } from "../../src/lib/data/whatsapp/conversations";
import type { ClinicSender, ListSection, ReplyButton } from "../../src/lib/data/whatsapp/send";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { asDb, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient } from "./helpers";

// Jornada do bot, E4 (cliente, 31/out/2026; exceção da D12): ao passar a
// conversa para a recepção, o bot avisa, pergunta o assunto uma vez e guarda
// a primeira resposta em texto (até 300 caracteres), que aparece na tela
// Atendimento e some quando a conversa volta ao bot. Clínica com coexistência.

const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});

const NUMBER = "e4-numero";
const LEAN_HANDOFF = "Certo! A recepção vai te atender por aqui. Escreva sua dúvida, por favor.";
const QUESTION = "Para agilizar, poderia me contar brevemente qual assunto deseja tratar com a secretária?";
type Sent = { kind: "text" | "list" | "buttons"; body: string; options: { id: string; title: string }[] };

let f: AgendaFixture;
let sent: Sent[] = [];
let seq = 0;

const sender: ClinicSender = {
  clinicId: "",
  clinicLabel: "da Clínica Assunto E4",
  baseUrl: "https://app.exemplo.test",
  template: async () => ({ sent: false, reason: "sem template no teste" }),
  text: async (_to, body) => (sent.push({ kind: "text", body, options: [] }), { sent: true, messageId: `wamid.e4.out.${++seq}`, body }),
  list: async (_to: string, body: string, _button: string, sections: ListSection[]) => (
    sent.push({ kind: "list", body, options: sections.flatMap((s) => s.rows.map((r) => ({ id: r.id, title: r.title }))) }),
    { sent: true, messageId: `wamid.e4.out.${++seq}` }
  ),
  buttons: async (_to: string, body: string, buttons: ReplyButton[]) => (
    sent.push({ kind: "buttons", body, options: buttons }),
    { sent: true, messageId: `wamid.e4.out.${++seq}` }
  ),
};

const deps = (): WebhookDeps => ({
  resolveClinic: (id) => resolveClinicByPhoneNumberId(id, env()),
  clientFor: (clinicId) => createClinicServiceClient(clinicId, env()),
  senderFor: async () => sender,
});

async function webhook(value: Record<string, unknown>) {
  const summary = await processWebhook({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: NUMBER }, ...value } }] }] }, deps(), new Date());
  expect(summary.errors).toBe(0);
}

/** O paciente manda texto, toca numa opção ou manda áudio; devolve o texto do que o bot respondeu. */
async function say(phone: string, input: string | { id: string } | { audio: true }): Promise<string[]> {
  sent = [];
  const id = `wamid.e4.in.${++seq}`;
  const from = phone.slice(1);
  const message =
    typeof input === "string"
      ? { id, from, type: "text", text: { body: input } }
      : "audio" in input
        ? { id, from, type: "audio", audio: { id: "media-1" } }
        : { id, from, type: "interactive", interactive: { list_reply: { id: input.id, title: "" } } };
  await webhook({ messages: [message] });
  return sent.map((m) => m.body);
}

/** A recepção responde pelo app (eco). */
const agentReply = (phone: string, body: string) =>
  webhook({ message_echoes: [{ id: `wamid.e4.echo.${++seq}`, from: "5584000000000", to: phone.slice(1), type: "text", text: { body } }] });

async function state(phone: string) {
  const { data } = await adminClient()
    .from("conversation_state")
    .select("state, human_handoff, handoff_reason, handoff_subject, handoff_subject_asked_at")
    .eq("clinic_id", f.clinicId)
    .eq("contact_phone", phone)
    .single();
  return data!;
}

const attentionOf = async (phone: string) => (await listHumanAttention(asDb(f.reception), f.clinicId, phone))[0];

/** "Oi" › "Falar com a recepção" do menu: transfere direto (cliente, 06/nov/2026). */
async function askReception(phone: string): Promise<string[]> {
  await say(phone, "Oi");
  return say(phone, "4");
}

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica Assunto E4", "+55849912290", { oneBotProfessional: true });
  await adminClient().from("whatsapp_connections").insert({ clinic_id: f.clinicId, phone_number_id: NUMBER, waba_id: "e4-waba", status: "connected", coexistence: true });
  await adminClient().from("clinic_settings").update({ reception_hours: Array.from({ length: 7 }, () => ({ open: "00:00", close: "23:59" })) as never }).eq("clinic_id", f.clinicId);
});

afterAll(async () => f.cleanup());

describe("assunto da transferência", () => {
  it("avisa a transferência pedindo a dúvida numa mensagem só (BE-4) e pausa o bot", async () => {
    const phone = "+5584991229099";
    const reply = await askReception(phone);
    expect(reply).toEqual([LEAN_HANDOFF]);
    expect(await state(phone)).toMatchObject({ state: "HUMAN_HANDOFF", human_handoff: true, handoff_reason: "requested", handoff_subject: null });
    expect((await state(phone)).handoff_subject_asked_at).not.toBeNull();
  });

  it("sem resposta: a conversa já está com a recepção, com o assunto \"não informado\"", async () => {
    const item = await attentionOf("+5584991229099");
    expect(item).toMatchObject({ status: "waiting", reason: "requested", subject: null, subjectAsked: true });
  });

  it("a primeira resposta em texto vira o assunto, aparece para a recepção e não é perguntada de novo", async () => {
    const phone = "+5584991229099";
    expect(await say(phone, "Quero saber se a Dra. atende sábado")).toEqual([]);
    expect((await state(phone)).handoff_subject).toBe("Quero saber se a Dra. atende sábado");
    expect(await attentionOf(phone)).toMatchObject({ subject: "Quero saber se a Dra. atende sábado", subjectAsked: true });
    // Depois disso o bot fica calado e não regrava.
    expect(await say(phone, "Obrigada")).toEqual([]);
    expect((await state(phone)).handoff_subject).toBe("Quero saber se a Dra. atende sábado");
    // Nova transferência na mesma pausa não pergunta outra vez.
    expect(await markHandoffSubjectAsked(createClinicServiceClient(f.clinicId, env()), f.clinicId, phone)).toBe(false);
  });

  it("\"#bot\": a conversa volta ao bot e o assunto é apagado", async () => {
    const phone = "+5584991229099";
    await agentReply(phone, "#bot");
    expect(await state(phone)).toMatchObject({ human_handoff: false, handoff_subject: null, handoff_subject_asked_at: null });
    // Nova pausa: pede a dúvida de novo.
    expect((await askReception(phone)).at(-1)).toBe(LEAN_HANDOFF);
    await agentReply(phone, "#bot");
  });

  it("áudio não é o assunto; o texto seguinte é. Até 300 caracteres", async () => {
    const phone = "+5584991229098";
    await askReception(phone);
    expect(await say(phone, { audio: true })).toEqual([]);
    expect((await state(phone)).handoff_subject).toBeNull();
    expect(await say(phone, `  ${"a".repeat(350)}  `)).toEqual([]);
    expect((await state(phone)).handoff_subject).toBe("a".repeat(300));
  });

  it("a recepção respondeu antes: a mensagem do paciente é conversa, não assunto", async () => {
    const phone = "+5584991229097";
    await askReception(phone);
    await agentReply(phone, "Olá! Em que posso ajudar?");
    expect(await say(phone, "Preciso remarcar")).toEqual([]);
    expect(await state(phone)).toMatchObject({ handoff_subject: null });
    // O paciente escreveu depois da recepção: volta a "Aguardando", como antes.
    expect(await attentionOf(phone)).toMatchObject({ status: "waiting", subject: null, subjectAsked: true });
  });

  it("bot que não entende (4ª seguida): avisa, pergunta o assunto e guarda a resposta", async () => {
    const phone = "+5584991229096";
    await say(phone, "Oi");
    for (const text of ["xyz", "???", "hmm"]) await say(phone, text);
    await say(phone, "kkk"); // "Você quer falar com a recepção?" (cliente, 31/out/2026)
    const reply = await say(phone, "sim");
    expect(reply.at(-1)).toBe(QUESTION);
    expect(await say(phone, "Resultado de exame")).toEqual([]);
    expect(await state(phone)).toMatchObject({ handoff_reason: "not_understood", handoff_subject: "Resultado de exame" });
  });
});
