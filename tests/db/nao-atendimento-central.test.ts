import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { countWaitingConversations, listConversationMessages, listConversations, setCentralEnabled } from "../../src/lib/data/central";
import { listHandoffEvents } from "../../src/lib/data/centralPanel";
import { sendFromCentral, type SendDeps } from "../../src/lib/data/centralSend";
import { setConversationClassification } from "../../src/lib/data/whatsapp/conversations";
import type { ClinicSender } from "../../src/lib/data/whatsapp/send";
import { addMember, adminClient, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, type TestUser } from "./helpers";

// NA4 — Conversas que não são atendimento na tela Conversas (Central ligada; telas NA0, cliente, 06/nov/2026): a aba
// "Pessoal e admin." (selo, quem marcou, mensagens novas por pessoa), Abertas e Finalizadas sem esses números, e a
// resposta pelo painel num número marcado sem abrir atendimento.

const WAITING = "+5584955560001"; // pediu a recepção
const FINISHED = "+5584955560002"; // com o bot
let clinicId: string;
let admin: TestUser;
let reception: TestUser;
let professional: TestUser;
const asDb = (user: TestUser) => user.client as unknown as DbClient;
const db = () => adminClient();
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

const sent: { to: string; body: string }[] = [];
const sender = { text: async (to: string, body: string) => (sent.push({ to, body }), { sent: true, messageId: `wamid.na4.${sent.length}` }) } as unknown as ClinicSender;
const deps = (user: TestUser): SendDeps => ({ db: asDb(user), serviceDb: clinicServiceClient(clinicId) as unknown as DbClient, sender });
const phones = (items: { phone: string }[]) => items.map((item) => item.phone);
const conversation = async (phone: string) =>
  (await db().from("conversation_state").select("human_handoff, handoff_status, assigned_to, classification").eq("clinic_id", clinicId).eq("contact_phone", phone).single()).data!;
// minutesAgo null: a hora vem do banco (now()), como a da marcação; com o relógio do Node, uma VM do Docker
// adiantada punha a mensagem "nova" antes da marcação e a contagem dava 0 (falha intermitente).
const inbound = (phone: string, minutesAgo: number | null, body = "Oi") => ({
  clinic_id: clinicId,
  contact_phone: phone,
  direction: "inbound",
  message_type: "text",
  body,
  status: "received",
  ...(minutesAgo === null ? {} : { created_at: at(minutesAgo) }),
});

beforeAll(async () => {
  clinicId = await createClinic("Clínica NA4");
  [admin, reception, professional] = await Promise.all([createUser("na4-admin"), createUser("na4-recepcao"), createUser("na4-prof")]);
  await Promise.all([
    addMember(clinicId, admin.id, ["admin"]),
    addMember(clinicId, reception.id, ["reception"]),
    addMember(clinicId, professional.id, ["professional"]),
  ]);
  await db().from("clinic_members").update({ display_name: "Fernanda Recepção" }).eq("clinic_id", clinicId).eq("user_id", reception.id);
  await setCentralEnabled(asDb(admin), clinicId, true);
  await db().from("whatsapp_messages").insert([inbound(WAITING, 30), inbound(FINISHED, 40)]);
  await db()
    .from("conversation_state")
    .insert([
      { clinic_id: clinicId, contact_phone: WAITING, human_handoff: true, handoff_status: "waiting_clinic", handoff_status_at: at(30), assigned_to: professional.id },
      { clinic_id: clinicId, contact_phone: FINISHED, human_handoff: false },
    ]);
});

afterAll(async () => {
  await deleteClinics([clinicId]);
  await deleteUsers([admin, reception, professional]);
});

describe("NA4: aba Pessoal e admin. na Conversas", () => {
  it("antes: nada na aba nova; as conversas nas Abertas e nas Finalizadas", async () => {
    expect(await listConversations(asDb(reception), clinicId, { classified: true })).toEqual([]);
    expect(phones(await listConversations(asDb(reception), clinicId))).toContain(WAITING);
    expect(phones(await listConversations(asDb(reception), clinicId, { finished: true }))).toContain(FINISHED);
    expect(await countWaitingConversations(asDb(reception), clinicId)).toBe(1);
  });

  it("marcados: saem das Abertas e das Finalizadas, entram na aba nova com o selo, quem marcou e quando", async () => {
    await setConversationClassification(asDb(reception), clinicId, WAITING, "personal");
    await setConversationClassification(asDb(admin), clinicId, FINISHED, "administrative");
    expect(phones(await listConversations(asDb(reception), clinicId))).not.toContain(WAITING);
    expect(phones(await listConversations(asDb(reception), clinicId, { finished: true }))).not.toContain(FINISHED);
    expect(await countWaitingConversations(asDb(reception), clinicId)).toBe(0);
    const items = await listConversations(asDb(reception), clinicId, { classified: true });
    expect(items.map((i) => [i.phone, i.classification, i.open, i.status])).toEqual(
      expect.arrayContaining([
        [WAITING, "personal", false, null],
        [FINISHED, "administrative", false, null],
      ]),
    );
    const personal = items.find((i) => i.phone === WAITING)!;
    expect(personal.classifiedByName).toBe("Fernanda");
    expect(personal.classifiedAt).toBeInstanceOf(Date);
    expect(personal.assignedTo).toBeNull();
  });

  it("o Profissional não vê a aba nova nem a conversa que estava com ele", async () => {
    expect(await listConversations(asDb(professional), clinicId, { classified: true })).toEqual([]);
    expect(phones(await listConversations(asDb(professional), clinicId))).not.toContain(WAITING);
  });

  it("mensagens novas por pessoa: contam depois da marcação e zeram para quem abre a conversa", async () => {
    await db().from("whatsapp_messages").insert([inbound(WAITING, null, "Chego às 19h"), inbound(WAITING, null, "Deixa a chave")]);
    const unread = async (user: TestUser) => (await listConversations(asDb(user), clinicId, { classified: true })).find((i) => i.phone === WAITING)!.unread;
    expect(await unread(reception)).toBe(2);
    expect(await unread(admin)).toBe(2);
    await listConversationMessages(asDb(reception), clinicId, WAITING);
    expect(await unread(reception)).toBe(0);
    expect(await unread(admin)).toBe(2);
  });

  it("responder pelo painel num número marcado: a mensagem sai, sem abrir atendimento nem assumir", async () => {
    const result = await sendFromCentral(deps(reception), clinicId, { phone: WAITING, clientKey: crypto.randomUUID(), body: "Combinado!", expectedAssigned: null });
    expect(result).toEqual({ kind: "sent" });
    expect(sent.at(-1)).toEqual({ to: WAITING, body: "Combinado!" });
    expect(await conversation(WAITING)).toMatchObject({ human_handoff: false, handoff_status: null, assigned_to: null, classification: "personal" });
    expect(phones(await listConversations(asDb(reception), clinicId))).not.toContain(WAITING);
  });

  it("o histórico da conversa mostra a marcação", async () => {
    const events = await listHandoffEvents(asDb(reception), clinicId, WAITING);
    expect(events.at(-1)).toMatchObject({ kind: "classified", classificationFrom: "patient", classificationTo: "personal", actorId: reception.id });
  });

  it("de volta para atendimento: sai da aba nova e volta para as Finalizadas (com o bot)", async () => {
    await setConversationClassification(asDb(reception), clinicId, FINISHED, "patient");
    expect(phones(await listConversations(asDb(reception), clinicId, { classified: true }))).not.toContain(FINISHED);
    expect(phones(await listConversations(asDb(reception), clinicId, { finished: true }))).toContain(FINISHED);
  });
});
