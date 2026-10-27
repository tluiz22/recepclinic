import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import { resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import type { ClinicSender, ListSection, ReplyButton } from "../../src/lib/data/whatsapp/send";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { MEDIA_AUDIO, MEDIA_OTHER } from "../../src/lib/data/whatsapp/bot/texts";
import { setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient } from "./helpers";

// F8.5d — Bot que não entende: na 4ª mensagem seguida que o bot não entende
// (texto fora das opções, áudio, figurinha…), a conversa vai para a clínica,
// com o horário da recepção na mensagem; áudio e outras mídias têm aviso
// próprio; uma resposta entendida zera. Sem coexistência, nada vai para a
// clínica. Conversas pelo webhook com a Meta simulada.

const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});

const NUMBER = "nao-entende-numero";
type Sent = { kind: "text" | "list" | "buttons"; body: string };

let f: AgendaFixture;
let sent: Sent[] = [];
let seq = 0;

const sender: ClinicSender = {
  clinicId: "",
  clinicLabel: "da Clínica Não Entende",
  baseUrl: "https://app.exemplo.test",
  template: async () => ({ sent: false, reason: "sem template no teste" }),
  text: async (_to, body) => (sent.push({ kind: "text", body }), { sent: true, messageId: `wamid.ne.out.${++seq}`, body }),
  list: async (_to: string, body: string, _b: string, _s: ListSection[]) => (sent.push({ kind: "list", body }), { sent: true, messageId: `wamid.ne.out.${++seq}` }),
  buttons: async (_to: string, body: string, _b: ReplyButton[]) => (sent.push({ kind: "buttons", body }), { sent: true, messageId: `wamid.ne.out.${++seq}` }),
};

const deps = (): WebhookDeps => ({
  resolveClinic: (id) => resolveClinicByPhoneNumberId(id, env()),
  clientFor: (clinicId) => createClinicServiceClient(clinicId, env()),
  senderFor: async () => sender,
});

/** O paciente digita, toca numa opção (`{ id }`) ou manda mídia (`{ media }`). */
async function message(phone: string, input: string | { id: string } | { media: string }): Promise<string[]> {
  sent = [];
  const id = `wamid.ne.in.${++seq}`;
  const from = phone.slice(1);
  const payload =
    typeof input === "string"
      ? { id, from, type: "text", text: { body: input } }
      : "id" in input
        ? { id, from, type: "interactive", interactive: { list_reply: { id: input.id, title: "" } } }
        : { id, from, type: input.media, [input.media]: { id: `midia.${seq}` } };
  const summary = await processWebhook(
    { entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: NUMBER }, messages: [payload] } }] }] },
    deps(),
    new Date(),
  );
  expect(summary.errors).toBe(0);
  return sent.map((m) => m.body);
}

async function conversation(phone: string) {
  const { data } = await adminClient()
    .from("conversation_state")
    .select("state, human_handoff, handoff_reason, not_understood_count")
    .eq("clinic_id", f.clinicId)
    .eq("contact_phone", phone)
    .single();
  return data!;
}

const setCoexistence = (on: boolean) => adminClient().from("whatsapp_connections").update({ coexistence: on }).eq("clinic_id", f.clinicId);
const setReceptionHours = (hours: unknown) => adminClient().from("clinic_settings").update({ reception_hours: hours }).eq("clinic_id", f.clinicId);
const ALWAYS_OPEN = Array.from({ length: 7 }, () => ({ open: "00:00", close: "23:59" }));
const NOT_UNDERSTOOD = /^Não entendi/;

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica Não Entende", "+55849912277");
  await adminClient().from("whatsapp_connections").insert({ clinic_id: f.clinicId, phone_number_id: NUMBER, waba_id: "nao-entende-waba", status: "connected", coexistence: true });
});

afterAll(async () => {
  await f.cleanup();
});

beforeEach(async () => {
  await setCoexistence(true);
  await setReceptionHours(ALWAYS_OPEN);
});

describe("bot que não entende (F8.5d)", () => {
  it("áudio e figurinha: aviso próprio no lugar do 'não entendi'", async () => {
    const phone = "+5584991227701";
    await message(phone, "oi");
    expect((await message(phone, { media: "audio" }))[0]).toBe(MEDIA_AUDIO);
    expect((await message(phone, { media: "sticker" }))[0]).toBe(MEDIA_OTHER);
    expect((await conversation(phone)).not_understood_count).toBe(2);
  });

  it("4ª seguida: não repete o 'não entendi', avisa e a conversa vai para a clínica", async () => {
    const phone = "+5584991227702";
    await message(phone, "oi");
    expect((await message(phone, "xyz"))[0]).toMatch(NOT_UNDERSTOOD);
    expect((await message(phone, { media: "audio" }))[0]).toBe(MEDIA_AUDIO);
    expect((await message(phone, "???"))[0]).toMatch(NOT_UNDERSTOOD);
    expect(await message(phone, { media: "image" })).toEqual(["Vou pedir para alguém da clínica te atender por aqui. Aguarde, por favor."]);
    expect(await conversation(phone)).toEqual({ state: "HUMAN_HANDOFF", human_handoff: true, handoff_reason: "not_understood", not_understood_count: 0 });
    // Pausada: o bot fica calado.
    expect(await message(phone, "alô?")).toEqual([]);
  });

  it("fora do horário da recepção: diz quando a clínica responde", async () => {
    const phone = "+5584991227703";
    await setReceptionHours(Array.from({ length: 7 }, () => null));
    await message(phone, "oi");
    for (const text of ["a", "b", "c"]) await message(phone, text);
    expect(await message(phone, "d")).toEqual(["Vou pedir para alguém da clínica te atender por aqui. A clínica responde assim que possível."]);
    const other = "+5584991227704";
    // Só na segunda-feira, das 8h às 9h: "a partir de …".
    await setReceptionHours([null, { open: "08:00", close: "09:00" }, null, null, null, null, null]);
    await message(other, "oi");
    for (const text of ["a", "b", "c"]) await message(other, text);
    const [reply] = await message(other, "d");
    expect(reply).toMatch(/^Vou pedir para alguém da clínica te atender por aqui\. A clínica responde a partir de .+, às 8h\.$/);
  });

  it("uma resposta entendida zera a contagem", async () => {
    const phone = "+5584991227705";
    await message(phone, "oi");
    await message(phone, "x");
    await message(phone, "y");
    await message(phone, "z");
    expect((await conversation(phone)).not_understood_count).toBe(3);
    await message(phone, { id: "menu_info" });
    expect((await conversation(phone)).not_understood_count).toBe(0);
    for (const text of ["a", "b", "c"]) expect((await message(phone, text))[0]).toMatch(NOT_UNDERSTOOD);
    expect((await conversation(phone)).human_handoff).toBe(false);
  });

  it("sem coexistência: o aviso da mídia continua, mas nada vai para a clínica", async () => {
    const phone = "+5584991227706";
    await setCoexistence(false);
    await message(phone, "oi");
    for (const text of ["a", "b", "c", "d"]) expect((await message(phone, text))[0]).toMatch(NOT_UNDERSTOOD);
    expect((await message(phone, { media: "audio" }))[0]).toBe(MEDIA_AUDIO);
    expect((await conversation(phone)).human_handoff).toBe(false);
  });
});
