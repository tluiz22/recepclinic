import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { listHumanAttention } from "../../src/lib/data/whatsapp/attention";
import { pauseForHuman } from "../../src/lib/data/whatsapp/conversations";
import { listWhatsappMessages, recordInboundMessage, recordOutboundMessage } from "../../src/lib/data/whatsapp/messages";
import { addMember, adminClient, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";

// CRM B0, passo 1: o texto das mensagens pelas funções que conferem o papel.
// Histórico: Administrador, Recepção e Suporte. Atendimento: qualquer membro,
// só das conversas pausadas. Outra clínica: nada.

const asDb = (client: unknown) => client as DbClient;
const at = (iso: string) => new Date(`${iso}-03:00`);
const TZ = "America/Sao_Paulo";
const stamp = Date.now();
let seq = 0;
const wamid = () => `wamid.b0${stamp}.${++seq}`;
const wa = (e164: string) => e164.slice(1);

const PHONE_CONTACT = "+5584977730001";
const PHONE_PAUSED = "+5584977730002";
const PHONE_OTHER = "+5584977730003";

let clinic: string;
let other: string;
let contactId: string;
let bot: DbClient;
let admin: TestUser;
let reception: TestUser;
let professional: TestUser;
let support: TestUser;
let outsider: TestUser;

const history = (user: TestUser, args: { p_contact_id: string | null; p_before?: string; p_limit?: number }) =>
  asDb(user.client).rpc("contact_message_history", { p_clinic_id: clinic, ...args } as never);

beforeAll(async () => {
  clinic = await createClinic("Clínica (mensagens por função)");
  other = await createClinic("Outra clínica (mensagens por função)");
  [admin, reception, professional, support, outsider] = await Promise.all(
    ["b0-adm", "b0-rec", "b0-prof", "b0-sup", "b0-fora"].map((label) => createUser(label)),
  );
  await addMember(clinic, admin.id, ["admin"]);
  await addMember(clinic, reception.id, ["reception"]);
  await addMember(clinic, professional.id, ["professional"]);
  await addMember(other, outsider.id, ["admin"]);
  await makePlatformStaff(support.id);
  bot = asDb(clinicServiceClient(clinic));
  await adminClient().from("clinic_settings").update({ timezone: TZ }).eq("clinic_id", clinic);

  // Mensagem sem contato ligado, do telefone que depois vira contato.
  await recordInboundMessage(bot, clinic, { id: wamid(), from: wa(PHONE_CONTACT), type: "text", text: { body: "Antes do cadastro" } }, at("2031-03-10T09:00:00"));
  const { data, error } = await adminClient().from("contacts").insert({ clinic_id: clinic, full_name: "Joana", phone: PHONE_CONTACT }).select("id").single();
  if (error) throw error;
  contactId = data.id;
  for (let i = 0; i < 55; i++) {
    await recordOutboundMessage(bot, clinic, { phone: PHONE_CONTACT, contactId, messageType: "bot_menu", body: `Menu ${i}`, status: "sent", waMessageId: wamid() }, new Date(at("2031-03-10T10:00:00").getTime() + i * 60_000));
  }
  await recordInboundMessage(bot, clinic, { id: wamid(), from: wa(PHONE_OTHER), type: "text", text: { body: "De outra pessoa" } }, at("2031-03-10T09:30:00"));

  // Conversa pausada: o paciente pediu a clínica; o bot também tinha respondido.
  await recordOutboundMessage(bot, clinic, { phone: PHONE_PAUSED, messageType: "bot_menu", body: "Menu do bot", status: "sent", waMessageId: wamid() }, at("2031-03-11T09:59:00"));
  await recordInboundMessage(bot, clinic, { id: wamid(), from: wa(PHONE_PAUSED), type: "text", text: { body: "Quero falar com alguém" } }, at("2031-03-11T10:00:00"));
  await pauseForHuman(bot, clinic, PHONE_PAUSED, { contactId: null, reason: "requested" }, at("2031-03-11T10:00:01"));
});

afterAll(async () => {
  await deleteClinics([clinic, other]);
  await deleteUsers([admin, reception, professional, support, outsider]);
});

describe("histórico das mensagens (contact_message_history)", () => {
  it("Administrador, Recepção e Suporte leem; o Profissional e outra clínica recebem erro de acesso", async () => {
    for (const user of [admin, reception, support]) {
      const { data, error } = await history(user, { p_contact_id: contactId, p_limit: 1 });
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    }
    for (const user of [professional, outsider]) {
      const { data, error } = await history(user, { p_contact_id: contactId });
      expect(data).toBeNull();
      expect(error).toMatchObject({ code: "42501" });
    }
  });

  it("o bot não chama o histórico", async () => {
    const { error } = await bot.rpc("contact_message_history", { p_clinic_id: clinic, p_contact_id: contactId });
    expect(error).not.toBeNull();
  });

  it("do contato: as dele e as do telefone dele sem contato ligado; no máximo 50, com o \"Carregar mais\"", async () => {
    const { data: first } = await history(reception, { p_contact_id: contactId, p_limit: 500 });
    expect(first).toHaveLength(50);
    expect(first![0].body).toBe("Menu 54");
    const { data: rest } = await history(reception, { p_contact_id: contactId, p_before: first![49].created_at });
    expect(rest!.map((m) => m.body)).toEqual(["Menu 4", "Menu 3", "Menu 2", "Menu 1", "Menu 0", "Antes do cadastro"]);
    expect([...first!, ...rest!].map((m) => m.body)).not.toContain("De outra pessoa");
  });

  it("sem contato: as últimas da clínica (Configurações › WhatsApp)", async () => {
    const latest = await listWhatsappMessages(asDb(support.client), clinic, { latest: true }, 3);
    expect(latest.map((m) => m.body)).toEqual(["Quero falar com alguém", "Menu do bot", "Menu 54"]);
    await expect(listWhatsappMessages(asDb(professional.client), clinic, { latest: true })).rejects.toThrow();
  });
});

describe("última mensagem do Atendimento (attention_last_messages)", () => {
  const args = (phones: string[]) => ({ p_clinic_id: clinic, p_phones: phones, p_since: at("2031-03-01T00:00:00").toISOString() });

  it("qualquer membro e o bot leem, só da conversa pausada e sem as mensagens do bot", async () => {
    for (const db of [asDb(professional.client), asDb(reception.client), bot]) {
      const { data, error } = await db.rpc("attention_last_messages", args([PHONE_PAUSED, PHONE_CONTACT]));
      expect(error).toBeNull();
      expect(data!.map((m) => [m.contact_phone, m.body])).toEqual([[PHONE_PAUSED, "Quero falar com alguém"]]);
    }
  });

  it("outra clínica e o bot de outra clínica recebem a lista vazia", async () => {
    const { data } = await asDb(outsider.client).rpc("attention_last_messages", args([PHONE_PAUSED]));
    expect(data).toEqual([]);
    const { data: fromOtherBot } = await asDb(clinicServiceClient(other)).rpc("attention_last_messages", args([PHONE_PAUSED]));
    expect(fromOtherBot).toEqual([]);
  });

  it("a tela Atendimento continua mostrando a última mensagem ao Profissional", async () => {
    const [item] = await listHumanAttention(asDb(professional.client), clinic, TZ, at("2031-03-11T10:30:00"));
    expect(item).toMatchObject({ phone: PHONE_PAUSED, status: "waiting", lastPatientMessage: { body: "Quero falar com alguém", at: at("2031-03-11T10:00:00") } });
  });
});
