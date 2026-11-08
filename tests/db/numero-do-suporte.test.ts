import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import type { DbClient } from "../../src/lib/data/clients";
import { resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import { getSupportWhatsapp, setSupportWhatsapp } from "../../src/lib/data/platformSettings";
import { listHumanAttention } from "../../src/lib/data/whatsapp/attention";
import { getConversation, pauseForHuman } from "../../src/lib/data/whatsapp/conversations";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { addMember, adminClient, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";

// 01/nov/2026 — WhatsApp do suporte do RecepClinic: a conversa dele com o
// WhatsApp da clínica não pausa o bot nem entra em Atendimento.

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
const SUPPORT = "+5584900000099";
const OTHER = "+5584900000098";
const NUMBER = "sup-numero-a";

let clinic: string;
let staff: TestUser;
let admin: TestUser;
const bot = () => clinicServiceClient(clinic) as unknown as DbClient;
const echo = (id: string, to: string) => ({
  entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: NUMBER }, message_echoes: [{ id, to: to.slice(1), type: "text", text: { body: "Oi" } }] } }] }],
});

beforeAll(async () => {
  clinic = await createClinic("Clínica (suporte)", ["portal", "whatsapp_bot"]);
  await adminClient().from("clinics").update({ status: "active" }).eq("id", clinic);
  await adminClient().from("whatsapp_connections").insert({ clinic_id: clinic, phone_number_id: NUMBER, waba_id: "waba-sup", status: "connected" });
  [staff, admin] = await Promise.all([createUser("sup-staff"), createUser("sup-admin")]);
  await makePlatformStaff(staff.id);
  await addMember(clinic, admin.id, ["admin"]);
  await adminClient().from("platform_settings").update({ support_whatsapp: SUPPORT }).eq("id", true);
});

afterAll(async () => {
  await adminClient().from("platform_settings").update({ support_whatsapp: null }).eq("id", true);
  await deleteClinics([clinic]);
  await deleteUsers([staff, admin]);
});

describe("WhatsApp do suporte", () => {
  it("a clínica lê o número; o Administrador da clínica não grava, o Suporte grava", async () => {
    expect(await getSupportWhatsapp(bot())).toBe(SUPPORT);
    expect(await setSupportWhatsapp(bot(), "(84) 98888-7777", admin.id).catch(() => "negado")).not.toBe(true);
    expect(await getSupportWhatsapp(bot())).toBe(SUPPORT);
  });

  it("número inválido não é salvo", async () => {
    expect(await setSupportWhatsapp(adminClient() as unknown as DbClient, "123", staff.id)).toBe(false);
  });

  it("a recepção responder ao suporte pelo app não pausa o bot; a outro número, pausa", async () => {
    await processWebhook(echo("wamid.sup.1", SUPPORT), deps);
    expect(await getConversation(bot(), clinic, SUPPORT)).toBeNull();
    await processWebhook(echo("wamid.sup.2", OTHER), deps);
    expect((await getConversation(bot(), clinic, OTHER))?.humanHandoff).toBe(true);
  });

  it("conversa do suporte nunca aparece em Atendimento", async () => {
    await pauseForHuman(bot(), clinic, SUPPORT, { contactId: null, reason: "requested" });
    const phones = (await listHumanAttention(bot(), clinic)).map((item) => item.phone);
    expect(phones).toContain(OTHER);
    expect(phones).not.toContain(SUPPORT);
  });
});
