import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { deleteKnownIssue, listKnownIssues, saveKnownIssue } from "../../src/lib/data/knownIssues";
import { addMember, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";

// IS5 — Problemas conhecidos (cliente, 03/nov/2026): só o Suporte lê e grava; os casos de 03/nov vêm na migração.

let clinicId: string;
let admin: TestUser;
let support: TestUser;
const asDb = (client: unknown) => client as DbClient;
const codeOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "erro";
  }
};

beforeAll(async () => {
  clinicId = await createClinic("Clínica IS5");
  [admin, support] = await Promise.all([createUser("is5-admin"), createUser("is5-suporte")]);
  await addMember(clinicId, admin.id, ["admin"]);
  await makePlatformStaff(support.id);
});

afterAll(async () => {
  await deleteClinics([clinicId]);
  await deleteUsers([admin, support]);
});

describe("problemas conhecidos", () => {
  it("os casos de 03/nov vêm prontos, com a busca sem acento", async () => {
    const all = await listKnownIssues(asDb(support.client));
    expect(all.map((i) => i.title)).toEqual(
      expect.arrayContaining(["Lembretes e avisos não chegam: erro 131042 (pagamento na Meta)", "O bot não responde no teste"]),
    );
    const found = await listKnownIssues(asDb(support.client), "saudacao");
    expect(found.map((i) => i.title)).toContain('O bot para depois do menu e a conversa fica "Aguardando a clínica"');
    expect(found.find((i) => i.title.startsWith("O bot para"))!.links).toEqual([
      { label: "Guia: desligar as mensagens automáticas", href: "/guia/antes-de-conectar#mensagens-automaticas" },
    ]);
  });

  it("o Suporte cadastra, altera e exclui; a clínica não vê nem grava", async () => {
    const input = { title: "Teste IS5", symptom: "Algo acontece", cause: "", solution: "Fazer isso", links: "" };
    expect(await codeOf(() => saveKnownIssue(asDb(support.client), { ...input, solution: " " }, support.id))).toBe("invalid");
    const id = await saveKnownIssue(asDb(support.client), input, support.id);
    await saveKnownIssue(asDb(support.client), { ...input, title: "Teste IS5 alterado" }, support.id, id);
    expect((await listKnownIssues(asDb(support.client), "IS5 alterado")).map((i) => i.id)).toEqual([id]);

    expect(await listKnownIssues(asDb(admin.client))).toEqual([]);
    expect(await codeOf(() => saveKnownIssue(asDb(admin.client), input, admin.id))).not.toBe("ok");

    await deleteKnownIssue(asDb(support.client), id);
    expect(await listKnownIssues(asDb(support.client), "IS5 alterado")).toEqual([]);
  });
});
