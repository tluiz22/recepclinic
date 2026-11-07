import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { countWaitingConversations, isCentralActive, listConversationMessages, listConversations, setCentralEnabled } from "../../src/lib/data/central";
import { addMember, adminClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";

// CN3a — lista da tela Conversas (cliente, 05/nov/2026): Abertas e Finalizadas, quem vê o quê (decisão 4), não lidas
// por pessoa (decisão 6), busca, o número do menu e a Central valendo para toda a equipe.

const WAITING = "+5584966660001";
const PROGRESS = "+5584966660002";
const BOT = "+5584966660003";
const MINE = "+5584966660004";
let clinicId: string;
let admin: TestUser;
let reception: TestUser;
let professional: TestUser;
let support: TestUser;
const asDb = (user: TestUser) => user.client as unknown as DbClient;
const db = () => adminClient();
const codeOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "erro";
  }
};
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

beforeAll(async () => {
  clinicId = await createClinic("Clínica CN3");
  [admin, reception, professional, support] = await Promise.all([createUser("cn3-admin"), createUser("cn3-recepcao"), createUser("cn3-prof"), createUser("cn3-suporte")]);
  await Promise.all([
    addMember(clinicId, admin.id, ["admin"]),
    addMember(clinicId, reception.id, ["reception"]),
    addMember(clinicId, professional.id, ["professional"]),
    makePlatformStaff(support.id),
  ]);
  await db().from("clinic_members").update({ display_name: "Paula Prof" }).eq("clinic_id", clinicId).eq("user_id", professional.id);
  const { data: contact } = await db().from("contacts").insert({ clinic_id: clinicId, full_name: "Maria Souza", phone: WAITING }).select("id").single();
  const message = (phone: string, minutesAgo: number, direction = "inbound", body = "Oi") => ({
    clinic_id: clinicId,
    contact_phone: phone,
    direction,
    message_type: direction === "inbound" ? "text" : "bot_reply",
    body,
    status: direction === "inbound" ? "received" : "sent",
    created_at: at(minutesAgo),
    author: null,
  });
  await db().from("whatsapp_messages").insert([message(WAITING, 30), message(WAITING, 20, "inbound", "Quero remarcar"), message(PROGRESS, 50), message(BOT, 90), message(MINE, 10)]);
  await db().from("conversation_state").insert([
    { clinic_id: clinicId, contact_phone: WAITING, contact_id: contact!.id, human_handoff: true, handoff_status: "waiting_clinic", handoff_status_at: at(25), handoff_started_at: at(40), human_handoff_at: at(40) },
    { clinic_id: clinicId, contact_phone: PROGRESS, human_handoff: true, handoff_status: "in_progress", handoff_status_at: at(45) },
    { clinic_id: clinicId, contact_phone: BOT, human_handoff: false },
    { clinic_id: clinicId, contact_phone: MINE, human_handoff: true, handoff_status: "waiting_clinic", handoff_status_at: at(5), assigned_to: professional.id },
  ]);
});

afterAll(async () => {
  await deleteClinics([clinicId]);
  await deleteUsers([admin, reception, professional, support]);
});

describe("Central desligada", () => {
  it("sem a Central, a lista recusa e o menu não mostra", async () => {
    expect(await isCentralActive(asDb(reception), clinicId)).toBe(false);
    expect(await codeOf(() => listConversations(asDb(reception), clinicId))).toBe("not_enabled");
    expect(await countWaitingConversations(asDb(reception), clinicId)).toBe(0);
  });
});

describe("lista", () => {
  beforeAll(async () => {
    await setCentralEnabled(asDb(admin), clinicId, true);
  });

  it("Abertas: aguardando a clínica no topo (a mais antiga primeiro), com nome, responsável e não lidas", async () => {
    expect(await isCentralActive(asDb(reception), clinicId)).toBe(true);
    const open = await listConversations(asDb(reception), clinicId);
    expect(open.map((c) => c.phone)).toEqual([WAITING, MINE, PROGRESS]);
    expect(open[0]).toMatchObject({ name: "Maria Souza", status: "waiting_clinic", assignedTo: null, unread: 2 });
    expect(open[1]).toMatchObject({ assignedTo: professional.id, assignedName: "Paula Prof" });
    expect(open[2].status).toBe("in_progress");
    const finished = await listConversations(asDb(reception), clinicId, { finished: true });
    expect(finished.map((c) => c.phone)).toEqual([BOT]);
  });

  it("não lidas por pessoa: abrir zera só para quem abriu", async () => {
    await listConversationMessages(asDb(reception), clinicId, WAITING);
    expect((await listConversations(asDb(reception), clinicId))[0].unread).toBe(0);
    expect((await listConversations(asDb(admin), clinicId))[0].unread).toBe(2);
  });

  it("Profissional: só as abertas com ele; Suporte vê todas", async () => {
    expect((await listConversations(asDb(professional), clinicId)).map((c) => c.phone)).toEqual([MINE]);
    expect(await listConversations(asDb(professional), clinicId, { finished: true })).toEqual([]);
    expect(await countWaitingConversations(asDb(professional), clinicId)).toBe(1);
    expect((await listConversations(asDb(support), clinicId)).length).toBe(3);
  });

  it("busca por nome ou por parte do telefone; o menu conta as que aguardam", async () => {
    expect((await listConversations(asDb(reception), clinicId, { search: "maria" })).map((c) => c.phone)).toEqual([WAITING]);
    expect((await listConversations(asDb(reception), clinicId, { search: "6660002" })).map((c) => c.phone)).toEqual([PROGRESS]);
    expect(await countWaitingConversations(asDb(reception), clinicId)).toBe(2);
  });
});
