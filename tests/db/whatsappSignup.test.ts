import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, adminClient, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";

// F8.1: conexão pela janela da Meta (connect_whatsapp) e a sincronização da
// coexistência feita depois (mark_whatsapp_synced).

let clinicA: string;
let clinicB: string;
let adminA: TestUser;
let receptionA: TestUser;
let adminB: TestUser;
let support: TestUser;
const PHONE_A = `${Date.now()}1`;
const PHONE_B = `${Date.now()}2`;

const connectArgs = (clinicId: string, phone: string, extra: Record<string, unknown> = {}) => ({
  p_clinic_id: clinicId,
  p_phone_number_id: phone,
  p_waba_id: "123456789",
  p_display_phone: "+55 84 99999-0000",
  p_coexistence: true,
  p_token: "token-da-meta",
  p_contacts_synced: true,
  p_history_synced: false,
  ...extra,
});

const connectionOf = async (clinicId: string) =>
  (await adminClient().from("whatsapp_connections").select("*").eq("clinic_id", clinicId).single()).data!;

beforeAll(async () => {
  clinicA = await createClinic("Clínica A (conectar)");
  clinicB = await createClinic("Clínica B (conectar)");
  [adminA, receptionA, adminB, support] = await Promise.all([createUser("admin-a"), createUser("recep-a"), createUser("admin-b"), createUser("suporte")]);
  await addMember(clinicA, adminA.id, ["admin"]);
  await addMember(clinicA, receptionA.id, ["reception"]);
  await addMember(clinicB, adminB.id, ["admin"]);
  await makePlatformStaff(support.id);
});

afterAll(async () => {
  await deleteClinics([clinicA, clinicB]);
  await deleteUsers([adminA, receptionA, adminB, support]);
});

describe("conexão pela janela da Meta (F8.1)", () => {
  it("só o Administrador da própria clínica (ou o Suporte) conecta", async () => {
    const { error: reception } = await receptionA.client.rpc("connect_whatsapp", connectArgs(clinicA, PHONE_A));
    expect(reception?.code).toBe("42501");
    const { error: otherAdmin } = await adminB.client.rpc("connect_whatsapp", connectArgs(clinicA, PHONE_A));
    expect(otherAdmin?.code).toBe("42501");
    const { data } = await adminClient().from("whatsapp_connections").select("clinic_id").eq("clinic_id", clinicA);
    expect(data).toEqual([]);
  });

  it("o Administrador conecta: conectado, coexistência, token no cofre e a sincronização feita marcada", async () => {
    const { error } = await adminA.client.rpc("connect_whatsapp", connectArgs(clinicA, PHONE_A));
    expect(error).toBeNull();
    const row = await connectionOf(clinicA);
    expect(row).toMatchObject({
      phone_number_id: PHONE_A,
      waba_id: "123456789",
      display_phone: "+55 84 99999-0000",
      status: "connected",
      coexistence: true,
      connected_via: "embedded_signup",
      pin_secret_id: null,
      history_synced_at: null,
    });
    expect(row.connected_at).not.toBeNull();
    expect(row.contacts_synced_at).not.toBeNull();
    const { data: token } = await clinicServiceClient(clinicA).rpc("get_whatsapp_access_token");
    expect(token).toBe("token-da-meta");
  });

  it("a equipe vê como foi conectado, mas não os segredos", async () => {
    const { data } = await receptionA.client.from("whatsapp_connections").select("connected_via, contacts_synced_at, history_synced_at");
    expect(data).toHaveLength(1);
    const { error } = await receptionA.client.from("whatsapp_connections").select("pin_secret_id");
    expect(error?.code).toBe("42501");
  });

  it("a sincronização que faltou é marcada depois, uma vez", async () => {
    const { error: reception } = await receptionA.client.rpc("mark_whatsapp_synced", { p_clinic_id: clinicA, p_kind: "history" });
    expect(reception?.code).toBe("42501");
    const { error } = await adminA.client.rpc("mark_whatsapp_synced", { p_clinic_id: clinicA, p_kind: "history" });
    expect(error).toBeNull();
    const first = (await connectionOf(clinicA)).history_synced_at;
    expect(first).not.toBeNull();
    await adminA.client.rpc("mark_whatsapp_synced", { p_clinic_id: clinicA, p_kind: "history" });
    expect((await connectionOf(clinicA)).history_synced_at).toBe(first);
    const { error: unknown } = await adminA.client.rpc("mark_whatsapp_synced", { p_clinic_id: clinicA, p_kind: "outra" });
    expect(unknown?.code).toBe("22023");
  });

  it("o número de outra clínica é recusado", async () => {
    const { error } = await adminB.client.rpc("connect_whatsapp", connectArgs(clinicB, PHONE_A));
    expect(error?.code).toBe("23505");
  });

  it("número novo (só na API): o PIN vai para o cofre; PIN fora do formato é recusado", async () => {
    const { error: badPin } = await adminB.client.rpc("connect_whatsapp", connectArgs(clinicB, PHONE_B, { p_coexistence: false, p_pin: "12ab" }));
    expect(badPin?.code).toBe("22023");
    const { error } = await adminB.client.rpc("connect_whatsapp", connectArgs(clinicB, PHONE_B, { p_coexistence: false, p_pin: "123456", p_contacts_synced: false }));
    expect(error).toBeNull();
    const row = await connectionOf(clinicB);
    expect(row).toMatchObject({ coexistence: false, connected_via: "embedded_signup", contacts_synced_at: null });
    expect(row.pin_secret_id).not.toBeNull();
  });

  it("reconectar troca o token no mesmo segredo; sem PIN, o PIN antigo sai do cofre", async () => {
    const before = await connectionOf(clinicB);
    const { error } = await support.client.rpc("connect_whatsapp", connectArgs(clinicB, PHONE_B, { p_token: "token-novo" }));
    expect(error).toBeNull();
    const after = await connectionOf(clinicB);
    expect(after.access_token_secret_id).toBe(before.access_token_secret_id);
    expect(after.pin_secret_id).toBeNull();
    expect(after.coexistence).toBe(true);
    const { data: token } = await clinicServiceClient(clinicB).rpc("get_whatsapp_access_token");
    expect(token).toBe("token-novo");
  });

  it("conexão incompleta é recusada", async () => {
    const { error } = await adminA.client.rpc("connect_whatsapp", connectArgs(clinicA, PHONE_A, { p_token: " " }));
    expect(error?.code).toBe("22023");
  });
});
