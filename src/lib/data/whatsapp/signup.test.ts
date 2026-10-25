import { describe, expect, it } from "vitest";
import type { DbClient } from "../clients";
import { DataError } from "../errors";
import { connectWithSignup, pendingCoexistenceSync, type WhatsappConnection } from "./connection";
import { GraphRequestError } from "./graph";

// F8.1: o que o servidor faz com o que a janela da Meta devolveu.

type Call = { method: string; url: string; body: unknown };

/** Meta de mentira: responde por trecho do endereço; `fail` devolve erro para o trecho. */
function fakeMeta(phone: Record<string, unknown> = {}, fail: string[] = []) {
  const calls: Call[] = [];
  const fetcher = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const failing = fail.find((part) => url.includes(part));
    if (failing) return new Response(JSON.stringify({ error: { code: 100, message: `falhou ${failing}` } }), { status: 400 });
    if (url.includes("/oauth/access_token")) return Response.json({ access_token: "token-da-clinica" });
    if (method === "GET") return Response.json({ display_phone_number: "+55 84 99999-0000", platform_type: "CLOUD_API", ...phone });
    return Response.json({ success: true });
  }) as typeof fetch;
  return { calls, fetcher };
}

function fakeDb() {
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      return { data: null, error: null };
    },
  } as unknown as DbClient;
  return { db, rpcs };
}

const input = (event: string) => ({ code: "codigo", wabaId: "1234567890", phoneNumberId: "9876543210", event });
const deps = (fetcher: typeof fetch) => ({ appId: "111111", appSecret: "segredo", fetcher, newPin: () => "654321" });
const path = (call: Call) => `${call.method} ${new URL(call.url).pathname.replace(/^\/v[\d.]+/, "")}`;

describe("conexão pela janela da Meta", () => {
  it("coexistência: troca o código, confere o número, inscreve o app e sincroniza, sem registrar", async () => {
    const meta = fakeMeta({ is_on_biz_app: true });
    const { db, rpcs } = fakeDb();
    const result = await connectWithSignup(db, "clinica", input("FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"), deps(meta.fetcher));

    expect(meta.calls.map(path)).toEqual([
      "GET /oauth/access_token",
      "GET /9876543210",
      "POST /1234567890/subscribed_apps",
      "POST /9876543210/smb_app_data",
      "POST /9876543210/smb_app_data",
    ]);
    expect(new URL(meta.calls[0].url).searchParams.get("client_secret")).toBe("segredo");
    expect(meta.calls.slice(3).map((c) => (c.body as { sync_type: string }).sync_type)).toEqual(["smb_app_state_sync", "history"]);
    expect(result).toEqual({ coexistence: true, displayPhone: "+55 84 99999-0000", syncProblems: [] });
    expect(rpcs).toEqual([
      {
        name: "connect_whatsapp",
        args: {
          p_clinic_id: "clinica",
          p_phone_number_id: "9876543210",
          p_waba_id: "1234567890",
          p_display_phone: "+55 84 99999-0000",
          p_coexistence: true,
          p_token: "token-da-clinica",
          p_pin: undefined,
          p_contacts_synced: true,
          p_history_synced: true,
        },
      },
    ]);
  });

  it("número novo: registra na Cloud API com o PIN sorteado e não sincroniza", async () => {
    const meta = fakeMeta({ is_on_biz_app: false });
    const { db, rpcs } = fakeDb();
    const result = await connectWithSignup(db, "clinica", input("FINISH"), deps(meta.fetcher));

    expect(meta.calls.map(path)).toEqual(["GET /oauth/access_token", "GET /9876543210", "POST /1234567890/subscribed_apps", "POST /9876543210/register"]);
    expect(meta.calls[3].body).toEqual({ messaging_product: "whatsapp", pin: "654321" });
    expect(result.coexistence).toBe(false);
    expect(rpcs[0].args).toMatchObject({ p_coexistence: false, p_pin: "654321", p_contacts_synced: false, p_history_synced: false });
  });

  it("número que a Meta diz estar no app conta como coexistência, mesmo com FINISH", async () => {
    const meta = fakeMeta({ is_on_biz_app: true });
    const { db } = fakeDb();
    const result = await connectWithSignup(db, "clinica", input("FINISH"), deps(meta.fetcher));
    expect(result.coexistence).toBe(true);
    expect(meta.calls.some((c) => c.url.includes("/register"))).toBe(false);
  });

  it("sincronização recusada não impede a conexão: fica marcada como pendente", async () => {
    const meta = fakeMeta({ is_on_biz_app: true }, ["smb_app_data"]);
    const { db, rpcs } = fakeDb();
    const result = await connectWithSignup(db, "clinica", input("FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"), deps(meta.fetcher));
    expect(result.syncProblems).toHaveLength(2);
    expect(rpcs[0].args).toMatchObject({ p_contacts_synced: false, p_history_synced: false });
  });

  it("erro da Meta antes do fim: nada é gravado", async () => {
    const meta = fakeMeta({}, ["subscribed_apps"]);
    const { db, rpcs } = fakeDb();
    await expect(connectWithSignup(db, "clinica", input("FINISH"), deps(meta.fetcher))).rejects.toBeInstanceOf(GraphRequestError);
    expect(rpcs).toEqual([]);
  });

  it("só a conta, sem número, ou resposta incompleta: recusa sem chamar a Meta", async () => {
    const meta = fakeMeta();
    const { db } = fakeDb();
    await expect(connectWithSignup(db, "clinica", input("FINISH_ONLY_WABA"), deps(meta.fetcher))).rejects.toBeInstanceOf(DataError);
    await expect(connectWithSignup(db, "clinica", { ...input("FINISH"), phoneNumberId: "" }, deps(meta.fetcher))).rejects.toBeInstanceOf(DataError);
    await expect(connectWithSignup(db, "clinica", input("CANCEL"), deps(meta.fetcher))).rejects.toBeInstanceOf(DataError);
    expect(meta.calls).toEqual([]);
  });
});

describe("sincronização pendente da coexistência", () => {
  const now = new Date("2026-10-25T12:00:00Z");
  const connection = (extra: Partial<WhatsappConnection> = {}): WhatsappConnection => ({
    phoneNumberId: "1",
    wabaId: "2",
    displayPhone: null,
    status: "connected",
    connectedAt: new Date("2026-10-25T08:00:00Z"),
    coexistence: true,
    connectedVia: "embedded_signup",
    contactsSyncedAt: null,
    historySyncedAt: null,
    paymentCheckedAt: null,
    disconnectedAt: null,
    disconnectedVia: null,
    ...extra,
  });

  it("aparece na coexistência pela janela da Meta, com alguma faltando, dentro das 24 horas", () => {
    expect(pendingCoexistenceSync(connection(), now)).toBe(true);
    expect(pendingCoexistenceSync(connection({ contactsSyncedAt: now }), now)).toBe(true);
  });

  it("não aparece quando já foi feita, passou das 24 horas, sem coexistência ou cadastrada pelo Suporte", () => {
    expect(pendingCoexistenceSync(connection({ contactsSyncedAt: now, historySyncedAt: now }), now)).toBe(false);
    expect(pendingCoexistenceSync(connection({ connectedAt: new Date("2026-10-24T11:00:00Z") }), now)).toBe(false);
    expect(pendingCoexistenceSync(connection({ coexistence: false }), now)).toBe(false);
    expect(pendingCoexistenceSync(connection({ connectedVia: "support" }), now)).toBe(false);
    expect(pendingCoexistenceSync(null, now)).toBe(false);
  });
});
