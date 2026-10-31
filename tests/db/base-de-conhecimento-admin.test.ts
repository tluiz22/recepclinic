import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import {
  addClinicalTerm,
  addSynonym,
  getEntry,
  latestPublication,
  changesSincePublication,
  listRevisions,
  listUnmatched,
  publish,
  removeSynonym,
  saveEntry,
  setEntriesStatus,
  setEntryStatus,
  testQuestion,
  type KbEntryInput,
} from "../../src/lib/data/knowledge/admin";
import { adminClient, clinicServiceClient, createUser, deleteUsers, makePlatformStaff, withDatabase, type TestUser } from "./helpers";
import { setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// BC 3.3 — administração da base pelo Suporte: cadastro com validação,
// publicação barrada por modelo sem fonte, histórico, testador (com registro
// da leitura) e perguntas não reconhecidas.
let support: TestUser;
let clinic: AgendaFixture;
const db = () => support.client as unknown as DbClient;
const versions: number[] = [];

const input = (code: string, extra: Partial<KbEntryInput> = {}): KbEntryInput => ({
  code,
  categoryKey: "general",
  question: `Pergunta ${code}`,
  keywords: ["zebra"],
  guidance: "",
  answerType: "fixed",
  template: "Resposta zebra.",
  sources: [],
  flow: null,
  requiredTerm: null,
  offersReception: false,
  ...extra,
});

beforeAll(async () => {
  support = await createUser("suporte-bc-admin");
  await makePlatformStaff(support.id);
  clinic = await setupAgendaClinic("Clínica do testador", "859772300");
});

afterAll(async () => {
  await adminClient().from("kb_entries").delete().in("code", ["Z7", "Z8"]);
  await adminClient().from("kb_clinical_terms").delete().eq("term", "termo zebra");
  if (versions.length) await adminClient().from("kb_publications").delete().in("version", versions);
  await adminClient().from("kb_unmatched").delete().eq("clinic_id", clinic.clinicId);
  await clinic.cleanup();
  await deleteUsers([support]);
});

describe("cadastro", () => {
  it("cria em rascunho, edita, muda a situação e os sinônimos", async () => {
    expect(await saveEntry(db(), input("Z7"))).toBe("Z7");
    let entry = await getEntry(db(), "Z7");
    expect(entry).toMatchObject({ status: "draft", version: 1, question: "Pergunta Z7" });
    await saveEntry(db(), input("Z7", { question: "Pergunta Z7 nova" }), "Z7");
    await setEntryStatus(db(), "Z7", "approved");
    await addSynonym(db(), "Z7", "frase zebra");
    entry = await getEntry(db(), "Z7");
    expect(entry).toMatchObject({ status: "approved", question: "Pergunta Z7 nova" });
    expect(entry!.synonyms.map((s) => s.text)).toEqual(["frase zebra"]);
    await removeSynonym(db(), entry!.synonyms[0].id);
    expect((await getEntry(db(), "Z7"))!.synonyms).toEqual([]);
  });

  it("recusa modelo com variável sem fonte, código fora do padrão e fluxo sem escolha", async () => {
    await expect(saveEntry(db(), input("Z8", { answerType: "template", template: "Site: {site}", sources: [] }))).rejects.toMatchObject({
      code: "invalid",
      fields: { template: expect.stringContaining("{site}") },
    });
    await expect(saveEntry(db(), input("ZZZ9"))).rejects.toMatchObject({ code: "invalid" });
    await expect(saveEntry(db(), input("Z8", { answerType: "flow", template: null }))).rejects.toMatchObject({ code: "invalid", fields: { flow: expect.any(String) } });
    expect(await saveEntry(db(), input("Z8", { keywords: ["girafa"], answerType: "template", template: "Site: {site}", sources: ["website"] }))).toBe("Z8");
  });

  it("situação em lote: só as marcadas, cada uma no histórico; sem nenhuma marcada, recusa", async () => {
    await expect(setEntriesStatus(db(), [], "active")).rejects.toMatchObject({ code: "invalid", fields: { codigos: expect.any(String) } });
    expect(await setEntriesStatus(db(), ["Z7", "Z8"], "inactive")).toBe(2);
    expect(await setEntriesStatus(db(), ["Z7", "Z8"], "inactive")).toBe(0);
    expect((await getEntry(db(), "Z7"))!.status).toBe("inactive");
    expect((await getEntry(db(), "F1"))!.status).toBe("draft");
    const z8 = await getEntry(db(), "Z8");
    expect((await listRevisions(db(), { entryId: z8!.id })).some((r) => r.changed.includes("situação: draft → inactive"))).toBe(true);
    await setEntriesStatus(db(), ["Z7"], "approved");
    await setEntriesStatus(db(), ["Z8"], "draft");
  });

  it("histórico com quem fez e o que mudou", async () => {
    const entry = await getEntry(db(), "Z7");
    const revisions = await listRevisions(db(), { entryId: entry!.id });
    expect(revisions.length).toBeGreaterThanOrEqual(5);
    expect(revisions.some((r) => r.changed.includes("situação: draft → approved"))).toBe(true);
    expect(revisions.some((r) => r.tableName === "Sinônimo" && r.operation === "DELETE")).toBe(true);
  });
});

describe("publicação", () => {
  it("barra modelo ativo com variável sem fonte (gravado direto no banco)", async () => {
    await adminClient().from("kb_entries").update({ status: "active", sources: [] }).eq("code", "Z8");
    await expect(publish(db())).rejects.toMatchObject({ code: "invalid" });
    await adminClient().from("kb_entries").update({ status: "draft", sources: ["website"] }).eq("code", "Z8");
  });

  it("publica, mostra a versão e conta o que mudou depois", async () => {
    await setEntryStatus(db(), "Z7", "active");
    const version = await publish(db());
    versions.push(version);
    const publication = await latestPublication(db());
    expect(publication).toMatchObject({ version });
    expect(publication!.entries).toBeGreaterThanOrEqual(1);
    expect(await changesSincePublication(db(), publication)).toBe(0);
    await addClinicalTerm(db(), "symptom", "termo zebra");
    expect(await changesSincePublication(db(), publication)).toBe(1);
  });
});

describe("testador", () => {
  it("reconhece com a base em edição e com a publicada, e registra a leitura da clínica", async () => {
    const editing = await testQuestion(db(), clinic.clinicId, "zebra?", "editing", new Date());
    expect(editing!.match).toMatchObject({ kind: "answer", entry: { code: "Z7" } });
    expect(editing!.answer).toMatchObject({ kind: "text", text: "Resposta zebra." });
    const published = await testQuestion(db(), clinic.clinicId, "zebra?", "published", new Date());
    expect(published!.match.kind).toBe("answer");
    const logged = await withDatabase(async (pg) =>
      (await pg.query("select count(*)::int as n from platform_access_log where clinic_id = $1 and actor_user_id = $2", [clinic.clinicId, support.id])).rows[0].n,
    );
    expect(logged).toBe(2);
  });

  it("usa os dados da clínica escolhida", async () => {
    const result = await testQuestion(db(), clinic.clinicId, "qual o endereço?", "editing", new Date());
    expect(result!.answer).toMatchObject({ kind: "text", text: expect.stringContaining("Rua A, 1") });
  });

  it("a clínica não usa o testador", async () => {
    await expect(testQuestion(clinic.admin.client as unknown as DbClient, clinic.clinicId, "zebra?", "editing", new Date())).rejects.toThrow();
  });
});

describe("perguntas não reconhecidas", () => {
  it("o Suporte vê o texto e a clínica, sem telefone", async () => {
    await clinicServiceClient(clinic.clinicId).from("kb_unmatched").insert({ clinic_id: clinic.clinicId, text: "tem estacionamento zebra?", conversation_state: "MENU" });
    const rows = await listUnmatched(db());
    const row = rows.find((r) => r.text === "tem estacionamento zebra?");
    expect(row).toMatchObject({ clinicName: "Clínica do testador", state: "MENU" });
    expect(Object.keys(row!)).toEqual(["id", "clinicName", "text", "state", "occurredAt"]);
  });
});
