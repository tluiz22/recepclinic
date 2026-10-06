import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import { resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import type { DbClient } from "../../src/lib/data/clients";
import { checkWhatsappConnection, registerWhatsappNumber, setWhatsappAccessToken } from "../../src/lib/data/whatsapp/connection";
import { recordOutboundMessage } from "../../src/lib/data/whatsapp/messages";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { adminClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff } from "./helpers";

// F6.1 — Webhook por clínica: o número que recebeu decide a clínica; tudo é
// gravado com a credencial limitada a ela.

const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});
const deps: WebhookDeps = {
  resolveClinic: (id) => resolveClinicByPhoneNumberId(id, env()),
  clientFor: (clinicId) => createClinicServiceClient(clinicId, env()),
};

let clinicA: string;
let clinicB: string;
const NUMBER_A = "f61-numero-a";
const NUMBER_B = "f61-numero-b";

const change = (phoneNumberId: string, value: Record<string, unknown>) => ({
  entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: phoneNumberId }, ...value } }] }],
});
const inbound = (id: string, from: string, text: string) => ({ id, from, type: "text", text: { body: text } });

async function messages(clinicId: string) {
  const { data } = await adminClient()
    .from("whatsapp_messages")
    .select("direction, message_type, body, status, contact_phone, wa_message_id")
    .eq("clinic_id", clinicId)
    .order("created_at");
  return data ?? [];
}

beforeAll(async () => {
  clinicA = await createClinic("Clínica A (webhook)");
  clinicB = await createClinic("Clínica B (webhook)");
  await adminClient().from("whatsapp_connections").insert([
    { clinic_id: clinicA, phone_number_id: NUMBER_A, waba_id: "waba-a", status: "connected" },
    { clinic_id: clinicB, phone_number_id: NUMBER_B, waba_id: "waba-b", status: "connected" },
  ]);
});

afterAll(async () => deleteClinics([clinicA, clinicB]));

describe("webhook do WhatsApp por clínica", () => {
  it("cada mensagem vai para a clínica do número que recebeu; repetida não grava de novo", async () => {
    const summary = await processWebhook(change(NUMBER_A, { messages: [inbound("wamid.f61.1", "5584991110001", "Oi, quero marcar")] }), deps);
    expect(summary).toMatchObject({ inbound: 1, duplicates: 0, unknownNumbers: 0, errors: 0 });
    await processWebhook(change(NUMBER_B, { messages: [inbound("wamid.f61.2", "5584991110002", "Bom dia")] }), deps);
    // A Meta repete o mesmo evento.
    expect(await processWebhook(change(NUMBER_A, { messages: [inbound("wamid.f61.1", "5584991110001", "Oi, quero marcar")] }), deps)).toMatchObject({
      inbound: 0,
      duplicates: 1,
    });

    expect(await messages(clinicA)).toEqual([
      { direction: "inbound", message_type: "text", body: "Oi, quero marcar", status: "received", contact_phone: "+5584991110001", wa_message_id: "wamid.f61.1" },
    ]);
    expect((await messages(clinicB)).map((m) => m.body)).toEqual(["Bom dia"]);
  });

  it("número sem clínica ou desconectado: ignora, sem erro", async () => {
    expect(await processWebhook(change("f61-desconhecido", { messages: [inbound("wamid.f61.3", "5584991110003", "Oi")] }), deps)).toMatchObject({
      inbound: 0,
      unknownNumbers: 1,
      errors: 0,
    });
    await adminClient().from("whatsapp_connections").update({ status: "disconnected" }).eq("clinic_id", clinicB);
    expect(await processWebhook(change(NUMBER_B, { messages: [inbound("wamid.f61.4", "5584991110002", "Oi de novo")] }), deps)).toMatchObject({
      unknownNumbers: 1,
    });
    expect((await messages(clinicB)).map((m) => m.body)).toEqual(["Bom dia"]);
    await adminClient().from("whatsapp_connections").update({ status: "connected" }).eq("clinic_id", clinicB);
  });

  it("situação de entrega atualiza a mensagem enviada pela própria clínica; nunca regride", async () => {
    const db = createClinicServiceClient(clinicA, env());
    await recordOutboundMessage(db, clinicA, { phone: "+5584991110001", messageType: "bot_menu", body: "Menu", status: "sent", waMessageId: "wamid.f61.out" });
    const status = (s: string) => change(NUMBER_A, { statuses: [{ id: "wamid.f61.out", status: s, recipient_id: "5584991110001" }] });
    expect(await processWebhook(status("read"), deps)).toMatchObject({ statuses: 1 });
    expect(await processWebhook(status("delivered"), deps)).toMatchObject({ statuses: 0 });
    // O mesmo id em outra clínica não é atualizado.
    expect(await processWebhook(change(NUMBER_B, { statuses: [{ id: "wamid.f61.out", status: "failed" }] }), deps)).toMatchObject({ statuses: 0 });
    expect((await messages(clinicA)).find((m) => m.wa_message_id === "wamid.f61.out")?.status).toBe("read");
  });

  it("eco da recepção pelo app (coexistência) é gravado como mensagem da recepção", async () => {
    const summary = await processWebhook(
      change(NUMBER_A, { message_echoes: [{ id: "wamid.f61.eco", from: "5584000000000", to: "5584991110001", type: "text", text: { body: "Já te respondo" } }] }),
      deps,
    );
    expect(summary).toMatchObject({ echoes: 1 });
    expect((await messages(clinicA)).find((m) => m.wa_message_id === "wamid.f61.eco")).toMatchObject({
      direction: "outbound",
      message_type: "agent_reply",
      body: "Já te respondo",
    });
  });
});

describe("Testar conexão (Suporte, F6.1)", () => {
  it("lê o token da clínica, confere o número e inscreve o app; sem token ou com erro da Meta, diz o motivo", async () => {
    const support = await createUser("f61-suporte");
    await makePlatformStaff(support.id);
    const db = createClinicServiceClient(clinicA, env());
    const calls: string[] = [];
    const meta: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+/, "")} ${(init?.headers as Record<string, string>).Authorization}`);
      if (url.includes("subscribed_apps")) return new Response(JSON.stringify({ success: true }));
      if (url.includes("numero-errado")) return new Response(JSON.stringify({ error: { code: 100, message: "Unsupported get request" } }), { status: 400 });
      return new Response(JSON.stringify({ display_phone_number: "+55 84 3333-0000", verified_name: "RecepClinic", name_status: "APPROVED", platform_type: "CLOUD_API", status: "CONNECTED" }));
    };
    try {
      expect(await checkWhatsappConnection(db, clinicA, meta)).toMatchObject({ ok: false, problem: "no_token" });

      await setWhatsappAccessToken(support.client as unknown as DbClient, clinicA, "token-f61");
      expect(await checkWhatsappConnection(db, clinicA, meta)).toMatchObject({
        ok: true,
        subscribed: true,
        info: { verifiedName: "RecepClinic", platformType: "CLOUD_API", status: "CONNECTED" },
      });
      expect(calls).toEqual([
        `GET /${NUMBER_A}?fields=display_phone_number,verified_name,name_status,quality_rating,platform_type,status Bearer token-f61`,
        "POST /waba-a/subscribed_apps Bearer token-f61",
      ]);

      await adminClient().from("whatsapp_connections").update({ phone_number_id: "numero-errado" }).eq("clinic_id", clinicA);
      const failed = await checkWhatsappConnection(db, clinicA, meta);
      expect(failed).toMatchObject({ ok: false, problem: "meta_error" });
      expect((failed as { message: string }).message).toContain("Unsupported get request (código 100)");
    } finally {
      await adminClient().from("whatsapp_connections").update({ phone_number_id: NUMBER_A }).eq("clinic_id", clinicA);
      await deleteUsers([support]);
    }
  });
});

describe("Registrar o número (Suporte, F6.1)", () => {
  it("manda o PIN para a Meta com o token da clínica; PIN inválido nem sai", async () => {
    const support = await createUser("f61-suporte-pin");
    await makePlatformStaff(support.id);
    const db = createClinicServiceClient(clinicA, env());
    const sent: { url: string; body: string }[] = [];
    const meta: typeof fetch = async (input, init) => {
      sent.push({ url: String(input), body: String(init?.body) });
      return new Response(JSON.stringify({ success: true }));
    };
    try {
      await setWhatsappAccessToken(support.client as unknown as DbClient, clinicA, "token-f61");
      expect(await registerWhatsappNumber(db, clinicA, "12a456", meta)).toBe("O PIN tem 6 números.");
      expect(sent).toEqual([]);
      expect(await registerWhatsappNumber(db, clinicA, "123456", meta)).toBeNull();
      expect(sent[0].url).toMatch(new RegExp(`/${NUMBER_A}/register$`));
      expect(JSON.parse(sent[0].body)).toEqual({ messaging_product: "whatsapp", pin: "123456" });
    } finally {
      await deleteUsers([support]);
    }
  });
});
