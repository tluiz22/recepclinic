import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KB_FLOWS, KB_REQUIRED_TERMS, KB_SOURCES } from "../../src/lib/knowledge";
import {
  addMember,
  adminClient,
  anonClient,
  clinicServiceClient,
  createClinic,
  createUser,
  deleteClinics,
  deleteUsers,
  makePlatformStaff,
  withDatabase,
  type TestUser,
} from "./helpers";

// BC 3.1 — Base de Conhecimento Global: quem lê e grava, histórico,
// publicação, perguntas não reconhecidas e o catálogo inicial em rascunho.
let support: TestUser;
let clinicAdmin: TestUser;
let clinicA: string;
let clinicB: string;
const createdCodes: string[] = [];
const publishedVersions: number[] = [];

const testEntry = (code: string, extra: Record<string, unknown> = {}) => ({
  code,
  category_key: "general",
  question: `Pergunta de teste ${code}`,
  keywords: ["teste"],
  answer_type: "fixed",
  template: "Resposta de teste.",
  ...extra,
});

async function insertAsSupport(code: string, extra: Record<string, unknown> = {}) {
  const result = await support.client.from("kb_entries").insert(testEntry(code, extra)).select("id, version, updated_by").single();
  if (!result.error) createdCodes.push(code);
  return result;
}

async function publish(): Promise<number> {
  const { data, error } = await support.client.rpc("publish_knowledge_base");
  if (error) throw error;
  publishedVersions.push(data as number);
  return data as number;
}

beforeAll(async () => {
  support = await createUser("suporte-bc");
  await makePlatformStaff(support.id);
  clinicAdmin = await createUser("admin-bc");
  clinicA = await createClinic("Clínica A da base");
  clinicB = await createClinic("Clínica B da base");
  await addMember(clinicA, clinicAdmin.id, ["admin"]);
});

afterAll(async () => {
  const admin = adminClient();
  if (createdCodes.length) await admin.from("kb_entries").delete().in("code", createdCodes);
  if (publishedVersions.length) await admin.from("kb_publications").delete().in("version", publishedVersions);
  await admin.from("kb_unmatched").delete().in("clinic_id", [clinicA, clinicB]);
  await deleteClinics([clinicA, clinicB]);
  await deleteUsers([support, clinicAdmin]);
});

describe("catálogo inicial", () => {
  it("31 entradas, todas em rascunho, com sinônimos; sem publicação do catálogo", async () => {
    const { data: entries } = await adminClient().from("kb_entries").select("code, status").not("code", "like", "Z%");
    expect(entries).toHaveLength(31);
    expect(new Set(entries!.map((e) => e.status))).toEqual(new Set(["draft"]));
    const { data: synonyms } = await adminClient().from("kb_synonyms").select("entry_id");
    expect(synonyms!.length).toBeGreaterThan(150);
    const { count: specialties } = await adminClient().from("kb_specialties").select("*", { count: "exact", head: true });
    expect(specialties).toBe(34);
    const { count: categories } = await adminClient().from("kb_categories").select("*", { count: "exact", head: true });
    expect(categories).toBe(18);
  });

  it("as listas de fontes, fluxos e termos do banco são as do código", async () => {
    const defs = await withDatabase(async (db) =>
      (await db.query("select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.kb_entries'::regclass and contype = 'c'")).rows.map(
        (r) => r.def as string,
      ),
    );
    const quoted = (needle: string) => {
      const def = defs.find((d) => d.includes(needle))!;
      return [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort();
    };
    expect(quoted("sources <@")).toEqual([...KB_SOURCES].sort());
    expect(quoted("(flow = ANY")).toEqual([...KB_FLOWS].sort());
    expect(quoted("(required_term = ANY")).toEqual([...KB_REQUIRED_TERMS].sort());
  });
});

describe("quem lê e grava o conteúdo", () => {
  it("o Suporte cria e edita; a versão sobe e o autor fica na entrada", async () => {
    const { data, error } = await insertAsSupport("Z1");
    expect(error).toBeNull();
    expect(data!.version).toBe(1);
    expect(data!.updated_by).toBe(support.id);
    const { data: updated } = await support.client.from("kb_entries").update({ question: "Pergunta Z1 editada" }).eq("code", "Z1").select("version").single();
    expect(updated!.version).toBe(2);
  });

  it("login de clínica não vê nem grava a base", async () => {
    const { data } = await clinicAdmin.client.from("kb_entries").select("code");
    expect(data).toEqual([]);
    const { error } = await clinicAdmin.client.from("kb_entries").insert(testEntry("Z2"));
    expect(error).not.toBeNull();
    const { data: synonyms } = await clinicAdmin.client.from("kb_synonyms").select("id");
    expect(synonyms).toEqual([]);
  });

  it("o bot (credencial da clínica) não lê o rascunho", async () => {
    const { data, error } = await clinicServiceClient(clinicA).from("kb_entries").select("code");
    expect(data ?? []).toEqual([]);
    expect(error).not.toBeNull();
  });

  it("sem login, nada", async () => {
    const { data } = await anonClient().from("kb_entries").select("code");
    expect(data ?? []).toEqual([]);
    const { data: publications } = await anonClient().from("kb_publications").select("version");
    expect(publications ?? []).toEqual([]);
  });

  it("as travas recusam fonte, fluxo e tipo sem texto fora da lista", async () => {
    expect((await insertAsSupport("Z3", { answer_type: "source", template: null, sources: ["outra_clinica"] })).error).not.toBeNull();
    expect((await insertAsSupport("Z4", { answer_type: "flow", template: null, flow: "apagar_tudo" })).error).not.toBeNull();
    expect((await insertAsSupport("Z5", { answer_type: "template", template: null })).error).not.toBeNull();
    expect((await insertAsSupport("Z6", { answer_type: "source", template: null, sources: [] })).error).not.toBeNull();
  });
});

describe("histórico", () => {
  it("criação, edição e sinônimo ficam registrados com o autor", async () => {
    const { data: entry } = await support.client.from("kb_entries").select("id").eq("code", "Z1").single();
    const { error } = await support.client.from("kb_synonyms").insert({ entry_id: entry!.id, text: "frase de teste" });
    expect(error).toBeNull();
    const { data: revisions } = await support.client
      .from("kb_revisions")
      .select("table_name, operation, actor_user_id")
      .eq("entry_id", entry!.id)
      .order("id");
    expect(revisions).toEqual([
      { table_name: "kb_entries", operation: "INSERT", actor_user_id: support.id },
      { table_name: "kb_entries", operation: "UPDATE", actor_user_id: support.id },
      { table_name: "kb_synonyms", operation: "INSERT", actor_user_id: support.id },
    ]);
  });

  it("clínica não lê o histórico e ninguém grava nele direto", async () => {
    const { data } = await clinicAdmin.client.from("kb_revisions").select("id");
    expect(data).toEqual([]);
    const { error } = await support.client
      .from("kb_revisions")
      .insert({ table_name: "kb_entries", record_id: "00000000-0000-0000-0000-000000000000", operation: "INSERT" });
    expect(error).not.toBeNull();
  });
});

describe("publicação", () => {
  it("só o Suporte publica", async () => {
    const { error } = await clinicAdmin.client.rpc("publish_knowledge_base");
    expect(error).not.toBeNull();
    const { error: botError } = await clinicServiceClient(clinicA).rpc("publish_knowledge_base");
    expect(botError).not.toBeNull();
  });

  it("a fotografia leva só as entradas ativas, com sinônimos; a versão sobe", async () => {
    const first = await publish();
    await support.client.from("kb_entries").update({ status: "active" }).eq("code", "Z1");
    const second = await publish();
    expect(second).toBe(first + 1);

    const bot = clinicServiceClient(clinicA);
    const { data } = await bot.from("kb_publications").select("version, content").order("version", { ascending: false }).limit(1).single();
    expect(data!.version).toBe(second);
    const entries = (data!.content as { entries: { code: string; synonyms: string[] }[] }).entries;
    expect(entries.map((e) => e.code)).toEqual(["Z1"]);
    expect(entries[0].synonyms).toEqual(["frase de teste"]);
    const content = data!.content as { specialties: unknown[]; clinicalTerms: unknown[] };
    expect(content.specialties).toHaveLength(34);
    expect(content.clinicalTerms.length).toBeGreaterThan(40);
  });

  it("editar depois de publicar não muda o que o bot lê até a próxima publicação", async () => {
    await support.client.from("kb_entries").update({ status: "inactive" }).eq("code", "Z1");
    const bot = clinicServiceClient(clinicB);
    const { data } = await bot.from("kb_publications").select("content").order("version", { ascending: false }).limit(1).single();
    expect((data!.content as { entries: { code: string }[] }).entries.map((e) => e.code)).toEqual(["Z1"]);
    await publish();
    const { data: after } = await bot.from("kb_publications").select("content").order("version", { ascending: false }).limit(1).single();
    expect((after!.content as { entries: unknown[] }).entries).toEqual([]);
  });

  it("ninguém grava a publicação fora da função", async () => {
    const { error } = await support.client.from("kb_publications").insert({ version: 9999, content: {} });
    expect(error).not.toBeNull();
    const { error: botError } = await clinicServiceClient(clinicA).from("kb_publications").insert({ version: 9998, content: {} });
    expect(botError).not.toBeNull();
  });
});

describe("perguntas não reconhecidas", () => {
  it("o bot grava só na própria clínica e não lê", async () => {
    const bot = clinicServiceClient(clinicA);
    expect((await bot.from("kb_unmatched").insert({ clinic_id: clinicA, text: "tem estacionamento?", conversation_state: "MENU" })).error).toBeNull();
    expect((await bot.from("kb_unmatched").insert({ clinic_id: clinicB, text: "de outra clínica" })).error).not.toBeNull();
    const { data } = await bot.from("kb_unmatched").select("text");
    expect(data ?? []).toEqual([]);
  });

  it("o Suporte lê; a clínica não", async () => {
    const { data } = await support.client.from("kb_unmatched").select("text, clinic_id").eq("clinic_id", clinicA);
    expect(data).toEqual([{ text: "tem estacionamento?", clinic_id: clinicA }]);
    const { data: clinicView } = await clinicAdmin.client.from("kb_unmatched").select("text");
    expect(clinicView).toEqual([]);
  });

  it("a limpeza de 90 dias está agendada", async () => {
    const jobs = await withDatabase(async (db) => (await db.query("select command from cron.job where jobname = 'limpar-perguntas-nao-reconhecidas'")).rows);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].command).toContain("interval '90 days'");
  });
});
