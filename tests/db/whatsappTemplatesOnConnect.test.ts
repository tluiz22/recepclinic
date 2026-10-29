import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { setWhatsappAccessToken } from "../../src/lib/data/whatsapp/connection";
import { createTemplatesAfterConnect } from "../../src/lib/data/whatsapp/templateSync";
import { DEFAULT_TEMPLATES } from "../../src/lib/data/whatsapp/templates";
import { adminClient, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";

// F8.2: logo depois de conectar pela janela da Meta, os templates vão para a
// conta da clínica: os padrão e as versões personalizadas em uso. A Meta é
// simulada (nenhuma chamada sai).

const WABA = "f82-waba-nova";
const CUSTOM_NAME = "rc_lembrete_f82_v2";
const CUSTOM_BODY = "Olá, {{1}}! Aqui é {{2}}. Lembrete: {{3}}, {{4}}, {{5}}, {{6}}.";

let clinicId: string;
let support: TestUser;

type Call = { method: string; path: string; body: Record<string, unknown> | null };

/** Meta de mentira: a conta já tem `existing` (aprovados); o resto é criado em análise. */
function fakeMeta(existing: string[]) {
  const calls: Call[] = [];
  let next = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v[\d.]+/, "");
    calls.push({ method: init?.method ?? "GET", path, body: init?.body && typeof init.body === "string" ? JSON.parse(init.body) : null });
    if (path.endsWith("/message_templates") && init?.method === "POST") return Response.json({ id: `tpl-${++next}`, status: "PENDING" });
    if (path.endsWith("/message_templates")) {
      const name = url.searchParams.get("name") ?? "";
      return Response.json({ data: existing.includes(name) ? [{ id: `tpl-${name}`, name, language: "pt_BR", status: "APPROVED" }] : [] });
    }
    return Response.json({ error: { code: 100, message: "inesperado" } }, { status: 400 });
  };
  return { calls, fetcher };
}

const service = () => clinicServiceClient(clinicId) as unknown as DbClient;

beforeAll(async () => {
  clinicId = await createClinic("Clínica Templates na Conexão");
  support = await createUser("f82-suporte");
  await makePlatformStaff(support.id);
  await adminClient().from("whatsapp_connections").insert({ clinic_id: clinicId, phone_number_id: `${Date.now()}82`, waba_id: WABA, status: "connected" });
  await setWhatsappAccessToken(support.client as unknown as DbClient, clinicId, "token-f82");
  // Versão personalizada aprovada numa conta anterior, e uma recusada (essa não vai).
  await adminClient()
    .from("whatsapp_templates")
    .insert([
      { clinic_id: clinicId, template_key: "reminder", name: CUSTOM_NAME, language: "pt_BR", status: "approved", version: 2, body: CUSTOM_BODY, stage: "meta" },
      { clinic_id: clinicId, template_key: "confirmation", name: "rc_confirmacao_f82_v2", language: "pt_BR", status: "rejected", version: 2, body: CUSTOM_BODY, stage: "meta" },
    ]);
});

afterAll(async () => {
  await deleteClinics([clinicId]);
  await deleteUsers([support]);
});

describe("templates na conexão pela janela da Meta (F8.2)", () => {
  it("cria os padrão e a versão personalizada em uso na conta nova; o que a conta já tem só guarda a situação", async () => {
    const meta = fakeMeta(["rc_lembrete_v1"]);
    const result = await createTemplatesAfterConnect(service(), clinicId, meta.fetcher, "111111");
    expect(result.ok).toBe(true);
    const lines = result.ok ? result.lines : [];
    // A nota fiscal e o arquivo do preparo (C7) sobem o PDF de exemplo pelo app: na Meta simulada dá erro, e o resto segue.
    expect(lines.filter((l) => l.problem).map((l) => l.key)).toEqual(["exam_preparation_file", "nfse_document"]);
    expect(lines.find((l) => l.name === "rc_lembrete_v1")).toMatchObject({ status: "approved" });
    expect(lines.find((l) => l.name === CUSTOM_NAME)).toMatchObject({ status: "pending", problem: null });
    expect(lines.some((l) => l.name === "rc_confirmacao_f82_v2")).toBe(false);

    const created = meta.calls.filter((c) => c.method === "POST" && c.path === `/${WABA}/message_templates`).map((c) => c.body!);
    expect(created.map((b) => b.name)).toContain(CUSTOM_NAME);
    expect(created.map((b) => b.name)).not.toContain("rc_lembrete_v1");
    const custom = created.find((b) => b.name === CUSTOM_NAME)!;
    expect((custom.components as { type: string; text?: string }[]).find((c) => c.type === "BODY")!.text).toBe(CUSTOM_BODY);

    const { data } = await adminClient().from("whatsapp_templates").select("name, status, version").eq("clinic_id", clinicId);
    expect(data).toContainEqual({ name: CUSTOM_NAME, status: "pending", version: 2 });
    expect(data).toContainEqual({ name: "rc_lembrete_v1", status: "approved", version: 1 });
    expect(data).toContainEqual({ name: "rc_confirmacao_v1", status: "pending", version: 1 });
    // Os dois com PDF de exemplo (nota fiscal e arquivo do preparo) não foram criados na Meta simulada.
    expect(data!.filter((t) => t.version === 1)).toHaveLength(DEFAULT_TEMPLATES.length - 2);
  });

  it("reconectar a mesma conta não cria de novo: só guarda a situação", async () => {
    const meta = fakeMeta(DEFAULT_TEMPLATES.map((t) => t.name).concat(CUSTOM_NAME));
    const result = await createTemplatesAfterConnect(service(), clinicId, meta.fetcher, "111111");
    expect(meta.calls.filter((c) => c.method === "POST")).toEqual([]);
    expect(result.ok && result.lines.every((l) => l.status === "approved")).toBe(true);
  });
});
