import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import {
  preparePreparationUpload,
  receivedPreparationFile,
  SERVICE_FILES_BUCKET,
  setPreparationFile,
} from "../../src/lib/data/config/preparationFile";
import { getService } from "../../src/lib/data/config/services";
import { clinicServiceClient } from "./helpers";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture, type AgendaIds } from "./agendaFixture";
import type { TestUser } from "./helpers";

// C7 (cliente, 28/out/2026): arquivo com as orientações do preparo do exame.
let fixture: AgendaFixture;
let clinicId: string;
let admin: TestUser;
let reception: TestUser;
let ids: AgendaIds;
const db = asDb;
const PDF = new Blob(["%PDF-1.4 teste"], { type: "application/pdf" });

/** Sobe um PDF pelo link de envio de uso único, como a tela faz. */
async function upload(user: TestUser): Promise<string> {
  const { path, uploadUrl } = await preparePreparationUpload(db(user), clinicId, { fileName: "orientacoes.pdf", mimeType: "application/pdf", sizeBytes: PDF.size });
  const token = new URL(uploadUrl).searchParams.get("token")!;
  const { error } = await (db(user) as DbClient).storage.from(SERVICE_FILES_BUCKET).uploadToSignedUrl(path, token, PDF, { contentType: "application/pdf" });
  if (error) throw error;
  return path;
}

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste do arquivo do preparo", "859888500");
  ({ clinicId, admin, reception, ids } = fixture);
});

afterAll(async () => {
  await fixture.cleanup();
});

describe("arquivo do preparo do exame", () => {
  it("só PDF, JPG ou PNG até 10 MB", async () => {
    expect(await codeOf(() => preparePreparationUpload(db(admin), clinicId, { fileName: "a.docx", mimeType: "application/msword", sizeBytes: 10 }))).toBe("invalid");
    expect(await codeOf(() => preparePreparationUpload(db(admin), clinicId, { fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 11 * 1024 * 1024 }))).toBe("invalid");
  });

  it("só o Administrador anexa; a Recepção não", async () => {
    expect(await codeOf(() => preparePreparationUpload(db(reception), clinicId, { fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: PDF.size }))).toBe("forbidden");
  });

  it("grava no exame, mesmo sem o texto do preparo (C7.5)", async () => {
    const path = await upload(admin);
    const file = await receivedPreparationFile(db(admin), clinicId, JSON.stringify({ path, name: "orientacoes.pdf", type: "application/pdf", size: PDF.size }));
    // O Exame da clínica de teste não tem texto de preparo: com arquivo, as instruções não vão.
    expect((await getService(db(admin), clinicId, ids.exame)).preparationInstructions).toBeNull();
    await setPreparationFile(db(admin), clinicId, ids.exame, file);
    expect((await getService(db(admin), clinicId, ids.exame)).preparationFile).toEqual(file);

    // Caminho de outra clínica ou que não chegou: recusado.
    expect(await codeOf(() => receivedPreparationFile(db(admin), clinicId, JSON.stringify({ ...file, path: path.replace(clinicId, crypto.randomUUID()) })))).toBe("invalid");
  });

  it("o envio pelo WhatsApp (credencial da clínica) lê o arquivo da própria clínica", async () => {
    const { preparationFile } = await getService(db(admin), clinicId, ids.exame);
    const service = clinicServiceClient(clinicId) as unknown as DbClient;
    const { data, error } = await service.storage.from(SERVICE_FILES_BUCKET).download(preparationFile!.path);
    expect(error).toBeNull();
    expect(await data!.text()).toBe("%PDF-1.4 teste");
    const other = clinicServiceClient(crypto.randomUUID()) as unknown as DbClient;
    expect((await other.storage.from(SERVICE_FILES_BUCKET).download(preparationFile!.path)).data).toBeNull();
  });

  it("trocar ou tirar o arquivo apaga o anterior do armazenamento", async () => {
    const { preparationFile: old } = await getService(db(admin), clinicId, ids.exame);
    await setPreparationFile(db(admin), clinicId, ids.exame, null);
    const folder = `${clinicId}/preparo`;
    const { data } = await (db(admin) as DbClient).storage.from(SERVICE_FILES_BUCKET).list(folder);
    expect(data?.some((object) => `${folder}/${object.name}` === old!.path)).toBe(false);
  });
});
