import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import {
  setCentralEnabled,
  listConversations,
} from "../../src/lib/data/central";
import {
  assignConversation,
  listCentralTeam,
  retryFromCentral,
  sendFromCentral,
  type SendDeps,
} from "../../src/lib/data/centralSend";
import type { ClinicSender } from "../../src/lib/data/whatsapp/send";
import type { SendOutcome } from "../../src/lib/data/whatsapp/messages";
import {
  addMember,
  adminClient,
  clinicServiceClient,
  createClinic,
  createUser,
  deleteClinics,
  deleteUsers,
  type TestUser,
} from "./helpers";

// CN4a — responder, assumir e transferir pela Central (decisões 5 e 7 e R2, cliente, 05/nov/2026).

const WAITING = "+5584955550001";
const OLD = "+5584955550002";
const BOT = "+5584955550003";
let clinicId: string;
let admin: TestUser;
let reception: TestUser;
let professional: TestUser;
const asDb = (user: TestUser) => user.client as unknown as DbClient;
const db = () => adminClient();
const at = (minutesAgo: number) =>
  new Date(Date.now() - minutesAgo * 60_000).toISOString();
const codeOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "erro";
  }
};

// WhatsApp de mentira: guarda o que saiu e responde como mandado.
let nextOutcome: SendOutcome = { sent: true, messageId: "wamid.central1" };
const sent: { to: string; body: string }[] = [];
const sender = {
  text: async (to: string, body: string) => {
    sent.push({ to, body });
    return nextOutcome;
  },
} as unknown as ClinicSender;
const deps = (user: TestUser): SendDeps => ({
  db: asDb(user),
  serviceDb: clinicServiceClient(clinicId) as unknown as DbClient,
  sender,
});
const conversation = async (phone: string) =>
  (
    await db()
      .from("conversation_state")
      .select("human_handoff, handoff_status, assigned_to")
      .eq("clinic_id", clinicId)
      .eq("contact_phone", phone)
      .single()
  ).data!;
const messageByKey = async (key: string) =>
  (
    await db()
      .from("whatsapp_messages")
      .select("id, status, author, sent_by, message_type, body, wa_message_id")
      .eq("clinic_id", clinicId)
      .eq("client_key", key)
      .single()
  ).data!;

beforeAll(async () => {
  clinicId = await createClinic("Clínica CN4");
  [admin, reception, professional] = await Promise.all([
    createUser("cn4-admin"),
    createUser("cn4-recepcao"),
    createUser("cn4-prof"),
  ]);
  await Promise.all([
    addMember(clinicId, admin.id, ["admin"]),
    addMember(clinicId, reception.id, ["reception"]),
    addMember(clinicId, professional.id, ["professional"]),
  ]);
  await db()
    .from("clinic_members")
    .update({ display_name: "Ana Recepção" })
    .eq("clinic_id", clinicId)
    .eq("user_id", reception.id);
  await setCentralEnabled(asDb(admin), clinicId, true);
  const inbound = (phone: string, minutesAgo: number) => ({
    clinic_id: clinicId,
    contact_phone: phone,
    direction: "inbound",
    message_type: "text",
    body: "Oi",
    status: "received",
    created_at: at(minutesAgo),
  });
  await db()
    .from("whatsapp_messages")
    .insert([inbound(WAITING, 10), inbound(OLD, 25 * 60), inbound(BOT, 30)]);
  await db()
    .from("conversation_state")
    .insert([
      {
        clinic_id: clinicId,
        contact_phone: WAITING,
        human_handoff: true,
        handoff_status: "waiting_clinic",
        handoff_status_at: at(10),
      },
      {
        clinic_id: clinicId,
        contact_phone: OLD,
        human_handoff: true,
        handoff_status: "waiting_clinic",
        handoff_status_at: at(25 * 60),
      },
      { clinic_id: clinicId, contact_phone: BOT, human_handoff: false },
    ]);
});

afterAll(async () => {
  await deleteClinics([clinicId]);
  await deleteUsers([admin, reception, professional]);
});

describe("responder", () => {
  const key1 = crypto.randomUUID();

  it("quem responde assume, a conversa fica Em atendimento e a mensagem sai pelo WhatsApp", async () => {
    expect(
      await sendFromCentral(deps(reception), clinicId, {
        phone: WAITING,
        clientKey: key1,
        body: "  Bom dia! ",
        expectedAssigned: null,
      }),
    ).toEqual({ kind: "sent" });
    expect(sent.at(-1)).toEqual({ to: WAITING, body: "Bom dia!" });
    expect(await messageByKey(key1)).toMatchObject({
      status: "sent",
      author: "agent_panel",
      sent_by: reception.id,
      message_type: "panel_reply",
      body: "Bom dia!",
      wa_message_id: "wamid.central1",
    });
    expect(await conversation(WAITING)).toMatchObject({
      handoff_status: "in_progress",
      assigned_to: reception.id,
    });
    const listed = (await listConversations(asDb(reception), clinicId)).find(
      (c) => c.phone === WAITING,
    )!;
    expect(listed).toMatchObject({
      unread: 0,
      lastMessageAuthor: "agent_panel",
      preview: "Bom dia!",
    });
  });

  it("a mesma chave não envia de novo", async () => {
    const before = sent.length;
    expect(
      await sendFromCentral(deps(reception), clinicId, {
        phone: WAITING,
        clientKey: key1,
        body: "Bom dia!",
        expectedAssigned: null,
      }),
    ).toEqual({ kind: "duplicate" });
    expect(sent.length).toBe(before);
  });

  it("com outra dona: sem confirmar (a tela viu sem responsável) não sai; confirmando, assume", async () => {
    const before = sent.length;
    expect(
      await sendFromCentral(deps(admin), clinicId, {
        phone: WAITING,
        clientKey: crypto.randomUUID(),
        body: "Oi",
        expectedAssigned: null,
      }),
    ).toEqual({ kind: "changed", name: "Ana" });
    expect(sent.length).toBe(before);
    expect(
      await sendFromCentral(deps(admin), clinicId, {
        phone: WAITING,
        clientKey: crypto.randomUUID(),
        body: "Oi",
        expectedAssigned: reception.id,
      }),
    ).toEqual({ kind: "sent" });
    expect((await conversation(WAITING)).assigned_to).toBe(admin.id);
  });

  it("falhou: fica Não enviada; Tentar de novo envia a mesma mensagem uma vez", async () => {
    const key = crypto.randomUUID();
    nextOutcome = { sent: false, reason: "(#131000) Something went wrong" };
    expect(
      (
        await sendFromCentral(deps(admin), clinicId, {
          phone: WAITING,
          clientKey: key,
          body: "Confirmado",
          expectedAssigned: admin.id,
        })
      ).kind,
    ).toBe("failed");
    const failed = await messageByKey(key);
    expect(failed.status).toBe("failed");
    nextOutcome = { sent: true, messageId: "wamid.central2" };
    expect(await retryFromCentral(deps(admin), clinicId, failed.id)).toEqual({
      kind: "sent",
    });
    expect(await messageByKey(key)).toMatchObject({
      status: "sent",
      wa_message_id: "wamid.central2",
    });
    expect(await retryFromCentral(deps(admin), clinicId, failed.id)).toEqual({
      kind: "already",
    });
  });

  it("fora das 24 h não sai", async () => {
    expect(
      await sendFromCentral(deps(reception), clinicId, {
        phone: OLD,
        clientKey: crypto.randomUUID(),
        body: "Oi",
        expectedAssigned: null,
      }),
    ).toEqual({ kind: "window_closed" });
  });

  it("conversa com o bot (Finalizadas): pausa o bot e responde", async () => {
    expect(
      await sendFromCentral(deps(reception), clinicId, {
        phone: BOT,
        clientKey: crypto.randomUUID(),
        body: "Oi, tudo bem?",
        expectedAssigned: null,
      }),
    ).toEqual({ kind: "sent" });
    expect(await conversation(BOT)).toMatchObject({
      human_handoff: true,
      handoff_status: "in_progress",
      assigned_to: reception.id,
    });
  });

  it("o Profissional não responde em conversa que não está com ele", async () => {
    expect(
      await codeOf(() =>
        sendFromCentral(deps(professional), clinicId, {
          phone: OLD,
          clientKey: crypto.randomUUID(),
          body: "Oi",
          expectedAssigned: null,
        }),
      ),
    ).toBe("forbidden");
  });
});

describe("assumir e transferir", () => {
  it("o responsável só muda pelas funções", async () => {
    const { error } = await reception.client
      .from("conversation_state")
      .update({ assigned_to: reception.id })
      .eq("clinic_id", clinicId)
      .eq("contact_phone", OLD);
    expect(error?.code).toBe("42501");
  });

  it("Recepção assume; com o responsável mudado desde a tela, não muda", async () => {
    expect(
      await assignConversation(asDb(reception), clinicId, OLD, {
        expected: null,
      }),
    ).toEqual({ kind: "ok", name: "Ana" });
    expect(
      await assignConversation(asDb(admin), clinicId, OLD, { expected: null }),
    ).toEqual({ kind: "changed", name: "Ana" });
    expect(
      await assignConversation(asDb(reception), clinicId, OLD, {
        expected: reception.id,
      }),
    ).toMatchObject({ kind: "same" });
  });

  it("transferir para um Profissional: ele passa a ver e responder; ele não transfere", async () => {
    const team = await listCentralTeam(asDb(reception), clinicId);
    expect(team.map((m) => m.userId).sort()).toEqual(
      [admin.id, reception.id, professional.id].sort(),
    );
    expect(
      (
        await assignConversation(asDb(reception), clinicId, WAITING, {
          expected: admin.id,
          to: professional.id,
        })
      ).kind,
    ).toBe("ok");
    expect(
      (await listConversations(asDb(professional), clinicId)).map(
        (c) => c.phone,
      ),
    ).toEqual([WAITING]);
    expect(
      await sendFromCentral(deps(professional), clinicId, {
        phone: WAITING,
        clientKey: crypto.randomUUID(),
        body: "Olá",
        expectedAssigned: professional.id,
      }),
    ).toEqual({ kind: "sent" });
    expect(
      await codeOf(() =>
        assignConversation(asDb(professional), clinicId, WAITING, {
          expected: professional.id,
          to: reception.id,
        }),
      ),
    ).toBe("forbidden");
    expect(
      await codeOf(() => listCentralTeam(asDb(professional), clinicId)),
    ).toBe("forbidden");
  });

  it("os eventos guardam quem assumiu e a transferência", async () => {
    const { data } = await db()
      .from("handoff_events")
      .select("kind, assigned_from, assigned_to, actor_id")
      .eq("clinic_id", clinicId)
      .eq("contact_phone", WAITING)
      .neq("kind", "status")
      .order("id");
    expect(data!.map((e) => e.kind)).toEqual([
      "assigned",
      "transferred",
      "transferred",
    ]);
    expect(data!.at(-1)).toMatchObject({
      assigned_from: admin.id,
      assigned_to: professional.id,
      actor_id: reception.id,
    });
  });
});
