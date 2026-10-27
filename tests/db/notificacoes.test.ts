import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// O serviço de notificações do navegador é simulado: o teste confere quem
// recebe e o que vai, sem rede.
const sendNotification = vi.hoisted(() => vi.fn());
vi.mock("web-push", () => ({ default: { sendNotification } }));

import type { DbClient } from "../../src/lib/data/clients";
import { notifyWaitingConversation, runAttentionRoutine, saveMySubscription, sendTestToMe, type PushContext } from "../../src/lib/data/whatsapp/attentionPush";
import { handleAgentEcho, pauseForHuman } from "../../src/lib/data/whatsapp/conversations";
import { recordAgentEcho, recordInboundMessage } from "../../src/lib/data/whatsapp/messages";
import { addMember, adminClient, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, type TestUser } from "./helpers";

// F8.5c — Notificações do atendimento humano: aparelhos por pessoa, aviso de
// "aguardando", lembrete do "#bot" e resumo ao abrir o horário da recepção.

const asDb = (client: unknown) => client as DbClient;
const at = (iso: string) => new Date(`${iso}-03:00`);
const stamp = Date.now();
let seq = 0;
const wamid = () => `wamid.nt${stamp}.${++seq}`;
const wa = (e164: string) => e164.slice(1);
const push: PushContext = { webPush: { publicKey: "pub", privateKey: "priv" }, subject: "https://teste.local" };
const allDay = { open: "07:00", close: "19:00" };

let clinic: string;
let other: string;
let bot: DbClient;
let reception: TestUser;
let professional: TestUser;
let outsider: TestUser;

const subscription = (n: number) => ({ endpoint: `https://push.teste.local/${stamp}/${n}`, p256dh: `key${n}`, auth: `auth${n}` });
const sentTitles = () => sendNotification.mock.calls.map((call) => JSON.parse(call[1] as string).title as string);
const conversation = async (phone: string) =>
  (await adminClient().from("conversation_state").select("handoff_notified_at, handoff_reminded_at").eq("clinic_id", clinic).eq("contact_phone", phone).single()).data!;

beforeAll(async () => {
  clinic = await createClinic("Clínica (notificações)");
  other = await createClinic("Outra clínica (notificações)");
  [reception, professional, outsider] = await Promise.all([createUser("nt-recep"), createUser("nt-prof"), createUser("nt-fora")]);
  await addMember(clinic, reception.id, ["reception"]);
  await addMember(clinic, professional.id, ["professional"]);
  await addMember(other, outsider.id, ["admin"]);
  bot = asDb(clinicServiceClient(clinic));
  // Recepção aberta das 7h às 19h todos os dias.
  await adminClient()
    .from("clinic_settings")
    .update({ timezone: "America/Sao_Paulo", reception_hours: Array.from({ length: 7 }, () => allDay) })
    .eq("clinic_id", clinic);
});

afterAll(async () => {
  await deleteClinics([clinic, other]);
  await deleteUsers([reception, professional, outsider]);
});

beforeEach(() => {
  sendNotification.mockReset();
  sendNotification.mockResolvedValue({ statusCode: 201 });
});

describe("aparelhos (F8.5c)", () => {
  it("cada pessoa ativa os seus; não vê os dos outros; outra clínica não entra", async () => {
    await saveMySubscription(asDb(reception.client), clinic, reception.id, subscription(1), "iPhone");
    await saveMySubscription(asDb(professional.client), clinic, professional.id, subscription(2), "Chrome no Mac");
    const { data: mine } = await reception.client.from("push_subscriptions").select("device").eq("clinic_id", clinic);
    expect(mine).toEqual([{ device: "iPhone" }]);
    await expect(saveMySubscription(asDb(outsider.client), clinic, outsider.id, subscription(3), "Android")).rejects.toThrow();
  });

  it("Enviar teste vai só para os aparelhos da pessoa", async () => {
    expect(await sendTestToMe(asDb(professional.client), clinic, professional.id, push)).toBe(1);
    expect(sendNotification.mock.calls.map((call) => (call[0] as { endpoint: string }).endpoint)).toEqual([subscription(2).endpoint]);
  });
});

describe("aviso de conversa aguardando (F8.5c)", () => {
  const phone = "+5584977740001";

  it("pediu para falar com a clínica: avisa todos os aparelhos uma vez", async () => {
    await recordInboundMessage(bot, clinic, { id: wamid(), from: wa(phone), type: "text", text: { body: "Quero falar com alguém" } }, at("2031-03-11T10:00:00"));
    await pauseForHuman(bot, clinic, phone, { contactId: null, reason: "requested" }, at("2031-03-11T10:00:01"));
    expect(await notifyWaitingConversation(bot, clinic, phone, push, at("2031-03-11T10:00:02"))).toBe(true);
    expect(sentTitles()).toEqual(["(84) 97774-0001 quer falar com a clínica", "(84) 97774-0001 quer falar com a clínica"]);
    expect(await notifyWaitingConversation(bot, clinic, phone, push, at("2031-03-11T10:03:00"))).toBe(false);
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });

  it("a clínica respondeu e o paciente escreveu de novo: avisa de novo", async () => {
    const echo = { id: wamid(), to: wa(phone), type: "text", text: { body: "Oi! Já vejo." } };
    await recordAgentEcho(bot, clinic, echo, at("2031-03-11T10:05:00"));
    await handleAgentEcho(bot, clinic, echo, null, at("2031-03-11T10:05:00"));
    expect(await notifyWaitingConversation(bot, clinic, phone, push, at("2031-03-11T10:06:00"))).toBe(false);
    await recordInboundMessage(bot, clinic, { id: wamid(), from: wa(phone), type: "text", text: { body: "Obrigada, e o horário?" } }, at("2031-03-11T10:10:00"));
    expect(await notifyWaitingConversation(bot, clinic, phone, push, at("2031-03-11T10:10:01"))).toBe(true);
  });

  it("fora do horário da recepção: não avisa na hora", async () => {
    const late = "+5584977740002";
    await pauseForHuman(bot, clinic, late, { contactId: null, reason: "no_availability" }, at("2031-03-11T21:00:00"));
    expect(await notifyWaitingConversation(bot, clinic, late, push, at("2031-03-11T21:00:01"))).toBe(false);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("aparelho vencido (410) sai da lista", async () => {
    const gone = "+5584977740003";
    sendNotification.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint === subscription(1).endpoint) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      return { statusCode: 201 };
    });
    await pauseForHuman(bot, clinic, gone, { contactId: null, reason: "requested" }, at("2031-03-11T11:00:00"));
    await notifyWaitingConversation(bot, clinic, gone, push, at("2031-03-11T11:00:01"));
    const { data } = await adminClient().from("push_subscriptions").select("endpoint").eq("clinic_id", clinic);
    expect(data!.map((r) => r.endpoint)).toEqual([subscription(2).endpoint]);
  });
});

describe("rotina: resumo da abertura e lembrete do #bot (F8.5c)", () => {
  it("ao abrir o horário: resumo do que chegou fora dele, uma vez por dia", async () => {
    // Quarta, 7h02: a conversa das 21h de terça aguarda e não foi avisada.
    const result = await runAttentionRoutine(bot, clinic, push, at("2031-03-12T07:02:00"));
    expect(result.summary).toBe(true);
    expect(sentTitles()).toEqual(["1 conversa aguardando atendimento humano"]);
    expect((await conversation("+5584977740002")).handoff_notified_at).not.toBeNull();
    sendNotification.mockClear();
    expect((await runAttentionRoutine(bot, clinic, push, at("2031-03-12T07:07:00"))).summary).toBe(false);
  });

  it("em atendimento há 1 hora sem mensagens: lembra do #bot uma vez", async () => {
    const phone = "+5584977740004";
    await pauseForHuman(bot, clinic, phone, { contactId: null, reason: "requested" }, at("2031-03-12T08:00:00"));
    const echo = { id: wamid(), to: wa(phone), type: "text", text: { body: "Pode vir às 14h." } };
    await recordAgentEcho(bot, clinic, echo, at("2031-03-12T08:10:00"));
    await handleAgentEcho(bot, clinic, echo, null, at("2031-03-12T08:10:00"));
    sendNotification.mockClear();
    expect((await runAttentionRoutine(bot, clinic, push, at("2031-03-12T09:05:00"))).reminders).toBe(0);
    expect((await runAttentionRoutine(bot, clinic, push, at("2031-03-12T09:10:00"))).reminders).toBe(1);
    expect(sentTitles()).toEqual(["(84) 97774-0004 segue com a clínica"]);
    expect((await runAttentionRoutine(bot, clinic, push, at("2031-03-12T09:15:00"))).reminders).toBe(0);
  });

  it("sem chaves ou sem aparelhos: não faz nada", async () => {
    expect(await runAttentionRoutine(bot, clinic, null, at("2031-03-12T10:00:00"))).toEqual({ reminders: 0, summary: false });
    expect(await runAttentionRoutine(asDb(clinicServiceClient(other)), other, push, at("2031-03-12T10:00:00"))).toEqual({ reminders: 0, summary: false });
  });
});
