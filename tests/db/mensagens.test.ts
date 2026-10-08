import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import type { DbClient } from "../../src/lib/data/clients";
import { resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import { getApprovedTemplate, setWhatsappAccessToken } from "../../src/lib/data/whatsapp/connection";
import {
  approveAndSendProposal,
  declineProposal,
  listBotMessages,
  proposeTemplate,
  resetTemplateToDefault,
  saveBotMessage,
  templateVersions,
} from "../../src/lib/data/whatsapp/customMessages";
import type { ClinicSender } from "../../src/lib/data/whatsapp/send";
import { processWebhook } from "../../src/lib/data/whatsapp/webhook";
import { addMember, adminClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";

// F6.6 — Mensagens personalizadas: o Administrador (com o item) propõe o
// aviso e edita a conversa do bot; o Suporte aprova e envia à Meta como
// versão nova; o envio troca sozinho quando a Meta aprova.

const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});

const NUMBER = "f66-numero";
let clinicId: string;
let admin: TestUser;
let reception: TestUser;
let support: TestUser;
const asDb = (u: TestUser) => u.client as unknown as DbClient;
const service = () => createClinicServiceClient(clinicId, env());

const PROPOSAL =
  "Oi, {nome}! {clinica} confirma:\n📋 {servico}\n👤 {paciente}\n📅 {data}\n📍 {local}\nAté lá!";

beforeAll(async () => {
  clinicId = await createClinic("Clínica Mensagens F66");
  admin = await createUser("f66-admin");
  reception = await createUser("f66-recepcao");
  support = await createUser("f66-suporte");
  await addMember(clinicId, admin.id, ["admin"]);
  await addMember(clinicId, reception.id, ["reception"]);
  await makePlatformStaff(support.id);
  await adminClient().from("whatsapp_connections").insert({ clinic_id: clinicId, phone_number_id: NUMBER, waba_id: "f66-waba", status: "connected" });
  await setWhatsappAccessToken(asDb(support), clinicId, "token-f66");
  await adminClient().from("whatsapp_templates").insert({ clinic_id: clinicId, template_key: "confirmation", name: "rc_confirmacao_v1", status: "approved" });
});

afterAll(async () => {
  await deleteClinics([clinicId]);
  await deleteUsers([admin, reception, support]);
});

describe("aviso personalizado (template)", () => {
  it("só o Administrador propõe; uma proposta aberta por vez; o envio segue com a versão em uso", async () => {
    await expect(proposeTemplate(asDb(reception), clinicId, "confirmation", PROPOSAL, reception.id)).rejects.toThrow();
    await proposeTemplate(asDb(admin), clinicId, "confirmation", PROPOSAL, admin.id);
    await expect(proposeTemplate(asDb(admin), clinicId, "confirmation", PROPOSAL, admin.id)).rejects.toThrow(/aguardando o Suporte/);
    const [proposal] = await templateVersions(asDb(admin), clinicId, "confirmation");
    expect(proposal).toMatchObject({ version: 2, stage: "proposed", body: "Oi, {{1}}! {{2}} confirma:\n📋 {{3}}\n👤 {{4}}\n📅 {{5}}\n📍 {{6}}\nAté lá!" });
    expect(proposal.name).toMatch(/^rc_confirmacao_[0-9a-f]{6}_v2$/);
    expect(await getApprovedTemplate(service(), clinicId, "confirmation")).toEqual({ name: "rc_confirmacao_v1", language: "pt_BR", body: null });
  });

  it("o Suporte aprova e envia à Meta; aprovada, passa a ser a usada; \"voltar ao padrão\" volta à v1", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const meta: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ id: "tpl-f66", status: "PENDING" }));
    };
    const [proposal] = await templateVersions(asDb(admin), clinicId, "confirmation");
    expect(await approveAndSendProposal(service(), clinicId, proposal.id, meta)).toBeNull();
    expect(calls[0].url).toMatch(/\/f66-waba\/message_templates$/);
    expect(calls[0].body).toMatchObject({ name: proposal.name, category: "UTILITY", language: "pt_BR" });
    expect((calls[0].body.components as { text: string }[])[0].text).toBe(proposal.body);
    expect((await templateVersions(asDb(admin), clinicId, "confirmation"))[0]).toMatchObject({ stage: "meta", status: "pending" });
    // Em análise: segue a v1.
    expect((await getApprovedTemplate(service(), clinicId, "confirmation"))!.name).toBe("rc_confirmacao_v1");

    // A Meta aprovou (webhook de situação).
    await processWebhook(
      {
        entry: [
          {
            id: "f66-waba",
            changes: [
              {
                field: "message_template_status_update",
                value: { event: "APPROVED", message_template_name: proposal.name, message_template_language: "pt_BR", message_template_id: 77 },
              },
            ],
          },
        ],
      },
      {
        resolveClinic: (id) => resolveClinicByPhoneNumberId(id, env()),
        clientFor: (id) => createClinicServiceClient(id, env()),
        resolveClinicsByWaba: async () => [clinicId],
      },
    );
    expect(await getApprovedTemplate(service(), clinicId, "confirmation")).toEqual({ name: proposal.name, language: "pt_BR", body: proposal.body });

    await resetTemplateToDefault(asDb(admin), clinicId, "confirmation");
    expect((await getApprovedTemplate(service(), clinicId, "confirmation"))!.name).toBe("rc_confirmacao_v1");
  });

  it("o Suporte recusa com o motivo; a clínica vê e pode propor de novo", async () => {
    await proposeTemplate(asDb(admin), clinicId, "confirmation", PROPOSAL, admin.id);
    const [proposal] = await templateVersions(asDb(admin), clinicId, "confirmation");
    await expect(declineProposal(asDb(support), clinicId, proposal.id, " ")).rejects.toThrow();
    await declineProposal(asDb(support), clinicId, proposal.id, "Evite abreviações");
    expect((await templateVersions(asDb(admin), clinicId, "confirmation"))[0]).toMatchObject({ stage: "declined", supportNote: "Evite abreviações" });
    await proposeTemplate(asDb(admin), clinicId, "confirmation", PROPOSAL, admin.id);
  });
});

describe("conversa do bot", () => {
  it("texto próprio vale na hora no bot; sem o item, nem grava nem é usado", async () => {
    await saveBotMessage(asDb(admin), clinicId, "welcome", "Oi! Aqui é {clinica} 😊", admin.id);
    expect((await listBotMessages(asDb(admin), clinicId)).get("welcome")).toBe("Oi! Aqui é {clinica} 😊");

    const sent: string[] = [];
    const sender: ClinicSender = {
      clinicId,
      clinicLabel: "da Clínica Mensagens F66",
      baseUrl: "https://app.exemplo.test",
      template: async () => ({ sent: false, reason: "-" }),
      text: async (_to, body) => (sent.push(body), { sent: true, messageId: `wamid.f66.${sent.length}` }),
      list: async (_to, body) => (sent.push(body), { sent: true, messageId: `wamid.f66.l${sent.length}` }),
      buttons: async (_to, body) => (sent.push(body), { sent: true, messageId: `wamid.f66.b${sent.length}` }),
    };
    const hello = (id: string) =>
      processWebhook(
        { entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: NUMBER }, messages: [{ id, from: "5584991226601", type: "text", text: { body: "oi" } }] } }] }] },
        { resolveClinic: (pid) => resolveClinicByPhoneNumberId(pid, env()), clientFor: (cid) => createClinicServiceClient(cid, env()), senderFor: async () => sender },
      );
    await hello("wamid.f66.in.1");
    expect(sent[0]).toBe("Oi! Aqui é da Clínica Mensagens F66 😊");

    // Sem o item: o padrão volta, e o Administrador não grava.
    const { data: all } = await adminClient().from("features").select("key");
    await adminClient().rpc("set_clinic_features", { p_clinic_id: clinicId, p_features: all!.map((f) => f.key).filter((k) => k !== "custom_messages") });
    await expect(saveBotMessage(asDb(admin), clinicId, "menu", "Escolha:", admin.id)).rejects.toThrow();
    sent.length = 0;
    await adminClient().from("conversation_state").update({ state: "WELCOME" }).eq("clinic_id", clinicId);
    await hello("wamid.f66.in.2");
    expect(sent[0]).toBe("Olá! 👋 Aqui é da Clínica Mensagens F66.");
  });
});
