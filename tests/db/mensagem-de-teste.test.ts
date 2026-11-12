import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import { connectionTestDelivered, getDeliveredConnectionTest, getLatestConnectionTest, sendConnectionTest } from "../../src/lib/data/whatsapp/connectionTest";
import { updateDeliveryStatus } from "../../src/lib/data/whatsapp/messages";
import type { ClinicSender } from "../../src/lib/data/whatsapp/send";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient } from "./helpers";

// IS2 — Mensagem de teste (cliente, 03/nov/2026; docs/arquivo/modulos/implantacao-segura.md): o Administrador manda o modelo
// rc_teste_envio_v1 para um celular; a entrega chega pelo webhook; a falha guarda o código da Meta.

const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
});

let f: AgendaFixture;
let seq = 0;
let next: "ok" | "fail" = "ok";
const sentTo: { to: string; params: string[] }[] = [];

const sender: ClinicSender = {
  clinicId: "",
  clinicLabel: "da Clínica Teste IS2",
  baseUrl: "https://app.exemplo.test",
  template: async (to, _key, _template, params) => {
    sentTo.push({ to, params });
    return next === "ok"
      ? { sent: true, messageId: `wamid.is2.${++seq}` }
      : { sent: false, reason: "Business eligibility payment issue", failure: { code: 131042, technical: false } };
  },
  text: async () => ({ sent: false, reason: "sem texto no teste" }),
  list: async () => ({ sent: false, reason: "sem lista no teste" }),
  buttons: async () => ({ sent: false, reason: "sem botões no teste" }),
};

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica Teste IS2", "+55849912280");
});

afterAll(async () => f.cleanup());

describe("mensagem de teste", () => {
  it("sem o modelo aprovado: não tenta; número inválido: recusa", async () => {
    const db = asDb(f.admin);
    expect(await codeOf(() => sendConnectionTest(db, f.clinicId, { phone: "61999998888" }, sender))).toBe("invalid");
    await adminClient().from("whatsapp_templates").insert({ clinic_id: f.clinicId, template_key: "connection_test", name: "rc_teste_envio_v1", status: "approved" });
    expect(await codeOf(() => sendConnectionTest(db, f.clinicId, { phone: "123" }, sender))).toBe("invalid");
    expect(await codeOf(() => sendConnectionTest(db, f.clinicId, { phone: "61999998888" }, null))).toBe("invalid");
    expect(sentTo).toEqual([]);
  });

  it("enviada, depois entregue pelo webhook: libera a ativação", async () => {
    const db = asDb(f.admin);
    const test = await sendConnectionTest(db, f.clinicId, { phone: "(61) 99999-8888" }, sender);
    expect(test).toMatchObject({ phone: "+5561999998888", status: "sent", failureCode: null });
    expect(sentTo.at(-1)).toEqual({ to: "+5561999998888", params: ["equipe", "da Clínica Teste IS2"] });
    expect(await getDeliveredConnectionTest(db, f.clinicId)).toBeNull();
    await updateDeliveryStatus(createClinicServiceClient(f.clinicId, env()), f.clinicId, `wamid.is2.${seq}`, "delivered");
    const latest = await getLatestConnectionTest(db, f.clinicId);
    expect(latest?.status).toBe("delivered");
    expect(connectionTestDelivered(latest)).toBe(true);
    expect(await getDeliveredConnectionTest(db, f.clinicId)).not.toBeNull();
  });

  it("recusada na hora: guarda o código da Meta (131042, pagamento)", async () => {
    next = "fail";
    const db = asDb(f.admin);
    const test = await sendConnectionTest(db, f.clinicId, { phone: "61999997777" }, sender);
    expect(test).toMatchObject({ status: "failed", failureCode: 131042, failureReason: "Business eligibility payment issue" });
    expect(await getLatestConnectionTest(db, f.clinicId)).toMatchObject({ status: "failed", failureCode: 131042 });
    // O teste entregue antes continua valendo para a ativação.
    expect(await getDeliveredConnectionTest(db, f.clinicId)).not.toBeNull();
  });
});
