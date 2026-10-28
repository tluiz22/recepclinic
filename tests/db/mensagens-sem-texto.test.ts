import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { listLatestWhatsappMessages, recordAgentEcho, recordInboundMessage, recordOutboundMessage } from "../../src/lib/data/whatsapp/messages";
import { addMember, adminClient, anonClient, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";

// CRM B0 (cliente, 28/out/2026, D12): o texto das conversas fica no app do
// WhatsApp. O RecepClinic não guarda o que o paciente escreve nem o que a
// recepção responde pelo app; o texto do que o sistema envia fica para o
// reenvio, mas o login da clínica não lê (só o Suporte, pela função).

const asDb = (client: unknown) => client as DbClient;
const stamp = Date.now();
let seq = 0;
const wamid = () => `wamid.b0${stamp}.${++seq}`;
const PHONE = "+5584977730001";

let clinic: string;
let bot: DbClient;
let admin: TestUser;
let reception: TestUser;
let professional: TestUser;
let support: TestUser;
let outboundId: string;

beforeAll(async () => {
  clinic = await createClinic("Clínica (mensagens sem texto)");
  [admin, reception, professional, support] = await Promise.all(["b0-adm", "b0-rec", "b0-prof", "b0-sup"].map((label) => createUser(label)));
  await addMember(clinic, admin.id, ["admin"]);
  await addMember(clinic, reception.id, ["reception"]);
  await addMember(clinic, professional.id, ["professional"]);
  await makePlatformStaff(support.id);
  bot = asDb(clinicServiceClient(clinic));

  await recordInboundMessage(bot, clinic, { id: wamid(), from: PHONE.slice(1), type: "text", text: { body: "Quero remarcar" } });
  await recordAgentEcho(bot, clinic, { id: wamid(), to: PHONE.slice(1), type: "text", text: { body: "Claro, qual dia?" } });
  outboundId = await recordOutboundMessage(bot, clinic, { phone: PHONE, messageType: "bot_menu", body: "Como podemos ajudar?", status: "sent", waMessageId: wamid() });
});

afterAll(async () => {
  await deleteClinics([clinic]);
  await deleteUsers([admin, reception, professional, support]);
});

describe("mensagens sem texto (CRM B0)", () => {
  it("não guarda o texto recebido nem o da recepção pelo app; guarda o que o sistema envia", async () => {
    const { data } = await adminClient().from("whatsapp_messages").select("message_type, body").eq("clinic_id", clinic).order("created_at");
    expect(data).toEqual([
      { message_type: "text", body: null },
      { message_type: "agent_reply", body: null },
      { message_type: "bot_menu", body: "Como podemos ajudar?" },
    ]);
  });

  it("o login da clínica não lê o texto nem o pedido do reenvio, só as outras colunas", async () => {
    for (const user of [admin, reception, professional]) {
      const db = asDb(user.client);
      expect((await db.from("whatsapp_messages").select("body").eq("clinic_id", clinic)).error).toMatchObject({ code: "42501" });
      expect((await db.from("whatsapp_messages").select("retry_payload").eq("clinic_id", clinic)).error).toMatchObject({ code: "42501" });
      const { data, error } = await db.from("whatsapp_messages").select("id, message_type, status, created_at").eq("clinic_id", clinic);
      expect(error).toBeNull();
      expect(data).toHaveLength(3);
    }
  });

  it("o login altera a situação, mas não o texto", async () => {
    const db = asDb(admin.client);
    expect((await db.from("whatsapp_messages").update({ body: "outro" }).eq("id", outboundId)).error).toMatchObject({ code: "42501" });
    expect((await db.from("whatsapp_messages").update({ status: "delivered" }).eq("id", outboundId)).error).toBeNull();
  });

  it("sem login, nada", async () => {
    expect((await anonClient().from("whatsapp_messages").select("id")).error).toMatchObject({ code: "42501" });
  });

  it("últimas mensagens: só o Suporte; a clínica e o bot recebem erro de acesso", async () => {
    const latest = await listLatestWhatsappMessages(asDb(support.client), clinic, 2);
    expect(latest.map((m) => [m.messageType, m.body])).toEqual([
      ["bot_menu", "Como podemos ajudar?"],
      ["agent_reply", null],
    ]);
    for (const db of [asDb(admin.client), asDb(reception.client), asDb(professional.client), bot]) {
      await expect(listLatestWhatsappMessages(db, clinic)).rejects.toThrow();
    }
  });
});
