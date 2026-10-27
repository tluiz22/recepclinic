import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { countAwaitingClinic, giveBackToBot, listHumanAttention } from "../../src/lib/data/whatsapp/attention";
import { getConversation, handleAgentEcho, pauseForHuman } from "../../src/lib/data/whatsapp/conversations";
import { recordAgentEcho, recordInboundMessage } from "../../src/lib/data/whatsapp/messages";
import { addMember, adminClient, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, type TestUser } from "./helpers";

// F8.5a — Atendimento humano: motivo e início da pausa, a lista "Aguardando a
// clínica" / "Em atendimento", quem vê e o "Devolver ao bot".

const asDb = (client: unknown) => client as DbClient;
const at = (iso: string) => new Date(`${iso}-03:00`);
const TZ = "America/Sao_Paulo";
const stamp = Date.now();
let seq = 0;
const wamid = () => `wamid.ah${stamp}.${++seq}`;
const wa = (e164: string) => e164.slice(1);

const PHONE_REQUESTED = "+5584977720001";
const PHONE_TOOK_OVER = "+5584977720002";
const PHONE_WROTE_AGAIN = "+5584977720003";

let clinic: string;
let other: string;
let bot: DbClient;
let professional: TestUser;
let outsider: TestUser;

const inbound = (phone: string, body: string, when: Date) =>
  recordInboundMessage(bot, clinic, { id: wamid(), from: wa(phone), type: "text", text: { body } }, when);
const agent = async (phone: string, body: string, when: Date) => {
  const echo = { id: wamid(), to: wa(phone), type: "text", text: { body } };
  await recordAgentEcho(bot, clinic, echo, when);
  return handleAgentEcho(bot, clinic, echo, null, when);
};

beforeAll(async () => {
  clinic = await createClinic("Clínica (atendimento humano)");
  other = await createClinic("Outra clínica (atendimento humano)");
  [professional, outsider] = await Promise.all([createUser("ah-prof"), createUser("ah-fora")]);
  await addMember(clinic, professional.id, ["professional"]);
  await addMember(other, outsider.id, ["admin"]);
  bot = asDb(clinicServiceClient(clinic));
  await adminClient().from("clinic_settings").update({ timezone: TZ }).eq("clinic_id", clinic);
  const { error } = await adminClient().from("contacts").insert({ clinic_id: clinic, full_name: "Maria Souza", phone: PHONE_REQUESTED });
  if (error) throw error;

  // Terça, 11/03/2031.
  // Pediu para falar com a clínica às 10h e ninguém respondeu.
  await inbound(PHONE_REQUESTED, "Falar com a recepção", at("2031-03-11T10:00:00"));
  await pauseForHuman(bot, clinic, PHONE_REQUESTED, { contactId: null, reason: "requested" }, at("2031-03-11T10:00:01"));
  // A recepção assumiu pelo app às 9h30 e escreveu de novo às 9h45.
  await inbound(PHONE_TOOK_OVER, "Bom dia", at("2031-03-11T09:00:00"));
  await agent(PHONE_TOOK_OVER, "Bom dia! Como posso ajudar?", at("2031-03-11T09:30:00"));
  await agent(PHONE_TOOK_OVER, "Pode vir às 14h.", at("2031-03-11T09:45:00"));
  // Sem horário livre às 8h; a clínica respondeu às 8h10 e a paciente escreveu de novo às 8h20.
  await pauseForHuman(bot, clinic, PHONE_WROTE_AGAIN, { contactId: null, reason: "no_availability" }, at("2031-03-11T08:00:00"));
  await agent(PHONE_WROTE_AGAIN, "Vou ver um encaixe.", at("2031-03-11T08:10:00"));
  await inbound(PHONE_WROTE_AGAIN, "Obrigada, aguardo", at("2031-03-11T08:20:00"));
});

afterAll(async () => {
  await deleteClinics([clinic, other]);
  await deleteUsers([professional, outsider]);
});

describe("atendimento humano (F8.5a)", () => {
  it("a pausa guarda o motivo e o início; a recepção escrevendo de novo só renova o prazo", async () => {
    const { data } = await adminClient()
      .from("conversation_state")
      .select("contact_phone, handoff_reason, handoff_started_at, human_handoff_at")
      .eq("clinic_id", clinic)
      .order("contact_phone");
    expect(data!.map((r) => [r.contact_phone, r.handoff_reason, new Date(r.handoff_started_at!).toISOString(), new Date(r.human_handoff_at!).toISOString()])).toEqual([
      [PHONE_REQUESTED, "requested", at("2031-03-11T10:00:01").toISOString(), at("2031-03-11T10:00:01").toISOString()],
      [PHONE_TOOK_OVER, "agent_took_over", at("2031-03-11T09:30:00").toISOString(), at("2031-03-11T09:45:00").toISOString()],
      [PHONE_WROTE_AGAIN, "no_availability", at("2031-03-11T08:00:00").toISOString(), at("2031-03-11T08:10:00").toISOString()],
    ]);
  });

  it("lista: aguardando (a mais antiga primeiro) e em atendimento, para o Profissional também", async () => {
    const now = at("2031-03-11T10:30:00");
    const items = await listHumanAttention(asDb(professional.client), clinic, TZ, now);
    expect(items.map((i) => [i.phone, i.status, i.name, i.reason, i.waitingSince?.toISOString() ?? null])).toEqual([
      [PHONE_WROTE_AGAIN, "waiting", null, "no_availability", at("2031-03-11T08:20:00").toISOString()],
      [PHONE_REQUESTED, "waiting", "Maria Souza", "requested", at("2031-03-11T10:00:01").toISOString()],
      [PHONE_TOOK_OVER, "in_progress", null, "agent_took_over", null],
    ]);
    expect(items[1].lastPatientMessage).toEqual({ body: "Falar com a recepção", at: at("2031-03-11T10:00:00") });
    expect(items[2].lastAgentAt).toEqual(at("2031-03-11T09:45:00"));
    // O bot volta sozinho 24h depois da última mensagem da recepção (dia útil).
    expect(items[2].deadline).toEqual(at("2031-03-12T09:45:00"));
    expect(await countAwaitingClinic(asDb(professional.client), clinic, TZ, now)).toBe(2);
  });

  it("outra clínica não vê nada", async () => {
    expect(await listHumanAttention(asDb(outsider.client), clinic, TZ, at("2031-03-11T10:30:00"))).toEqual([]);
  });

  it("pausa vencida sai da lista", async () => {
    const items = await listHumanAttention(asDb(professional.client), clinic, TZ, at("2031-03-12T10:00:01"));
    expect(items.map((i) => i.phone)).toEqual([]);
  });

  it("Devolver ao bot: a conversa volta ao bot e sai da lista; de novo, já tinha voltado", async () => {
    const db = asDb(professional.client);
    expect(await giveBackToBot(db, clinic, PHONE_TOOK_OVER)).toBe(true);
    expect(await getConversation(bot, clinic, PHONE_TOOK_OVER)).toMatchObject({ humanHandoff: false, state: "WELCOME" });
    const { data } = await adminClient()
      .from("conversation_state")
      .select("handoff_reason, handoff_started_at")
      .eq("clinic_id", clinic)
      .eq("contact_phone", PHONE_TOOK_OVER)
      .single();
    expect(data).toEqual({ handoff_reason: null, handoff_started_at: null });
    expect(await giveBackToBot(db, clinic, PHONE_TOOK_OVER)).toBe(false);
    const items = await listHumanAttention(db, clinic, TZ, at("2031-03-11T10:30:00"));
    expect(items.map((i) => i.phone)).not.toContain(PHONE_TOOK_OVER);
  });

  it("login de outra clínica não devolve conversa daqui", async () => {
    expect(await giveBackToBot(asDb(outsider.client), clinic, PHONE_REQUESTED)).toBe(false);
    expect(await getConversation(bot, clinic, PHONE_REQUESTED)).toMatchObject({ humanHandoff: true });
  });

  it("pausa nova depois da volta ao bot começa com o motivo novo", async () => {
    await pauseForHuman(bot, clinic, PHONE_TOOK_OVER, { contactId: null, reason: "bot_limit" }, at("2031-03-11T11:00:00"));
    const { data } = await adminClient()
      .from("conversation_state")
      .select("handoff_reason, handoff_started_at")
      .eq("clinic_id", clinic)
      .eq("contact_phone", PHONE_TOOK_OVER)
      .single();
    expect(data!.handoff_reason).toBe("bot_limit");
    expect(new Date(data!.handoff_started_at!)).toEqual(at("2031-03-11T11:00:00"));
  });
});
