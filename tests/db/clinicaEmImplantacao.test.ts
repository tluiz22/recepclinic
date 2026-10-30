import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { setClinicStatus } from "../../src/lib/data/onboarding";
import { setWhatsappAccessToken } from "../../src/lib/data/whatsapp/connection";
import { createClinicSender } from "../../src/lib/data/whatsapp/send";
import { listHumanAttention } from "../../src/lib/data/whatsapp/attention";
import { pauseForHuman } from "../../src/lib/data/whatsapp/conversations";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { addMember, adminClient, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";

// F8.2b: clínica em implantação. Só o Suporte muda a situação; enquanto em
// implantação, ninguém envia pela clínica (bot, avisos e envios automáticos
// passam todos por quem envia), mesmo com o WhatsApp conectado.

let clinicId: string;
let phoneNumberId: string;
let admin: TestUser;
let support: TestUser;

const asDb = (client: unknown) => client as DbClient;
const statusOf = async () => (await adminClient().from("clinics").select("status").eq("id", clinicId).single()).data!.status;
const sender = () => createClinicSender(asDb(clinicServiceClient(clinicId)), clinicId, { baseUrl: "https://app.exemplo.test", fetcher: fetch });

beforeAll(async () => {
  clinicId = await createClinic("Clínica em Implantação");
  [admin, support] = await Promise.all([createUser("impl-admin"), createUser("impl-suporte")]);
  await addMember(clinicId, admin.id, ["admin"]);
  await makePlatformStaff(support.id);
  phoneNumberId = `${Date.now()}9`;
  await adminClient().from("whatsapp_connections").insert({ clinic_id: clinicId, phone_number_id: phoneNumberId, waba_id: "impl-waba", status: "connected" });
  await setWhatsappAccessToken(asDb(support.client), clinicId, "token-impl");
});

afterAll(async () => {
  await deleteClinics([clinicId]);
  await deleteUsers([admin, support]);
});

describe("clínica em implantação (F8.2b)", () => {
  it("o Suporte põe em implantação; o Administrador não muda a situação, mas segue mudando o nome", async () => {
    await setClinicStatus(asDb(support.client), clinicId, "onboarding");
    expect(await statusOf()).toBe("onboarding");
    const { error } = await admin.client.from("clinics").update({ status: "active" }).eq("id", clinicId);
    expect(error?.code).toBe("42501");
    expect(await statusOf()).toBe("onboarding");
    const { error: rename } = await admin.client.from("clinics").update({ name: "Clínica em Implantação (nome novo)" }).eq("id", clinicId);
    expect(rename).toBeNull();
  });

  it("em implantação, ninguém envia pela clínica, mesmo conectada; ativa, envia", async () => {
    expect(await sender()).toBeNull();
    await setClinicStatus(asDb(support.client), clinicId, "active");
    expect(await statusOf()).toBe("active");
    expect(await sender()).not.toBeNull();
  });

  it("rotinas: as de envio só nas clínicas ativas; a das séries também em implantação", async () => {
    await setClinicStatus(asDb(support.client), clinicId, "onboarding");
    const { data: active } = await adminClient().rpc("list_active_clinics");
    expect(active).not.toContain(clinicId);
    const { data: inService } = await adminClient().rpc("list_clinics_in_service");
    expect(inService).toContain(clinicId);
    const { error } = await admin.client.rpc("list_clinics_in_service");
    expect(error?.code).toBe("42501");
  });

  it("em implantação, as conversas não são gravadas nem pausam o bot, e o Atendimento fica vazio", async () => {
    await setClinicStatus(asDb(support.client), clinicId, "onboarding");
    const deps: WebhookDeps = {
      resolveClinic: async (id) => (id === phoneNumberId ? clinicId : null),
      clientFor: (id) => asDb(clinicServiceClient(id)),
    };
    const payload = {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: phoneNumberId },
                messages: [{ id: `wamid.impl.${Date.now()}.1`, from: "5584977730001", type: "text", text: { body: "Oi" } }],
                message_echoes: [{ id: `wamid.impl.${Date.now()}.2`, to: "5584977730001", type: "text", text: { body: "Bom dia!" } }],
              },
            },
          ],
        },
      ],
    };
    expect(await processWebhook(payload, deps)).toMatchObject({ inbound: 0, echoes: 0, onboarding: 2, errors: 0 });
    const { data: saved } = await adminClient().from("whatsapp_messages").select("id").eq("clinic_id", clinicId);
    expect(saved).toEqual([]);
    const { data: paused } = await adminClient().from("conversation_state").select("id").eq("clinic_id", clinicId);
    expect(paused).toEqual([]);

    // Pausa de antes (ex.: gravada antes desta regra): não aparece em implantação; ativa, aparece.
    await pauseForHuman(asDb(clinicServiceClient(clinicId)), clinicId, "+5584977730002", { contactId: null, reason: "agent_took_over" });
    expect(await listHumanAttention(asDb(admin.client), clinicId)).toEqual([]);
    await setClinicStatus(asDb(support.client), clinicId, "active");
    expect((await listHumanAttention(asDb(admin.client), clinicId)).map((i) => i.phone)).toEqual(["+5584977730002"]);
  });
});
