import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import { resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import { APP_AUTO_REPLY_TYPE, getConversation, latestAutomaticEcho } from "../../src/lib/data/whatsapp/conversations";
import type { ClinicSender } from "../../src/lib/data/whatsapp/send";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient } from "./helpers";

// IS4 revisto (cliente, 12/nov/2026): o eco do app NÃO é mais classificado pelo tempo. A mensagem que a recepção digitou
// 1,5 s depois do paciente ("ESQUECI ONTEM", clínica piloto) virou "mensagem automática" por engano. Todo eco é da recepção.

const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});

const NUMBER = "is4-numero";
let f: AgendaFixture;
let seq = 0;

const ok = async () => ({ sent: true as const, messageId: `wamid.is4.out.${++seq}` });
const sender: ClinicSender = {
  clinicId: "",
  clinicLabel: "da Clínica IS4",
  baseUrl: "https://app.exemplo.test",
  template: ok,
  text: ok,
  list: ok,
  buttons: ok,
};

const deps = (): WebhookDeps => ({
  resolveClinic: (id) => resolveClinicByPhoneNumberId(id, env()),
  clientFor: (clinicId) => createClinicServiceClient(clinicId, env()),
  senderFor: async () => sender,
});

const webhook = async (value: Record<string, unknown>) => {
  const summary = await processWebhook({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: NUMBER }, ...value } }] }] }, deps(), new Date());
  expect(summary.errors).toBe(0);
};

const hello = (phone: string) => webhook({ messages: [{ id: `wamid.is4.in.${++seq}`, from: phone.slice(1), type: "text", text: { body: "oi" } }] });
const echo = (phone: string, body: string, secondsFromNow: number | null) =>
  webhook({
    message_echoes: [
      {
        id: `wamid.is4.echo.${++seq}`,
        to: phone.slice(1),
        type: "text",
        text: { body },
        ...(secondsFromNow === null ? {} : { timestamp: String(Math.floor(Date.now() / 1000) + secondsFromNow) }),
      },
    ],
  });
const paused = async (phone: string) => (await getConversation(createClinicServiceClient(f.clinicId, env()), f.clinicId, phone))?.humanHandoff ?? false;
const lastEchoType = async (phone: string) =>
  (
    await adminClient()
      .from("whatsapp_messages")
      .select("message_type")
      .eq("clinic_id", f.clinicId)
      .eq("contact_phone", phone)
      .in("message_type", ["agent_reply", APP_AUTO_REPLY_TYPE])
      .order("created_at", { ascending: false })
      .limit(1)
      .single()
  ).data!.message_type;

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica IS4", "+55849912290");
  await adminClient().from("whatsapp_connections").insert({ clinic_id: f.clinicId, phone_number_id: NUMBER, waba_id: "is4-waba", status: "connected", coexistence: true });
});

afterAll(async () => f.cleanup());

describe("eco do app sem classificação por tempo", () => {
  it("mensagem segundos depois do paciente: é da recepção, pausa o bot e não gera o aviso", async () => {
    const phone = "+5584988880001";
    await hello(phone);
    await echo(phone, "ESQUECI ONTEM", 2);
    expect(await paused(phone)).toBe(true);
    expect(await lastEchoType(phone)).toBe("agent_reply");
    expect(await latestAutomaticEcho(createClinicServiceClient(f.clinicId, env()), f.clinicId)).toBeNull();
  });

  it("a recepção responde um minuto depois: pausa como sempre", async () => {
    const phone = "+5584988880002";
    await hello(phone);
    await echo(phone, "Bom dia! Aqui é a recepção.", 60);
    expect(await paused(phone)).toBe(true);
    expect(await lastEchoType(phone)).toBe("agent_reply");
  });

  it("eco sem a hora da Meta: pausa; \"#bot\" segue devolvendo", async () => {
    const phone = "+5584988880003";
    await hello(phone);
    await echo(phone, "Já te respondo", null);
    expect(await paused(phone)).toBe(true);
    await echo(phone, "#bot", 1);
    expect(await paused(phone)).toBe(false);
  });
});
