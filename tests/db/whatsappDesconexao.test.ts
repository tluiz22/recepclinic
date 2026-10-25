import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { disconnectWhatsapp, getWhatsappConnection, setWhatsappAccessToken, setWhatsappPaymentChecked } from "../../src/lib/data/whatsapp/connection";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { addMember, adminClient, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, withDatabase, type TestUser } from "./helpers";

// F8.3: forma de pagamento conferida pelo Suporte, "Desconectar WhatsApp"
// (Administrador ou Suporte) e a desconexão avisada pela Meta (account_update).
// A Meta é simulada (nenhuma chamada sai).

let clinicA: string;
let clinicB: string;
let admin: TestUser;
let reception: TestUser;
let support: TestUser;
const PHONE_A = `${Date.now()}31`;
const PHONE_B = `${Date.now()}32`;
const WABA_A = `f83-waba-a-${Date.now()}`;

const asDb = (client: unknown) => client as DbClient;
const rowOf = async (clinicId: string) => (await adminClient().from("whatsapp_connections").select("*").eq("clinic_id", clinicId).single()).data!;
const secretExists = async (id: string | null) =>
  id
    ? withDatabase(async (db) => {
        const { rows } = await db.query(`select 1 from vault.secrets where id = $1`, [id]);
        return rows.length > 0;
      })
    : false;

/** Conexão pela janela da Meta (connect_whatsapp), como a F8.1 grava. */
async function connect(clinicId: string, phone: string, waba: string, extra: Record<string, unknown> = {}) {
  const { error } = await support.client.rpc("connect_whatsapp", {
    p_clinic_id: clinicId,
    p_phone_number_id: phone,
    p_waba_id: waba,
    p_display_phone: "+55 84 99999-0000",
    p_coexistence: true,
    p_token: "token-f83",
    ...extra,
  });
  if (error) throw error;
}

type Call = { method: string; path: string };
function fakeMeta() {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ method: init?.method ?? "GET", path: new URL(String(input)).pathname.replace(/^\/v[\d.]+/, "") });
    return Response.json({ success: true });
  };
  return { calls, fetcher };
}

beforeAll(async () => {
  [clinicA, clinicB] = await Promise.all([createClinic("Clínica Desconexão A"), createClinic("Clínica Desconexão B")]);
  [admin, reception, support] = await Promise.all([createUser("f83-admin"), createUser("f83-recep"), createUser("f83-suporte")]);
  await addMember(clinicA, admin.id, ["admin"]);
  await addMember(clinicA, reception.id, ["reception"]);
  await makePlatformStaff(support.id);
});

afterAll(async () => {
  await deleteClinics([clinicA, clinicB]);
  await deleteUsers([admin, reception, support]);
});

describe("forma de pagamento (F8.3)", () => {
  it("só o Suporte marca; vale para a conta em que foi conferida", async () => {
    await connect(clinicA, PHONE_A, WABA_A);
    const { error } = await admin.client.rpc("set_whatsapp_payment_checked", { p_clinic_id: clinicA, p_checked: true });
    expect(error?.code).toBe("42501");
    await setWhatsappPaymentChecked(asDb(support.client), clinicA, true);
    expect((await getWhatsappConnection(asDb(admin.client), clinicA))!.paymentCheckedAt).toBeInstanceOf(Date);
    // Conta nova (outro WABA): confere de novo.
    await connect(clinicA, PHONE_A, `${WABA_A}-nova`);
    expect((await getWhatsappConnection(asDb(admin.client), clinicA))!.paymentCheckedAt).toBeNull();
    await connect(clinicA, PHONE_A, WABA_A);
    await setWhatsappPaymentChecked(asDb(support.client), clinicA, false);
    expect((await getWhatsappConnection(asDb(admin.client), clinicA))!.paymentCheckedAt).toBeNull();
  });
});

describe("Desconectar WhatsApp (F8.3)", () => {
  it("a Recepção não desconecta", async () => {
    const { error } = await reception.client.rpc("disconnect_whatsapp", { p_clinic_id: clinicA });
    expect(error?.code).toBe("42501");
    expect((await rowOf(clinicA)).status).toBe("connected");
  });

  it("coexistência: tira o app da conta, sem tirar o número da API; o token sai do cofre", async () => {
    const before = await rowOf(clinicA);
    expect(await secretExists(before.access_token_secret_id)).toBe(true);
    const meta = fakeMeta();
    const result = await disconnectWhatsapp(asDb(admin.client), asDb(clinicServiceClient(clinicA)), clinicA, async () => [clinicA], meta.fetcher);
    expect(result).toEqual({ coexistence: true, problems: [] });
    expect(meta.calls).toEqual([{ method: "DELETE", path: `/${WABA_A}/subscribed_apps` }]);
    const after = await rowOf(clinicA);
    expect(after).toMatchObject({ status: "disconnected", disconnected_via: "panel", access_token_secret_id: null });
    expect(await secretExists(before.access_token_secret_id)).toBe(false);
    await expect(disconnectWhatsapp(asDb(admin.client), asDb(clinicServiceClient(clinicA)), clinicA, async () => [], meta.fetcher)).rejects.toThrow();
  });

  it("número só na API e conta usada por outra clínica: tira o número da API e deixa o app na conta", async () => {
    await connect(clinicA, PHONE_A, WABA_A, { p_coexistence: false, p_pin: "123456" });
    const pin = (await rowOf(clinicA)).pin_secret_id;
    expect((await rowOf(clinicA)).disconnected_via).toBeNull();
    const meta = fakeMeta();
    const result = await disconnectWhatsapp(asDb(admin.client), asDb(clinicServiceClient(clinicA)), clinicA, async () => [clinicA, clinicB], meta.fetcher);
    expect(result.coexistence).toBe(false);
    expect(meta.calls).toEqual([{ method: "POST", path: `/${PHONE_A}/deregister` }]);
    expect(await secretExists(pin)).toBe(false);
  });

  it("o número desconectado de uma clínica pode ser conectado em outra", async () => {
    await connect(clinicB, PHONE_A, WABA_A);
    expect((await rowOf(clinicB)).phone_number_id).toBe(PHONE_A);
    const { data } = await adminClient().from("whatsapp_connections").select("clinic_id").eq("clinic_id", clinicA);
    expect(data).toEqual([]);
  });

  it("cadastrada pelo Suporte: só sai do sistema, sem chamar a Meta", async () => {
    await adminClient().from("whatsapp_connections").insert({ clinic_id: clinicA, phone_number_id: PHONE_B, waba_id: "f83-suporte", status: "connected" });
    await setWhatsappAccessToken(asDb(support.client), clinicA, "token-suporte");
    const meta = fakeMeta();
    await disconnectWhatsapp(asDb(admin.client), asDb(clinicServiceClient(clinicA)), clinicA, async () => [clinicA], meta.fetcher);
    expect(meta.calls).toEqual([]);
    expect((await rowOf(clinicA)).status).toBe("disconnected");
  });
});

describe("desconexão avisada pela Meta (F8.3)", () => {
  it("PARTNER_REMOVED marca Desconectado nas clínicas daquela conta, com o token fora do cofre", async () => {
    const token = (await rowOf(clinicB)).access_token_secret_id;
    const deps: WebhookDeps = {
      resolveClinic: async () => null,
      clientFor: (clinicId) => asDb(clinicServiceClient(clinicId)),
      resolveClinicsByWaba: async (waba) => {
        const { data } = await adminClient().rpc("resolve_whatsapp_clinics_by_waba", { p_waba_id: waba });
        return (data ?? []) as string[];
      },
    };
    const event = (waba: string) => ({
      object: "whatsapp_business_account",
      entry: [{ id: "999", changes: [{ field: "account_update", value: { event: "PARTNER_REMOVED", waba_info: { waba_id: waba } } }] }],
    });
    expect(await processWebhook(event("outra-conta"), deps)).toMatchObject({ disconnections: 0, errors: 0 });
    expect(await processWebhook(event(WABA_A), deps)).toMatchObject({ disconnections: 1, errors: 0 });
    expect(await rowOf(clinicB)).toMatchObject({ status: "disconnected", disconnected_via: "meta", access_token_secret_id: null });
    expect(await secretExists(token)).toBe(false);
    // De novo: já desconectada, nada muda.
    expect(await processWebhook(event(WABA_A), deps)).toMatchObject({ disconnections: 0, errors: 0 });
    const conn = await getWhatsappConnection(asDb(clinicServiceClient(clinicB)), clinicB);
    expect(conn).toMatchObject({ status: "disconnected", disconnectedVia: "meta" });
    // Conectar de novo limpa a desconexão.
    await connect(clinicB, PHONE_A, WABA_A);
    expect(await rowOf(clinicB)).toMatchObject({ status: "connected", disconnected_via: null, disconnected_at: null });
  });

  it("só a credencial da clínica marca a desconexão da Meta", async () => {
    const { error } = await admin.client.rpc("mark_whatsapp_disconnected_by_meta");
    expect(error?.code).toBe("42501");
  });
});
