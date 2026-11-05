import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import { setCentralEnabled } from "../../src/lib/data/central";
import { resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import type { ClinicSender } from "../../src/lib/data/whatsapp/send";
import {
  processWebhook,
  type WebhookDeps,
} from "../../src/lib/data/whatsapp/webhook";
import { asDb, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient } from "./helpers";

// CN2 — texto das conversas (Central de Atendimento, cliente, 05/nov/2026): o texto do paciente e o das respostas pelo
// app só ficam com a Central ligada; a hora da Meta ordena; edição e exclusão no app mudam a original sem pausar o
// bot; a conversa guarda a última mensagem (prévia só com a Central) sem mexer no tempo parado do bot.

const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});

const NUMBER = "cn2-numero";
let f: AgendaFixture;
let seq = 0;
const ok = async () => ({
  sent: true as const,
  messageId: `wamid.cn2.out.${++seq}`,
});
const sender: ClinicSender = {
  clinicId: "",
  clinicLabel: "da Clínica CN2",
  baseUrl: "https://app.exemplo.test",
  template: async () => ({ sent: false, reason: "sem template no teste" }),
  text: async (_to, body) => ({ ...(await ok()), body }),
  list: ok,
  buttons: ok,
};
const deps = (): WebhookDeps => ({
  resolveClinic: (id) => resolveClinicByPhoneNumberId(id, env()),
  clientFor: (clinicId) => createClinicServiceClient(clinicId, env()),
  senderFor: async () => sender,
});
async function webhook(value: Record<string, unknown>) {
  const summary = await processWebhook(
    {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: { metadata: { phone_number_id: NUMBER }, ...value },
            },
          ],
        },
      ],
    },
    deps(),
    new Date(),
  );
  expect(summary.errors).toBe(0);
  return summary;
}
const say = (phone: string, body: string, timestamp?: number) =>
  webhook({
    messages: [
      {
        id: `wamid.cn2.in.${++seq}`,
        from: phone.slice(1),
        type: "text",
        text: { body },
        ...(timestamp ? { timestamp: String(timestamp) } : {}),
      },
    ],
  });
const echo = (phone: string, item: Record<string, unknown>) =>
  webhook({
    message_echoes: [
      {
        id: `wamid.cn2.echo.${++seq}`,
        from: "5584000000000",
        to: phone.slice(1), // 10 min à frente: fora da janela da "mensagem automática do app" (IS4), é a recepção respondendo.
        timestamp: String(Math.floor(Date.now() / 1000) + 600),
        ...item,
      },
    ],
  });
const messages = async (phone: string) =>
  (
    await adminClient()
      .from("whatsapp_messages")
      .select(
        "direction, message_type, author, body, wa_message_id, wa_timestamp, sort_at, edited_at, revoked_at",
      )
      .eq("clinic_id", f.clinicId)
      .eq("contact_phone", phone)
      .order("sort_at")
      .order("id")
  ).data ?? [];
const conversation = async (phone: string) =>
  (
    await adminClient()
      .from("conversation_state")
      .select(
        "human_handoff, updated_at, last_message_at, last_message_author, last_message_preview, last_patient_at",
      )
      .eq("clinic_id", f.clinicId)
      .eq("contact_phone", phone)
      .single()
  ).data!;

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica CN2", "+55849913009");
  await adminClient()
    .from("whatsapp_connections")
    .insert({
      clinic_id: f.clinicId,
      phone_number_id: NUMBER,
      waba_id: "cn2-waba",
      status: "connected",
      coexistence: true,
    });
});

afterAll(async () => f.cleanup());

describe("Central desligada", () => {
  it("não guarda o texto do paciente nem o do app; a conversa fica sem prévia", async () => {
    const phone = "+5584991300001";
    await say(phone, "Oi, tudo bem?");
    await echo(phone, {
      type: "text",
      text: { body: "Bom dia! Como posso ajudar?" },
    });
    const rows = await messages(phone);
    expect(rows.find((m) => m.direction === "inbound")?.body).toBeNull();
    expect(rows.find((m) => m.message_type === "agent_reply")?.body).toBeNull();
    // O texto do bot continua guardado como antes.
    expect(rows.some((m) => m.author === "bot" && m.body)).toBe(true);
    const convo = await conversation(phone);
    expect(convo.last_message_preview).toBeNull();
    expect(convo.last_message_author).toBe("agent_app");
  });
});

describe("Central ligada", () => {
  beforeAll(async () => {
    expect(await setCentralEnabled(asDb(f.admin), f.clinicId, true)).toBe(true);
  });

  it("guarda o texto e a hora da Meta; a conversa nasce com a última mensagem", async () => {
    const phone = "+5584991300002";
    const at = Math.floor(Date.now() / 1000) - 30;
    await say(phone, "Quero  marcar\numa consulta", at);
    const [first] = await messages(phone);
    expect(first).toMatchObject({
      direction: "inbound",
      author: "patient",
      body: "Quero  marcar\numa consulta",
    });
    expect(new Date(first.wa_timestamp!).getTime()).toBe(at * 1000);
    expect(new Date(first.sort_at).getTime()).toBe(at * 1000);
    const convo = await conversation(phone);
    expect(new Date(convo.last_patient_at!).getTime()).toBe(at * 1000);
    // A última é a resposta do bot, com a prévia numa linha só.
    expect(convo.last_message_author).toBe("bot");
    expect(convo.last_message_preview).not.toBeNull();
  });

  it("resposta pelo app com texto; editada e apagada no app mudam a original, sem mensagem nova e sem pausar de novo", async () => {
    const phone = "+5584991300003";
    await say(phone, "Oi");
    await echo(phone, {
      type: "text",
      text: { body: "Olá, aqui é a recepção" },
    });
    const reply = (await messages(phone)).find(
      (m) => m.message_type === "agent_reply",
    )!;
    expect(reply).toMatchObject({
      author: "agent_app",
      body: "Olá, aqui é a recepção",
    });
    expect((await conversation(phone)).last_message_preview).toBe(
      "Olá, aqui é a recepção",
    );
    const count = (await messages(phone)).length;
    const pausedAt = (await conversation(phone)).updated_at;

    await echo(phone, {
      type: "edit",
      edit: {
        original_message_id: reply.wa_message_id,
        message: {
          type: "text",
          text: { body: "Olá, aqui é a recepção da clínica" },
        },
      },
    });
    let rows = await messages(phone);
    expect(rows).toHaveLength(count);
    const edited = rows.find((m) => m.wa_message_id === reply.wa_message_id)!;
    expect(edited.body).toBe("Olá, aqui é a recepção da clínica");
    expect(edited.edited_at).not.toBeNull();
    expect((await conversation(phone)).last_message_preview).toBe(
      "Olá, aqui é a recepção da clínica",
    );

    await echo(phone, {
      type: "revoke",
      revoke: { original_message_id: reply.wa_message_id },
    });
    rows = await messages(phone);
    expect(rows).toHaveLength(count);
    const revoked = rows.find((m) => m.wa_message_id === reply.wa_message_id)!;
    expect(revoked.body).toBeNull();
    expect(revoked.revoked_at).not.toBeNull();
    const convo = await conversation(phone);
    expect(convo.last_message_preview).toBeNull();
    expect(convo.updated_at).toBe(pausedAt);
  });

  it("a última mensagem não mexe no updated_at (tempo parado do bot); histórico antigo não passa à frente", async () => {
    const phone = "+5584991300004";
    await say(phone, "Oi");
    const before = await conversation(phone);
    await adminClient().from("whatsapp_messages").insert({
      clinic_id: f.clinicId,
      contact_phone: phone,
      direction: "inbound",
      message_type: "text",
      body: "mensagem antiga",
      status: "received",
      source: "history",
      wa_timestamp: "2026-01-10T12:00:00Z",
    });
    const after = await conversation(phone);
    expect(after.updated_at).toBe(before.updated_at);
    expect(after.last_message_at).toBe(before.last_message_at);
    expect(after.last_patient_at).toBe(before.last_patient_at);
    // Mensagem nova do sistema: muda a última, ainda sem mexer no updated_at.
    await adminClient().from("whatsapp_messages").insert({
      clinic_id: f.clinicId,
      contact_phone: phone,
      direction: "outbound",
      message_type: "waitlist_offer",
      body: "Abriu uma vaga",
      status: "sent",
    });
    const latest = await conversation(phone);
    expect(latest).toMatchObject({
      last_message_author: "system",
      last_message_preview: "Abriu uma vaga",
      updated_at: before.updated_at,
    });
  });

  it("nome no perfil do WhatsApp (T4): guardado com a Central, sem mexer no tempo parado do bot", async () => {
    const phone = "+5584991300006";
    await say(phone, "Oi");
    await webhook({
      contacts: [{ wa_id: phone.slice(1), profile: { name: "Fernanda" } }],
      messages: [{ id: `wamid.cn2.in.${++seq}`, from: phone.slice(1), type: "text", text: { body: "Tudo bem?" } }],
    });
    const row = () => adminClient().from("conversation_state").select("profile_name, updated_at").eq("clinic_id", f.clinicId).eq("contact_phone", phone).single();
    const { data } = await row();
    expect(data!.profile_name).toBe("Fernanda");
    // O nome sozinho não muda o updated_at (o bot mede o tempo parado por ele).
    await adminClient().from("conversation_state").update({ profile_name: "Fernanda S." }).eq("clinic_id", f.clinicId).eq("contact_phone", phone);
    const after = await row();
    expect(after.data).toEqual({ profile_name: "Fernanda S.", updated_at: data!.updated_at });
  });

  it("desligada de novo: mensagens novas sem texto", async () => {
    expect(await setCentralEnabled(asDb(f.admin), f.clinicId, false)).toBe(
      true,
    );
    const phone = "+5584991300005";
    await say(phone, "Texto que não fica");
    expect(
      (await messages(phone)).find((m) => m.direction === "inbound")?.body,
    ).toBeNull();
    // Nem o nome do perfil.
    await adminClient().from("conversation_state").update({ profile_name: "Outro nome" }).eq("clinic_id", f.clinicId).eq("contact_phone", phone);
    const { data } = await adminClient().from("conversation_state").select("profile_name").eq("clinic_id", f.clinicId).eq("contact_phone", phone).single();
    expect(data!.profile_name).toBeNull();
  });
});
