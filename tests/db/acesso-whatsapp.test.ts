import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import {
  getApprovedTemplate,
  getSendingSetup,
  getWhatsappConnection,
  listWhatsappTemplates,
  saveWhatsappConnection,
  saveWhatsappTemplate,
  setWhatsappAccessToken,
} from "../../src/lib/data/whatsapp/connection";
import {
  checkHandoff,
  getConversation,
  handleAgentEcho,
  logAbandonment,
  openConversation,
  pauseForHuman,
  setConversationState,
  startFunnel,
} from "../../src/lib/data/whatsapp/conversations";
import { logWebFunnelEvent } from "../../src/lib/data/whatsapp/funnel";
import {
  isCustomerServiceWindowOpen,
  listWhatsappMessages,
  recordAgentEcho,
  recordInboundMessage,
  recordOutboundMessage,
  updateDeliveryStatus,
} from "../../src/lib/data/whatsapp/messages";
import {
  addMember,
  adminClient,
  clinicServiceClient,
  createClinic,
  createUser,
  deleteClinics,
  deleteUsers,
  makePlatformStaff,
  type TestUser,
} from "./helpers";

// F3.9a — conexão e templates, mensagens, conversa, pausa da recepção e funil
// pela camada de acesso, com a credencial da clínica (bot) e os logins.

const asDb = (client: unknown) => client as DbClient;
const at = (iso: string) => new Date(`${iso}-03:00`);

let clinicA: string;
let clinicB: string;
let clinicNoBot: string;
let admin: TestUser;
let reception: TestUser;
let support: TestUser;
let botA: DbClient;
let botB: DbClient;
let botNoBot: DbClient;
let contactA: string;
const stamp = Date.now();
const PHONE_KNOWN = "+5584977710001";
const PHONE_NEW = "+5584977710002";
const wa = (e164: string) => e164.slice(1);
let seq = 0;
const wamid = () => `wamid.t${stamp}.${++seq}`;

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "erro";
  }
}

const funnelOf = async (clinicId: string, phone: string) => {
  const { data } = await adminClient()
    .from("bot_funnel_events")
    .select("session_id, flow, step, source, metadata")
    .eq("clinic_id", clinicId)
    .eq("contact_phone", phone)
    .order("id");
  return data!;
};

beforeAll(async () => {
  clinicA = await createClinic("Clínica A (camada do WhatsApp)");
  clinicB = await createClinic("Clínica B (camada do WhatsApp)");
  clinicNoBot = await createClinic("Clínica sem bot (camada do WhatsApp)", ["reminders"]);
  [admin, reception, support] = await Promise.all([createUser("wa-admin"), createUser("wa-recep"), createUser("wa-suporte")]);
  await addMember(clinicA, admin.id, ["admin"]);
  await addMember(clinicA, reception.id, ["reception"]);
  await makePlatformStaff(support.id);
  botA = asDb(clinicServiceClient(clinicA));
  botB = asDb(clinicServiceClient(clinicB));
  botNoBot = asDb(clinicServiceClient(clinicNoBot));

  const { data, error } = await adminClient()
    .from("contacts")
    .insert({ clinic_id: clinicA, full_name: "Maria", phone: PHONE_KNOWN })
    .select("id")
    .single();
  if (error) throw error;
  contactA = data.id;
});

afterAll(async () => {
  await deleteClinics([clinicA, clinicB, clinicNoBot]);
  await deleteUsers([admin, reception, support]);
});

describe("conexão e templates", () => {
  it("o Suporte cadastra conexão e token; a equipe vê a situação; o bot monta o envio", async () => {
    expect(await getSendingSetup(botA, clinicA)).toBeNull();
    await saveWhatsappConnection(asDb(support.client), clinicA, {
      phoneNumberId: `pn-${stamp}`,
      wabaId: "waba-1",
      displayPhone: "+55 84 3000-0000",
      status: "pending",
    });
    await setWhatsappAccessToken(asDb(support.client), clinicA, "token-secreto");
    // Pendente ainda não envia.
    expect(await getSendingSetup(botA, clinicA)).toBeNull();

    const now = at("2031-03-10T09:00:00");
    await saveWhatsappConnection(asDb(support.client), clinicA, { phoneNumberId: `pn-${stamp}`, wabaId: "waba-1", status: "connected" }, now);
    expect(await getWhatsappConnection(asDb(reception.client), clinicA)).toMatchObject({ status: "connected", connectedAt: now });
    expect(await getSendingSetup(botA, clinicA)).toEqual({ phoneNumberId: `pn-${stamp}`, accessToken: "token-secreto" });
    // O bot de outra clínica não vê a conexão nem o token desta.
    expect(await getWhatsappConnection(botB, clinicA)).toBeNull();
    expect(await getSendingSetup(botB, clinicB)).toBeNull();
  });

  it("só o Suporte grava conexão, token e templates", async () => {
    expect(await codeOf(() => saveWhatsappConnection(asDb(admin.client), clinicA, { phoneNumberId: "x", wabaId: "y", status: "connected" }))).toBe("forbidden");
    expect(await codeOf(() => setWhatsappAccessToken(asDb(admin.client), clinicA, "outro"))).toBe("forbidden");
    expect(await codeOf(() => saveWhatsappTemplate(asDb(admin.client), clinicA, { key: "reminder", name: "lembrete", status: "approved" }))).toBe("forbidden");
    expect(await codeOf(() => saveWhatsappConnection(asDb(support.client), clinicA, { phoneNumberId: " ", wabaId: "", status: "connected" }))).toBe("invalid");
  });

  it("o bot só usa template aprovado", async () => {
    await saveWhatsappTemplate(asDb(support.client), clinicA, { key: "reminder", name: "rc_lembrete", status: "pending" });
    expect(await getApprovedTemplate(botA, clinicA, "reminder")).toBeNull();
    await saveWhatsappTemplate(asDb(support.client), clinicA, { key: "reminder", name: "rc_lembrete_v2", status: "approved" });
    expect(await getApprovedTemplate(botA, clinicA, "reminder")).toEqual({ name: "rc_lembrete_v2", language: "pt_BR", body: null });
    expect(await listWhatsappTemplates(asDb(reception.client), clinicA)).toEqual([
      expect.objectContaining({ key: "reminder", name: "rc_lembrete_v2", status: "approved" }),
    ]);
    expect(await getApprovedTemplate(botB, clinicA, "reminder")).toBeNull();
  });
});

describe("mensagens", () => {
  it("recebida: com telefone e contato; repetida pela Meta não entra de novo", async () => {
    const id = wamid();
    const msg = { id, from: wa(PHONE_KNOWN), type: "text", text: { body: "Oi" } };
    const first = await recordInboundMessage(botA, clinicA, msg);
    expect(first).toMatchObject({ recorded: true, contactId: contactA });
    expect(await recordInboundMessage(botA, clinicA, msg)).toEqual({ recorded: false, reason: "duplicate" });

    const unknown = await recordInboundMessage(botA, clinicA, { id: wamid(), from: wa(PHONE_NEW), type: "text", text: { body: "Olá" } });
    expect(unknown).toMatchObject({ recorded: true, contactId: null });
    expect(await recordInboundMessage(botA, clinicA, { id: wamid(), from: "abc", type: "text" })).toEqual({
      recorded: false,
      reason: "invalid_phone",
    });
  });

  it("janela de 24h por número, inclusive de quem ainda não é contato", async () => {
    const now = at("2031-03-10T10:00:00");
    const phone = "+5584977710003";
    expect(await isCustomerServiceWindowOpen(botA, clinicA, phone, now)).toBe(false);
    await recordInboundMessage(botA, clinicA, { id: wamid(), from: wa(phone), type: "text", text: { body: "Oi" } }, at("2031-03-09T11:00:00"));
    expect(await isCustomerServiceWindowOpen(botA, clinicA, phone, now)).toBe(true);
    // Depois de 23h30 da última mensagem, fechada (margem sobre as 24h da Meta).
    expect(await isCustomerServiceWindowOpen(botA, clinicA, phone, at("2031-03-10T10:31:00"))).toBe(false);
    // Mensagem enviada não abre a janela.
    await recordOutboundMessage(botA, clinicA, { phone, messageType: "bot_menu", status: "sent", waMessageId: wamid() }, now);
    expect(await isCustomerServiceWindowOpen(botA, clinicA, phone, at("2031-03-10T10:31:00"))).toBe(false);
  });

  it("situação da entrega não regride, e a chegada ao celular é vista uma vez só", async () => {
    const id = wamid();
    await recordOutboundMessage(botA, clinicA, { phone: PHONE_KNOWN, messageType: "reminder", templateName: "rc_lembrete_v2", status: "sent", waMessageId: id });
    const read = await updateDeliveryStatus(botA, clinicA, id, "read");
    expect(read).toMatchObject({ updated: true, reachedPhone: true, message: { messageType: "reminder", contactId: contactA, phone: PHONE_KNOWN } });
    // "Entregue" chegando depois de "lida" não muda nada.
    expect(await updateDeliveryStatus(botA, clinicA, id, "delivered")).toEqual({ updated: false });
    expect(await updateDeliveryStatus(botA, clinicA, id, "read")).toEqual({ updated: false });
    const [message] = await listWhatsappMessages(asDb(reception.client), clinicA, { contactId: contactA }, 1);
    expect(message).toMatchObject({ status: "read", direction: "outbound", phone: PHONE_KNOWN });
  });

  it("duas situações ao mesmo tempo: só uma vê a chegada ao celular", async () => {
    const id = wamid();
    await recordOutboundMessage(botA, clinicA, { phone: PHONE_KNOWN, messageType: "confirmation", status: "sent", waMessageId: id });
    const results = await Promise.all([updateDeliveryStatus(botA, clinicA, id, "delivered"), updateDeliveryStatus(botA, clinicA, id, "read")]);
    expect(results.filter((r) => r.updated && r.reachedPhone)).toHaveLength(1);
  });

  it("situação de mensagem que não é nossa (ou de outra clínica) é ignorada", async () => {
    const waits: number[] = [];
    const wait = async (ms: number) => void waits.push(ms);
    const id = wamid();
    await recordOutboundMessage(botA, clinicA, { phone: PHONE_KNOWN, messageType: "confirmation", status: "sent", waMessageId: id });
    expect(await updateDeliveryStatus(botB, clinicB, id, "delivered", { wait })).toEqual({ updated: false });
    // Esperou a gravação duas vezes antes de desistir (piloto).
    expect(waits).toEqual([1500, 1500]);
    expect(await updateDeliveryStatus(botA, clinicA, id, "enviando")).toEqual({ updated: false });
  });

  it("o bot de outra clínica não lê as mensagens desta", async () => {
    expect(await listWhatsappMessages(botB, clinicA, { contactId: contactA })).toEqual([]);
    expect(await isCustomerServiceWindowOpen(botB, clinicA, PHONE_KNOWN)).toBe(false);
  });
});

describe("conversa e funil", () => {
  it("abre na primeira mensagem, liga o contato depois e grava os passos da tentativa", async () => {
    const phone = "+5584977710010";
    const conversation = await openConversation(botA, clinicA, phone, null);
    expect(conversation).toMatchObject({ state: "WELCOME", contactId: null, humanHandoff: false });

    const { data } = await adminClient().from("contacts").insert({ clinic_id: clinicA, full_name: "Carla", phone }).select("id").single();
    expect((await openConversation(botA, clinicA, phone, data!.id)).contactId).toBe(data!.id);

    await setConversationState(botA, clinicA, phone, "MENU");
    const session = await startFunnel(botA, clinicA, phone, "booking", { origin: "menu" });
    await setConversationState(botA, clinicA, phone, "BOOK_PATIENT_SELECT", { context: { step: 1 } });
    await logWebFunnelEvent(botA, clinicA, { funnelSessionId: session, contactPhone: phone, contactId: data!.id, mode: "create", serviceCategory: "consultation" }, "page_opened");
    const ended = await setConversationState(botA, clinicA, phone, "WELCOME", { context: {} });
    expect(ended).toMatchObject({ funnelSessionId: null, funnelFlow: null, state: "WELCOME" });

    expect(await funnelOf(clinicA, phone)).toEqual([
      { session_id: session, flow: "booking", step: "started", source: "bot", metadata: { origin: "menu" } },
      { session_id: session, flow: "booking", step: "BOOK_PATIENT_SELECT", source: "bot", metadata: {} },
      { session_id: session, flow: "booking", step: "page_opened", source: "web", metadata: {} },
    ]);
  });

  it("abandono por tempo grava o motivo e o último estado", async () => {
    const phone = "+5584977710011";
    await openConversation(botA, clinicA, phone, null);
    const session = await startFunnel(botA, clinicA, phone, "exam");
    const conversation = await setConversationState(botA, clinicA, phone, "EXAM_SELECT");
    await logAbandonment(botA, clinicA, conversation, "timeout");
    expect((await funnelOf(clinicA, phone)).at(-1)).toEqual({
      session_id: session,
      flow: "exam",
      step: "abandoned",
      source: "bot",
      metadata: { reason: "timeout", last_step: "EXAM_SELECT" },
    });
  });

  it("a equipe lê a conversa; o bot de outra clínica, não", async () => {
    expect(await getConversation(asDb(reception.client), clinicA, "+5584977710010")).not.toBeNull();
    expect(await getConversation(botB, clinicA, "+5584977710010")).toBeNull();
  });
});

describe("pausa da recepção", () => {
  it("o eco da recepção pausa no meio da tentativa (abandono) e conta o início da pausa uma vez", async () => {
    const phone = "+5584977710020";
    await openConversation(botA, clinicA, phone, null);
    const session = await startFunnel(botA, clinicA, phone, "cancel");
    await setConversationState(botA, clinicA, phone, "CANCEL_SELECT");

    const t1 = at("2031-03-11T10:00:00"); // terça
    const echo = { id: wamid(), to: wa(phone), type: "text", text: { body: "Oi, aqui é a recepção" } };
    expect(await recordAgentEcho(botA, clinicA, echo, t1)).toMatchObject({ recorded: true });
    expect(await recordAgentEcho(botA, clinicA, echo, t1)).toEqual({ recorded: false, reason: "duplicate" });
    expect(await handleAgentEcho(botA, clinicA, echo, null, t1)).toBe("paused");
    // Segunda mensagem dela só renova o prazo.
    const t2 = at("2031-03-11T15:00:00");
    await handleAgentEcho(botA, clinicA, { id: wamid(), to: wa(phone), type: "text", text: { body: "Pode vir amanhã" } }, null, t2);

    const conversation = (await getConversation(botA, clinicA, phone))!;
    expect(conversation).toMatchObject({ state: "HUMAN_HANDOFF", humanHandoff: true, humanHandoffAt: t2, funnelSessionId: null });
    const funnel = await funnelOf(clinicA, phone);
    expect(funnel.filter((e) => e.flow === "handoff")).toEqual([
      expect.objectContaining({ step: "agent_took_over", metadata: { mid_journey: true, journey_flow: "cancel" } }),
    ]);
    expect(funnel).toContainEqual(
      expect.objectContaining({ session_id: session, step: "abandoned", metadata: { reason: "secretary_took_over", last_step: "CANCEL_SELECT" } }),
    );

    // Antes do prazo (quarta 15h), o bot fica calado; depois, volta do começo.
    expect(await checkHandoff(botA, clinicA, conversation, at("2031-03-12T14:59:00"))).toBe("paused");
    expect(await checkHandoff(botA, clinicA, conversation, at("2031-03-12T15:00:00"))).toBe("resumed");
    expect(await getConversation(botA, clinicA, phone)).toMatchObject({ state: "WELCOME", humanHandoff: false, humanHandoffAt: null });
  });

  it("o prazo pula o feriado próprio da clínica e o fim de semana", async () => {
    const phone = "+5584977710021";
    await adminClient().from("clinic_holidays").insert({ clinic_id: clinicA, date: "2031-03-14", description: "Aniversário da cidade" });
    // Quinta 9h → sexta (feriado da clínica), sábado, domingo → segunda 9h.
    await pauseForHuman(botA, clinicA, phone, { contactId: null, reason: "requested" }, at("2031-03-13T09:00:00"));
    const conversation = (await getConversation(botA, clinicA, phone))!;
    expect(await checkHandoff(botA, clinicA, conversation, at("2031-03-16T20:00:00"))).toBe("paused");
    expect(await checkHandoff(botA, clinicA, conversation, at("2031-03-17T09:00:00"))).toBe("resumed");
    expect((await funnelOf(clinicA, phone)).map((e) => [e.flow, e.step])).toEqual([["handoff", "requested"]]);
  });

  it("#bot da recepção devolve a conversa antes do prazo; número novo já nasce pausado", async () => {
    const phone = "+5584977710022";
    expect(await handleAgentEcho(botA, clinicA, { id: wamid(), to: wa(phone), type: "text", text: { body: "Olá!" } }, null)).toBe("paused");
    expect(await getConversation(botA, clinicA, phone)).toMatchObject({ humanHandoff: true, state: "HUMAN_HANDOFF" });
    expect(await handleAgentEcho(botA, clinicA, { id: wamid(), to: wa(phone), type: "text", text: { body: "#bot" } }, null)).toBe("returned_to_bot");
    expect(await getConversation(botA, clinicA, phone)).toMatchObject({ humanHandoff: false, state: "WELCOME" });
  });
});

describe("matriz de acesso (D11)", () => {
  it("sem o bot liberado: mensagens são registradas, mas não há conversa nem funil", async () => {
    const phone = "+5584977710030";
    expect(await recordInboundMessage(botNoBot, clinicNoBot, { id: wamid(), from: wa(phone), type: "button", button: { text: "Confirmar presença" } })).toMatchObject({
      recorded: true,
    });
    expect(await codeOf(() => openConversation(botNoBot, clinicNoBot, phone, null))).toBe("not_enabled");
    expect(await codeOf(() => pauseForHuman(botNoBot, clinicNoBot, phone, { contactId: null, reason: "agent_took_over" }))).toBe("not_enabled");
    const { count } = await adminClient().from("bot_funnel_events").select("id", { count: "exact", head: true }).eq("clinic_id", clinicNoBot);
    expect(count).toBe(0);
  });
});
